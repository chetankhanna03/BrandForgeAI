import pytest
from fastapi.testclient import TestClient
from backend import main


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', str(tmp_path / 'test.db'))
    monkeypatch.setenv('BRANDFORGE_DETERMINISTIC_ONLY', 'true')
    main.initialize()
    with TestClient(main.app, client=('127.0.0.1', 50000)) as client:
        assert client.post('/api/auth/setup', json={'username': 'owner', 'password': 'test-owner-password-123'}).status_code == 201
        yield client


GOOD = {'title': 'Campaign', 'content': 'Volt One: 400 km of range from $29,999. Actual range may vary.', 'platforms': ['Instagram', 'LinkedIn', 'Website']}


def test_evidence_and_corrections(client):
    response = client.post('/api/analyze', json={**GOOD, 'content': 'The best in the world. 500 km for $25,000.'})
    assert response.status_code == 200
    findings = response.json()['findings']
    assert {f['title'] for f in findings} == {'Product range', 'Starting price', 'Unapproved claims', 'Range disclaimer'}
    assert all(f['source'] and f['evidence'] for f in findings)
    assert client.post('/api/analyze', json=GOOD).json()['findings'] == []


def test_approval_and_rule_change(client):
    draft_id = client.post('/api/drafts', json=GOOD).json()['id']
    assert client.post(f'/api/drafts/{draft_id}/review', json={'action': 'approve'}).status_code == 409
    assert client.post(f'/api/drafts/{draft_id}/review', json={'action': 'submit'}).json()['status'] == 'pending'
    assert client.post(f'/api/drafts/{draft_id}/review', json={'action': 'approve'}).json()['status'] == 'approved'
    rule = client.get('/api/workspace').json()['rules'][0]
    rule.update(value='350', evidence='Updated approved range is 350 km.')
    assert client.put(f'/api/rules/{rule["id"]}', json=rule).json()['affected_drafts'] == 1
    assert client.get('/api/workspace').json()['drafts'][0]['status'] == 'needs_review'
    assert client.post(f'/api/drafts/{draft_id}/review', json={'action': 'submit'}).status_code == 409
    result = client.post(f'/api/drafts/{draft_id}/review', json={'action': 'recheck'}).json()
    assert result['results']['findings'][0]['suggestion'] == '350 km'


def test_failed_copy_cannot_be_submitted(client):
    draft = client.post('/api/drafts', json={**GOOD, 'content': '500 km. Crazy cheap.'}).json()
    assert client.post(f'/api/drafts/{draft["id"]}/review', json={'action': 'submit'}).status_code == 409


def test_new_rules_also_invalidate_passing_drafts(client):
    client.post('/api/drafts', json=GOOD)
    result = client.post('/api/rules', json={'name': 'Footer', 'kind': 'required', 'value': 'Terms apply.', 'evidence': 'All campaigns must include Terms apply.', 'source': 'New guideline', 'approved': True})
    assert result.status_code == 200
    assert client.get('/api/workspace').json()['drafts'][0]['status'] == 'needs_review'


def test_extraction_needs_review_and_cites_file(client):
    response = client.post('/api/extract', files={'file': ('brand.txt', b'Approved range: 350 km\nStarting price: $29,999\nPrimary color: #c5f277\nDisclaimer: Terms apply.\nAvoid: cheap, crazy', 'text/plain')})
    candidates = response.json()['candidates']
    assert len(candidates) == 5
    assert all(not c['approved'] and 'Page 1' in c['source'] for c in candidates)
    assert len(client.get('/api/workspace').json()['rules']) == 6


def test_platform_length_and_invalid_inputs(client):
    result = client.post('/api/analyze', json={**GOOD, 'content': 'A' * 2500}).json()
    assert [p['passed'] for p in result['platforms']] == [False, True, True]
    assert client.post('/api/analyze', json={**GOOD, 'platforms': []}).status_code == 422
    rule = client.get('/api/workspace').json()['rules'][0]
    assert client.put('/api/rules/1', json={**rule, 'value': 'NaN'}).status_code == 422


def test_pdf_extraction(client):
    import pymupdf
    with pymupdf.open() as document:
        page = document.new_page()
        page.insert_text((72, 72), 'Approved product range: 400 km')
        data = document.tobytes()
    result = client.post('/api/extract', files={'file': ('guide.pdf', data, 'application/pdf')})
    assert result.status_code == 200
    assert result.json()['candidates'][0]['value'] == '400'


def test_invalid_and_empty_pdf(client):
    assert client.post('/api/extract', files={'file': ('guide.pdf', b'not a pdf', 'application/pdf')}).status_code == 422
    assert client.post('/api/extract', files={'file': ('guide.exe', b'content')}).status_code == 422


@pytest.mark.parametrize('content', [' ', '\n\t', ''])
def test_blank_copy_rejected(client, content):
    assert client.post('/api/drafts', json={**GOOD, 'content': content}).status_code == 422


@pytest.mark.parametrize('field', ['name', 'value', 'evidence', 'source'])
def test_blank_rule_fields_rejected(client, field):
    rule = client.get('/api/workspace').json()['rules'][0]
    assert client.put('/api/rules/1', json={**rule, field: '   '}).status_code == 422


@pytest.mark.parametrize('content', ['-400 km', '500 kilometres', '500 kilometers', '500 KM', '500\nkm', '4,00 km'])
def test_range_notation_checks(client, content):
    findings = client.post('/api/analyze', json={**GOOD, 'content': content}).json()['findings']
    assert 'Product range' in {f['title'] for f in findings}


@pytest.mark.parametrize('content', ['$25000.', 'USD 25,000', '25,000 USD', '$-29,999', '$29,99', '$29,999.50'])
def test_price_notation_checks(client, content):
    findings = client.post('/api/analyze', json={**GOOD, 'content': content}).json()['findings']
    assert 'Starting price' in {f['title'] for f in findings}


@pytest.mark.parametrize('value', ['NaN', 'Infinity', '-1', '29,999', '1e4', '1000000000000'])
def test_invalid_fact_values(client, value):
    rule = client.get('/api/workspace').json()['rules'][0]
    assert client.put('/api/rules/1', json={**rule, 'value': value}).status_code == 422


def test_valid_decimal_prices_are_not_truncated(client):
    rule = client.get('/api/workspace').json()['rules'][1]
    assert client.put('/api/rules/2', json={**rule, 'value': '29999.95'}).status_code == 200
    results = client.post('/api/analyze', json={**GOOD, 'content': '$25,000.'}).json()
    assert results['findings'][0]['suggestion'] == '$29,999.95'
    assert client.post('/api/analyze', json={**GOOD, 'content': '$29,999.95.'}).json()['findings'] == []


def test_unchanged_rule_does_not_invalidate_or_increment(client):
    draft_id = client.post('/api/drafts', json=GOOD).json()['id']
    rule = client.get('/api/workspace').json()['rules'][0]
    assert client.put('/api/rules/1', json=rule).json() == {'updated': False, 'affected_drafts': 0}
    workspace = client.get('/api/workspace').json()
    assert workspace['drafts'][0]['id'] == draft_id
    assert workspace['drafts'][0]['status'] == 'draft'
    assert workspace['rules'][0]['version'] == rule['version']


def test_conflicting_approved_fact_blocked(client):
    rule = client.get('/api/workspace').json()['rules'][0]
    assert client.post('/api/rules', json={**rule, 'value': '350'}).status_code == 409
    unconfirmed = client.post('/api/rules', json={**rule, 'value': '350', 'approved': False})
    assert unconfirmed.status_code == 200
    assert client.put(f'/api/rules/{unconfirmed.json()["id"]}', json={**rule, 'value': '350'}).status_code == 409
    assert len(client.get('/api/workspace').json()['rules']) == 7


def test_stale_rule_edit_blocked(client):
    rule = client.get('/api/workspace').json()['rules'][0]
    assert client.put('/api/rules/1', json={**rule, 'value': '350'}).status_code == 200
    assert client.put('/api/rules/1', json={**rule, 'value': '300'}).status_code == 409
    assert client.get('/api/workspace').json()['rules'][0]['value'] == '350'


@pytest.mark.parametrize('status', ['pending', 'approved', 'changes_requested'])
def test_recheck_preserves_review_decision(client, status):
    draft_id = client.post('/api/drafts', json=GOOD).json()['id']
    path = f'/api/drafts/{draft_id}/review'
    client.post(path, json={'action': 'submit'})
    if status == 'approved':
        client.post(path, json={'action': 'approve'})
    elif status == 'changes_requested':
        client.post(path, json={'action': 'request_changes', 'note': 'Please make the introduction shorter.'})
    assert client.post(path, json={'action': 'recheck'}).json()['status'] == status


def test_review_transition_guards_and_notes(client):
    draft_id = client.post('/api/drafts', json=GOOD).json()['id']
    path = f'/api/drafts/{draft_id}/review'
    assert client.post(path, json={'action': 'request_changes', 'note': 'Shorten it.'}).status_code == 409
    client.post(path, json={'action': 'submit'})
    assert client.post(path, json={'action': 'submit'}).status_code == 409
    assert client.post(path, json={'action': 'request_changes', 'note': '  '}).status_code == 422
    assert client.post(path, json={'action': 'request_changes', 'note': 'Shorten it.'}).json()['status'] == 'changes_requested'
    assert client.get('/api/workspace').json()['history'][0]['note'] == 'Shorten it.'
    client.post(path, json={'action': 'submit'})
    client.post(path, json={'action': 'approve'})
    assert client.post(path, json={'action': 'submit'}).status_code == 409


def test_renamed_disclaimer_keeps_condition(client):
    rule = client.get('/api/workspace').json()['rules'][3]
    assert client.put('/api/rules/4', json={**rule, 'name': 'Legal footer'}).status_code == 200
    assert client.post('/api/analyze', json={**GOOD, 'content': 'Thoughtfully electric.'}).json()['findings'] == []
    assert client.post('/api/analyze', json={**GOOD, 'content': '400 km.'}).json()['findings'][0]['title'] == 'Legal footer'


def test_phrase_boundaries_whitespace_and_no_empty_phrase_matches(client):
    result = client.post('/api/analyze', json={**GOOD, 'content': 'BEST  IN\nTHE WORLD, crazy!'}).json()
    assert {f['title'] for f in result['findings']} == {'Brand voice', 'Unapproved claims'}
    assert client.post('/api/analyze', json={**GOOD, 'content': 'Cheapest is not the configured prohibited word.'}).json()['findings'] == []
    rule = client.get('/api/workspace').json()['rules'][4]
    assert client.put('/api/rules/5', json={**rule, 'value': '|   |'}).status_code == 422
    assert client.put('/api/rules/5', json={**rule, 'value': 'cheap| |CRAZY|cheap'}).status_code == 200
    assert client.get('/api/workspace').json()['rules'][4]['value'] == 'cheap|crazy'


def test_no_active_rules_cannot_false_pass(client):
    for rule in client.get('/api/workspace').json()['rules']:
        client.put(f'/api/rules/{rule["id"]}', json={**rule, 'approved': False})
    result = client.post('/api/analyze', json=GOOD).json()
    assert result['score'] == 0
    assert result['findings'][0]['title'] == 'No active text rules'
    draft_id = client.post('/api/drafts', json=GOOD).json()['id']
    assert client.post(f'/api/drafts/{draft_id}/review', json={'action': 'submit'}).status_code == 409


def test_invalid_platforms_titles_and_unknown_records(client):
    for payload in [{**GOOD, 'title': ' '}, {**GOOD, 'title': 'a' * 121}, {**GOOD, 'platforms': ['Instagram', 'Instagram']}, {**GOOD, 'platforms': ['TikTok']}, {**GOOD, 'content': 'x' * 20001}]:
        assert client.post('/api/drafts', json=payload).status_code == 422
    assert client.post('/api/drafts/9999/review', json={'action': 'recheck'}).status_code == 404
    rule = client.get('/api/workspace').json()['rules'][0]
    assert client.put('/api/rules/9999', json=rule).status_code == 404


@pytest.mark.parametrize('platform,limit', [('Instagram', 2200), ('LinkedIn', 3000), ('Website', 5000)])
def test_exact_platform_limit_and_one_over(client, platform, limit):
    assert client.post('/api/analyze', json={**GOOD, 'content': 'a' * limit, 'platforms': [platform]}).json()['findings'] == []
    result = client.post('/api/analyze', json={**GOOD, 'content': 'a' * (limit + 1), 'platforms': [platform]}).json()
    assert result['findings'][0]['title'] == 'Content length'
    assert result['findings'][0]['fix'] is None


def test_fix_offsets_refer_to_correct_occurrence(client):
    content = '  ⚡ 🚗 500 km then 500 km. Actual range may vary.  '
    findings = client.post('/api/analyze', json={**GOOD, 'content': content}).json()['findings']
    assert len(findings) == 2
    for finding in findings:
        fix = finding['fix']
        assert content[fix['start']:fix['end']] == '500 km'
    assert findings[0]['fix']['start'] != findings[1]['fix']['start']


def test_upload_boundaries_and_deduplication(client):
    for data in [b'', b'  \n', b'\xff\xfe\x00']:
        assert client.post('/api/extract', files={'file': ('guide.txt', data)}).status_code == 422
    assert client.post('/api/extract', files={'file': ('guide.txt', b'x' * (10 * 1024 * 1024 + 1))}).status_code == 413
    result = client.post('/api/extract', files={'file': ('guide.md', b'Range: 400.5 km\nRange: 400.5 km\nStarting price: $29999.95')}).json()
    assert [c['value'] for c in result['candidates']] == ['400.5', '29999.95']
    assert not result['truncated']


def test_scanned_and_too_many_pages(client):
    import pymupdf
    with pymupdf.open() as document:
        document.new_page()
        scanned = document.tobytes()
        for _ in range(100):
            document.new_page()
        large = document.tobytes()
    response = client.post('/api/extract', files={'file': ('scanned.pdf', scanned)})
    assert response.status_code == 422
    assert 'OCR' in response.json()['detail']
    assert client.post('/api/extract', files={'file': ('too-long.pdf', large)}).status_code == 422


def test_color_validation_and_deactivating_rule(client):
    rule = client.get('/api/workspace').json()['rules'][5]
    assert client.put('/api/rules/6', json={**rule, 'value': 'red'}).status_code == 422
    draft_id = client.post('/api/drafts', json=GOOD).json()['id']
    rule = client.get('/api/workspace').json()['rules'][0]
    client.put('/api/rules/1', json={**rule, 'approved': False})
    assert client.get('/api/workspace').json()['drafts'][0]['status'] == 'needs_review'
    assert client.post(f'/api/drafts/{draft_id}/review', json={'action': 'submit'}).status_code == 409


def test_drafts_survive_reinitialization(client):
    client.post('/api/drafts', json=GOOD)
    main.initialize()
    assert len(client.get('/api/workspace').json()['drafts']) == 1
    assert len(client.get('/api/workspace').json()['rules']) == 6
