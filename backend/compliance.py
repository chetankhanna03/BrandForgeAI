"""Combine measurable checks and semantic observations without granting an AI approval."""
import hashlib
import re

from . import nemotron
from .media_processing import inspect_image, inspect_video, InvalidMedia


def checked_rules(rules):
    return {str(rule['id']): rule['version'] for rule in rules if rule['approved']}


def _enrich(finding, rules, media_type='text', reference='Marketing copy'):
    rule = next((rule for rule in rules if rule['id'] == finding.get('rule_id')), {})
    return {**finding, 'media_type': media_type, 'content_reference': reference,
            'category': rule.get('category', 'general'), 'severity': rule.get('severity', 'error'),
            'confidence': 1.0, 'evidence_type': 'observed', 'timestamp_seconds': None,
            'review_status': 'pending', 'origin': 'deterministic'}


def build_report(payload, rules, media, evaluate):
    result = evaluate(payload.content, payload.platforms, rules)
    if media:
        result['findings'] = [f for f in result['findings'] if not (
            f['id'] == 'setup' and any(rule['approved'] for rule in rules) or
            not payload.content.strip() and (f.get('fix') or {}).get('kind') == 'append'
        )]
    result['findings'] = [_enrich(finding, rules) for finding in result['findings']]
    result['observations'] = []
    result['media_inspection'] = None
    result['engine'] = 'Deterministic checks + NVIDIA Nemotron Omni'
    result['analysis'] = {'status': 'complete', 'mode': 'nemotron', 'coverage': ['exact_text'], 'limitations': []}
    try:
        if nemotron.deterministic_only():
            result['engine'] = 'Deterministic rules v1 · text only (explicit offline mode)'
            result['analysis']['mode'] = 'deterministic_only'
            result['analysis']['limitations'] = ['Semantic, image, and video compliance were not analysed in explicit offline mode.']
            if media or any(rule['approved'] and rule['kind'] == 'semantic' for rule in rules):
                raise nemotron.AnalysisUnavailable('Offline mode cannot approve semantic rules or media. Enable NVIDIA analysis and recheck.', 'offline_coverage')
        else:
            parts, options = [], {}
            if media:
                if media['mime'] in ('image/jpeg', 'image/png'):
                    result['media_inspection'] = inspect_image(media['data'])
                elif media['mime'] == 'video/mp4':
                    result['media_inspection'] = inspect_video(media['data'])
                    options = {'video': True, 'has_audio': result['media_inspection']['has_audio'],
                               'frames': result['media_inspection']['sample_frames']}
                    result['analysis']['limitations'].append(result['media_inspection']['sampling_note'])
                else:
                    raise InvalidMedia('Review supports JPEG/PNG images and MP4 video. Other existing formats are preview-only; export a supported file and re-upload.')
                parts.append(nemotron.media_part(media['data'], media['mime']))
            active = [rule for rule in rules if rule['approved']]
            response = nemotron.review({'approved_rules': active, 'copy': payload.content,
                'deterministic_findings': result['findings'], 'platforms': payload.platforms,
                'media_reference': media['filename'] if media else None,
                'media_inspection': result['media_inspection']}, parts, **options)
            expected_media = 'video' if media and media['mime'].startswith('video/') else 'image' if media else None
            coverage_ok = (not payload.content.strip() or response.text_reviewed) and (not media or response.visual_reviewed)
            if options.get('has_audio'):
                coverage_ok = coverage_ok and response.speech_reviewed
            result['analysis']['coverage'] += ['semantic_text'] if response.text_reviewed else []
            if media and response.visual_reviewed:
                result['analysis']['coverage'].append(expected_media)
            if options.get('has_audio') and response.speech_reviewed:
                result['analysis']['coverage'].append('video_audio')
            result['analysis']['limitations'] += response.limitations
            if not coverage_ok:
                result['analysis'].update(status='needs_review', message='The model could not fully review the supplied copy, visuals, or audio. Human review and a new analysis are required.')
            if any(o.certainty == 'inferred' and o.channel in ('visible_text', 'speech') for o in response.observations):
                result['analysis'].update(status='needs_review', message='Some visible text or speech could not be established confidently. Verify the source and recheck; this asset has not passed.')
            for observation in response.observations:
                if not media or observation.channel == 'speech' and not options.get('has_audio'):
                    raise nemotron.AnalysisUnavailable('The model reported evidence for a media channel that was not supplied.', 'invalid_output')
                if observation.timestamp_seconds is not None and (
                    expected_media != 'video' or observation.timestamp_seconds > result['media_inspection']['duration_seconds']
                ):
                    raise nemotron.AnalysisUnavailable('The model returned an invalid media timestamp.', 'invalid_output')
            result['observations'] = [observation.model_dump() for observation in response.observations]
            # Exact numeric/phrase checks also apply to observed OCR and speech, not
            # just to the typed caption. Inferences are never treated as literal OCR.
            observations = [o for o in response.observations if o.certainty == 'observed' and o.channel != 'visual']
            if media and coverage_ok:
                observed_copy = '\n'.join(o.text for o in observations)
                measured = evaluate(observed_copy, [], rules)
                for finding in measured['findings']:
                    if finding['id'] == 'setup':
                        continue
                    item = _enrich(finding, rules, expected_media, media['filename'])
                    item['id'] = 'media-' + item['id']
                    item['fix'] = None
                    item['confidence'] = 0.85  # Measurements are exact; model OCR/transcription can be wrong.
                    matching = next((o for o in observations if finding['matched'] and finding['matched'] in o.text), None)
                    item['timestamp_seconds'] = matching.timestamp_seconds if matching else None
                    item['origin'] = 'deterministic_on_model_observation'
                    result['findings'].append(item)
            approved = {rule['id']: rule for rule in active}
            for finding in response.findings:
                rule = approved.get(finding.rule_id)
                if not rule or finding.media_type not in ('text', expected_media):
                    raise nemotron.AnalysisUnavailable('The model cited an unapproved rule or an absent media asset.', 'invalid_output')
                if finding.media_type == 'text' and finding.excerpt and finding.excerpt not in payload.content:
                    raise nemotron.AnalysisUnavailable('The model cited text that is not in the submitted copy.', 'invalid_output')
                if finding.timestamp_seconds is not None and (finding.media_type != 'video' or
                    finding.timestamp_seconds > result['media_inspection']['duration_seconds']):
                    raise nemotron.AnalysisUnavailable('The model cited an invalid video timestamp.', 'invalid_output')
                if not finding.violated:
                    continue
                # Exact rule predicates take precedence over a model's interpretation.
                # Do not invent placement/tax conditions for a satisfied phrase/fact.
                asset_copy = payload.content if finding.media_type == 'text' else '\n'.join(o.text for o in observations)
                if rule['kind'] == 'required' and (finding.media_type == 'text' or observations):
                    if not any(item.get('rule_id') == rule['id'] for item in evaluate(asset_copy, [], [rule])['findings']):
                        continue
                if rule['kind'] == 'fact':
                    unit_pattern = r'\d[\d,.]*\s*(?:km|kilometers?|kilometres?)\b' if rule['unit'] == 'km' else r'\$\s*\d|\bUSD\s+\d|\d\s+USD\b'
                    if re.search(unit_pattern, finding.excerpt, re.I) and not any(item.get('rule_id') == rule['id'] for item in evaluate(finding.excerpt, [], [rule])['findings']):
                        continue
                if any(existing['rule_id'] == finding.rule_id and existing['media_type'] == finding.media_type and (
                    rule['kind'] == 'required' or existing.get('matched') and existing['matched'].casefold() in finding.excerpt.casefold()
                ) for existing in result['findings']):
                    continue
                identity = f'{finding.rule_id}:{finding.media_type}:{finding.excerpt}:{finding.timestamp_seconds}'
                fix = None
                if finding.media_type == 'text' and finding.rewrite and finding.excerpt and payload.content.count(finding.excerpt) == 1:
                    start = payload.content.index(finding.excerpt)
                    fix = {'kind': 'replace', 'start': start, 'end': start + len(finding.excerpt), 'text': finding.rewrite}
                confidence, evidence_type = finding.confidence, finding.evidence_type
                if (rule['kind'] == 'color' or rule.get('category') == 'visual_identity') and finding.media_type != 'text':
                    confidence, evidence_type = min(confidence, 0.65), 'inferred'
                result['findings'].append({'id': 'semantic-' + hashlib.sha256(identity.encode()).hexdigest()[:16],
                    'rule_id': rule['id'], 'rule_version': rule['version'], 'title': rule['name'],
                    'category': rule.get('category', 'general'), 'severity': finding.severity,
                    'media_type': finding.media_type, 'content_reference': 'Marketing copy' if finding.media_type == 'text' else media['filename'],
                    'matched': finding.excerpt, 'message': finding.explanation, 'suggestion': finding.suggested_correction,
                    'source': rule['source'], 'evidence': rule['evidence'], 'confidence': confidence,
                    'evidence_type': evidence_type, 'timestamp_seconds': finding.timestamp_seconds,
                    'review_status': 'pending', 'platform': 'All platforms', 'origin': 'semantic', 'fix': fix})
    except (nemotron.AnalysisUnavailable, InvalidMedia) as error:
        result['analysis'].update(status='failed', code=getattr(error, 'code', 'unsupported_media'), message=str(error))
    complete = result['analysis']['status'] == 'complete'
    result['passed'] = complete and not result['findings']
    result['score'] = (0 if any(f['id'] == 'setup' for f in result['findings']) else max(0, 100 - 15 * len(result['findings']))) if complete else None
    for platform in result['platforms']:
        platform['passed'] = complete and not any(finding['platform'] in ('All platforms', platform['name']) for finding in result['findings'])
    return result
