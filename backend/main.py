"""BrandForge workspace API: deterministic and NVIDIA multimodal compliance."""
import hashlib
import json
import os
import re
import sqlite3
import uuid
from contextvars import ContextVar
from decimal import Decimal, InvalidOperation
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import time
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, UploadFile, Request, Response
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator, ValidationError
from dotenv import load_dotenv

from . import nemotron
from .ai_schemas import Category, Severity
from .auth import install_auth
from .compliance import build_report, checked_rules
from .media_processing import inspect_image, inspect_video, InvalidMedia

load_dotenv(Path(__file__).with_name('.env'), override=False)

DB_PATH = os.getenv('BRANDFORGE_DB', str(Path(__file__).with_name('brandforge.db')))
app = FastAPI(title='BrandForge AI', version='0.1.0')
PLATFORMS = {'Instagram': 2200, 'LinkedIn': 3000, 'Website': 5000}
SEED_RULES = [
    ('Product range', 'fact', '400', 'km', 'Volt One has an approved driving range of 400 km.', 'Volt One · Product specification §2.1'),
    ('Starting price', 'fact', '29999', 'USD', 'Volt One starts at $29,999.', 'Volt One · Product specification §2.2'),
    ('Unapproved claims', 'prohibited', 'zero emissions|best in the world|100% sustainable', '', 'Avoid absolute environmental and superiority claims.', 'Brand guidelines · Claims §4.1'),
    ('Range disclaimer', 'required', 'Actual range may vary.', '', 'Range claims must include: Actual range may vary.', 'Brand guidelines · Disclaimers §4.3'),
    ('Brand voice', 'prohibited', 'cheap|insane|crazy', '', 'Use a confident, thoughtful voice. Avoid cheap, insane and crazy.', 'Brand guidelines · Voice §3.1'),
    ('Primary color', 'color', '#c5f277', '', 'Primary brand color is #c5f277.', 'Brand guidelines · Visual identity §1.2'),
]
ACTIVE_BRAND = ContextVar('active_brand', default='demo')
DEMO_NAMESPACE = ContextVar('demo_namespace', default=None)
DEMO_BRAND = {'id': 'demo', 'name': 'Volt', 'product': 'Volt One', 'industry': 'Electric vehicles',
              'tagline': 'The everyday, electrified', 'website': 'volt.auto',
              'platforms': list(PLATFORMS), 'is_demo': True}


@contextmanager
def db(catalog=False, owner_catalog=False):
    brand_id = 'demo' if catalog else ACTIVE_BRAND.get()
    path = Path(DB_PATH)
    namespace = None if owner_catalog else DEMO_NAMESPACE.get()
    if namespace:
        path = path.with_name(f'{path.stem}.judge-{namespace}.db')
    if brand_id != 'demo':
        path = path.with_name(f'{path.stem}.brand-{brand_id}.db')
    connection = sqlite3.connect(str(path))
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def initialize():
    with db() as c:
        c.executescript('''CREATE TABLE IF NOT EXISTS rules (
          id INTEGER PRIMARY KEY, name TEXT, kind TEXT, value TEXT, unit TEXT,
          evidence TEXT, source TEXT, approved INTEGER DEFAULT 1, version INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS drafts (
          id INTEGER PRIMARY KEY, title TEXT, content TEXT, platforms TEXT, status TEXT,
          results TEXT, dependencies TEXT, updated_at TEXT);
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY, draft_id INTEGER, action TEXT, note TEXT, created_at TEXT);
        CREATE TABLE IF NOT EXISTS brands (
          id TEXT PRIMARY KEY, profile TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS media (
          id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS analysis_reports (
          id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS owner_account (
          id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, salt TEXT NOT NULL,
          password_hash TEXT NOT NULL, role TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts (address TEXT NOT NULL, attempted_at REAL NOT NULL);''')
        c.execute('CREATE TABLE IF NOT EXISTS demo_sessions (token_hash TEXT PRIMARY KEY, namespace TEXT NOT NULL, expires REAL NOT NULL)')
        if ACTIVE_BRAND.get() == 'demo' and not c.execute('SELECT COUNT(*) FROM rules').fetchone()[0]:
            c.executemany('INSERT INTO rules (name,kind,value,unit,evidence,source) VALUES (?,?,?,?,?,?)', SEED_RULES)
        if 'applies_when' not in {row['name'] for row in c.execute('PRAGMA table_info(rules)')}:
            c.execute("ALTER TABLE rules ADD COLUMN applies_when TEXT NOT NULL DEFAULT 'always'")
            c.execute("UPDATE rules SET applies_when='range_claim' WHERE kind='required' AND name='Range disclaimer'")
        if 'media_id' not in {row['name'] for row in c.execute('PRAGMA table_info(drafts)')}:
            c.execute('ALTER TABLE drafts ADD COLUMN media_id TEXT')
        for column, definition in {'category': "TEXT NOT NULL DEFAULT 'general'", 'severity': "TEXT NOT NULL DEFAULT 'error'", 'rationale': "TEXT NOT NULL DEFAULT ''"}.items():
            if column not in {row['name'] for row in c.execute('PRAGMA table_info(rules)')}:
                c.execute(f'ALTER TABLE rules ADD COLUMN {column} {definition}')
        for draft in c.execute('SELECT id,results FROM drafts').fetchall():
            result = json.loads(draft['results'])
            if 'analysis' not in result:
                result.update(score=None, passed=False, analysis={'status': 'not_requested',
                    'message': 'This draft predates multimodal analysis. Recheck it before approval.'})
                for platform in result.get('platforms', []):
                    platform['passed'] = False
                c.execute("UPDATE drafts SET status='needs_review',results=? WHERE id=?", (json.dumps(result), draft['id']))


initialize()


@app.middleware('http')
async def brand_context(request: Request, call_next):
    brand_id = request.headers.get('X-Brand-ID', 'demo')
    if request.url.path.startswith('/api/media/'):
        brand_id = request.query_params.get('brand_id', brand_id)
    if brand_id != 'demo':
        if not re.fullmatch(r'[0-9a-f]{32}', brand_id):
            return JSONResponse(status_code=404, content={'detail': 'Brand not found.'})
        with db(catalog=True) as c:
            if not c.execute('SELECT 1 FROM brands WHERE id=?', (brand_id,)).fetchone():
                return JSONResponse(status_code=404, content={'detail': 'Brand not found.'})
    token = ACTIVE_BRAND.set(brand_id)
    try:
        if brand_id != 'demo':
            # Also migrate existing brand databases on first access after an upgrade.
            initialize()
        return await call_next(request)
    finally:
        ACTIVE_BRAND.reset(token)


def initialize_judge_demo(namespace):
    namespace_token = DEMO_NAMESPACE.set(namespace)
    brand_token = ACTIVE_BRAND.set('demo')
    try:
        initialize()
    finally:
        ACTIVE_BRAND.reset(brand_token)
        DEMO_NAMESPACE.reset(namespace_token)


install_auth(app, lambda: db(catalog=True, owner_catalog=True), DEMO_NAMESPACE, initialize_judge_demo)


@app.exception_handler(RequestValidationError)
async def validation_error(request, error):
    return JSONResponse(status_code=422, content={'detail': [
        {key: item[key] for key in ('loc', 'msg', 'type') if key in item}
        for item in error.errors()]})


def active_profile():
    if ACTIVE_BRAND.get() == 'demo':
        return DEMO_BRAND
    with db(catalog=True) as c:
        return json.loads(c.execute('SELECT profile FROM brands WHERE id=?', (ACTIVE_BRAND.get(),)).fetchone()['profile'])


def now():
    return datetime.now(timezone.utc).isoformat()


def rules_from(c):
    return [dict(row) for row in c.execute('SELECT * FROM rules ORDER BY id')]


def evaluate(content, platforms, rules):
    findings, dependencies = [], {}
    number = r'[+-]?\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?'
    range_pattern = rf'(?<![\w.,])({number})\s*(?:km|kilometers?|kilometres?)\b'
    def add(rule, message, suggestion, matched='', severity='error', platform='All platforms', fix=None):
        findings.append({'id': f'{rule["id"]}-{len(findings)}', 'rule_id': rule['id'],
                         'title': rule['name'], 'message': message, 'suggestion': suggestion,
                         'matched': matched, 'severity': severity, 'platform': platform,
                         'source': rule['source'], 'evidence': rule['evidence'], 'rule_version': rule['version'], 'fix': fix})
    for rule in rules:
        if not rule['approved']:
            continue
        # All approved rules are dependencies: adding a prohibited phrase or a required
        # disclaimer can invalidate a previously passing draft too.
        dependencies[str(rule['id'])] = rule['version']
        if rule['kind'] == 'fact':
            pattern = range_pattern if rule['unit'] == 'km' else rf'(?:\$\s*|\bUSD\s+)({number})(?![\d,]|\.\d)|(?<![\w.,])({number})\s+USD\b'
            for match in re.finditer(pattern, content, re.I):
                raw = next(group for group in match.groups() if group is not None)
                valid_grouping = ',' not in raw or re.fullmatch(r'[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?', raw)
                if not valid_grouping or Decimal(raw.replace(',', '')) != Decimal(rule['value']):
                    approved = Decimal(rule['value'])
                    replacement = f'{rule["value"]} km' if rule['unit'] == 'km' else f'${approved:,.2f}'.removesuffix('.00')
                    add(rule, f'“{match.group()}” does not match the approved {rule["name"].lower()}.', replacement, match.group(),
                        fix={'kind': 'replace', 'start': match.start(), 'end': match.end(), 'text': replacement})
        elif rule['kind'] == 'prohibited':
            for phrase in (p.strip() for p in rule['value'].split('|') if p.strip()):
                pattern = r'(?<!\w)' + r'\s+'.join(re.escape(word) for word in phrase.split()) + r'(?!\w)'
                for match in re.finditer(pattern, content, re.I):
                    add(rule, f'“{match.group()}” is not approved brand language.', 'Consider a precise, supported claim.', match.group())
        elif rule['kind'] == 'required':
            relevant = rule.get('applies_when', 'always') != 'range_claim' or re.search(range_pattern, content, re.I)
            phrase_pattern = r'(?<!\w)' + r'\s+'.join(re.escape(word) for word in rule['value'].split()) + r'(?!\w)'
            if relevant and not re.search(phrase_pattern, content, re.I):
                add(rule, 'A required disclaimer is missing.', rule['value'], fix={'kind': 'append', 'text': rule['value']})
    has_text_rules = any(rule['approved'] and rule['kind'] != 'color' for rule in rules)
    if not has_text_rules:
        findings.append({'id': 'setup', 'rule_id': None, 'title': 'No active text rules', 'message': 'Approve at least one text rule before checking content.', 'suggestion': 'Review and approve your brand rules in Guidelines & rules.', 'matched': '', 'severity': 'error', 'platform': 'All platforms', 'source': 'Workspace configuration', 'evidence': 'No approved product, language, or disclaimer rules are active.', 'rule_version': 1, 'fix': None})
    for platform in platforms:
        limit = PLATFORMS[platform]
        if len(content) > limit:
            findings.append({'id': f'limit-{platform}', 'rule_id': None, 'title': 'Content length', 'message': f'{len(content):,} characters exceeds the configured {limit:,}-character limit.', 'suggestion': f'Shorten to {limit:,} characters.', 'matched': '', 'severity': 'error', 'platform': platform, 'source': 'Workspace platform settings', 'evidence': f'{platform}: {limit:,} characters (demo configuration)', 'rule_version': 1, 'fix': None})
    errors = len(findings)
    return {'score': max(0, 100 - errors * 15) if has_text_rules else 0, 'findings': findings, 'dependencies': dependencies,
            'platforms': [{'name': p, 'passed': not any(f['platform'] in ('All platforms', p) for f in findings), 'limit': PLATFORMS[p]} for p in platforms],
            'checked_at': now(), 'engine': 'Deterministic rules v1 · text only'}


class CleanInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class DraftInput(CleanInput):
    title: str = Field(min_length=1, max_length=120)
    content: Annotated[str, StringConstraints(strip_whitespace=False)] = Field(min_length=0, max_length=20000)
    platforms: list[Literal['Instagram', 'LinkedIn', 'Website']] = Field(min_length=1, max_length=3)
    media_id: str | None = Field(default=None, pattern=r'^[0-9a-f]{32}$')
    report_id: str | None = Field(default=None, pattern=r'^[0-9a-f]{32}$')

    @model_validator(mode='after')
    def nonblank_content(self):
        if not self.content.strip() and not self.media_id:
            raise ValueError('Marketing copy cannot be blank unless an image or video is attached.')
        return self

    @field_validator('platforms')
    @classmethod
    def unique_platforms(cls, value):
        if len(set(value)) != len(value):
            raise ValueError('Select each platform only once.')
        return value


class RuleInput(CleanInput):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal['fact', 'prohibited', 'required', 'color', 'semantic']
    value: str = Field(min_length=1, max_length=2000)
    unit: str = Field(default='', max_length=20)
    evidence: str = Field(min_length=1, max_length=5000)
    source: str = Field(min_length=1, max_length=500)
    approved: bool = False
    applies_when: Literal['always', 'range_claim'] = 'always'
    version: int | None = Field(default=None, ge=1)
    category: Category = 'general'
    severity: Severity = 'error'
    rationale: str = Field(default='', max_length=2000)


class BrandInput(CleanInput):
    name: str = Field(min_length=1, max_length=80)
    product: str = Field(min_length=1, max_length=80)
    industry: str = Field(default='', max_length=100)
    tagline: str = Field(default='', max_length=160)
    website: str = Field(default='', max_length=200)
    platforms: list[Literal['Instagram', 'LinkedIn', 'Website']] = Field(min_length=1, max_length=3)

    @field_validator('platforms')
    @classmethod
    def unique_platforms(cls, value):
        if len(set(value)) != len(value):
            raise ValueError('Select each platform only once.')
        return value


@app.get('/api/brands')
def list_brands():
    with db(catalog=True) as c:
        return {'brands': [DEMO_BRAND, *[json.loads(row['profile']) for row in c.execute('SELECT profile FROM brands ORDER BY rowid')]]}


@app.post('/api/brands', status_code=201)
def create_brand(payload: BrandInput):
    profile = {**payload.model_dump(), 'id': uuid.uuid4().hex, 'is_demo': False}
    token = ACTIVE_BRAND.set(profile['id'])
    try:
        initialize()
    finally:
        ACTIVE_BRAND.reset(token)
    with db(catalog=True) as c:
        c.execute('INSERT INTO brands (id,profile) VALUES (?,?)', (profile['id'], json.dumps(profile)))
    return profile


@app.put('/api/brands/{brand_id}')
def update_brand(brand_id: str, payload: BrandInput):
    if brand_id == 'demo':
        raise HTTPException(409, 'Keep the Volt One example as a demo. Create your own brand instead.')
    profile = {**payload.model_dump(), 'id': brand_id, 'is_demo': False}
    with db(catalog=True) as c:
        if not c.execute('SELECT 1 FROM brands WHERE id=?', (brand_id,)).fetchone():
            raise HTTPException(404, 'Brand not found.')
        c.execute('UPDATE brands SET profile=? WHERE id=?', (json.dumps(profile), brand_id))
    return profile


@app.post('/api/demo/workspace', status_code=201)
def create_demo_workspace():
    """Create an isolated, explicitly requested judge fixture; never reset user data."""
    profile = {**DEMO_BRAND, 'id': uuid.uuid4().hex, 'name': 'Volt Demo Lab',
               'is_demo': False, 'demo_fixture': 'volt-v1'}
    token = ACTIVE_BRAND.set(profile['id'])
    try:
        initialize()
        with db() as c:
            c.executemany('INSERT INTO rules (name,kind,value,unit,evidence,source) VALUES (?,?,?,?,?,?)', SEED_RULES)
            c.execute("UPDATE rules SET applies_when='range_claim' WHERE name='Range disclaimer'")
    finally:
        ACTIVE_BRAND.reset(token)
    with db(catalog=True) as c:
        c.execute('INSERT INTO brands (id,profile) VALUES (?,?)', (profile['id'], json.dumps(profile)))
    return profile


def media_details(row):
    return {'id': row['id'], 'filename': row['filename'], 'mime': row['mime'],
            'kind': 'video' if row['mime'].startswith('video/') else 'image',
            'url': f'/api/media/{row["id"]}?brand_id={ACTIVE_BRAND.get()}'}


@app.post('/api/media', status_code=201)
async def upload_media(file: UploadFile):
    data = await file.read(10 * 1024 * 1024 + 1)
    if not data:
        raise HTTPException(422, 'Choose an image or video that is not empty.')
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, 'Choose an image or video no larger than 10 MB.')
    mime = None
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        mime = 'image/png'
    elif data.startswith(b'\xff\xd8\xff'):
        mime = 'image/jpeg'
    elif data.startswith((b'GIF87a', b'GIF89a')):
        mime = 'image/gif'
    elif data.startswith(b'RIFF') and data[8:12] == b'WEBP':
        mime = 'image/webp'
    elif data[4:8] == b'ftyp' and len(data) >= 12:
        mime = 'video/quicktime' if data[8:12] == b'qt  ' else 'video/mp4'
    elif data.startswith(b'\x1a\x45\xdf\xa3') and b'webm' in data[:4096]:
        mime = 'video/webm'
    if not mime:
        raise HTTPException(422, 'Supported media: PNG, JPEG, GIF, WebP, MP4, WebM, MOV. The file contents must match a supported format.')
    if mime in ('image/png', 'image/jpeg', 'video/mp4'):
        try:
            await run_in_threadpool(inspect_video if mime == 'video/mp4' else inspect_image, data)
        except InvalidMedia as error:
            raise HTTPException(422, str(error)) from None
    filename = (file.filename or 'creative').replace('\\', '/').rsplit('/', 1)[-1][:200]
    item = {'id': uuid.uuid4().hex, 'filename': filename, 'mime': mime}
    with db() as c:
        c.execute('INSERT INTO media (id,filename,mime,data) VALUES (?,?,?,?)', (item['id'], filename, mime, data))
    return media_details(item)


@app.get('/api/media/{media_id}')
def read_media(media_id: str, request: Request):
    with db() as c:
        row = c.execute('SELECT * FROM media WHERE id=?', (media_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Media not found in this brand.')
    data = row['data']
    headers = {'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600'}
    range_header = request.headers.get('range')
    if range_header:
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', range_header)
        if not match or not any(match.groups()):
            return Response(status_code=416, headers={'Content-Range': f'bytes */{len(data)}'})
        first, last = match.groups()
        start = int(first) if first else max(0, len(data) - int(last))
        end = min(int(last), len(data) - 1) if first and last else len(data) - 1
        if start >= len(data) or start > end:
            return Response(status_code=416, headers={'Content-Range': f'bytes */{len(data)}'})
        headers['Content-Range'] = f'bytes {start}-{end}/{len(data)}'
        return Response(data[start:end + 1], status_code=206, media_type=row['mime'], headers=headers)
    return Response(data, media_type=row['mime'], headers=headers)


def validate_rule(rule):
    if rule.kind == 'fact':
        if rule.unit not in ('km', 'USD'):
            raise HTTPException(422, 'Fact rules currently support km and USD only.')
        try:
            if not re.fullmatch(r'\d+(?:\.\d+)?', rule.value):
                raise ValueError()
            value = Decimal(rule.value)
            if not 0 <= value < 1e12:
                raise ValueError()
        except (ValueError, InvalidOperation):
            raise HTTPException(422, 'Fact values must be finite, non-negative numbers without commas.')
    if rule.kind == 'color' and not re.fullmatch(r'#[0-9a-fA-F]{6}', rule.value):
        raise HTTPException(422, 'Use a six-digit hex color, for example #c5f277.')
    if rule.kind == 'prohibited':
        phrases = [' '.join(p.split()) for p in rule.value.split('|') if p.strip()]
        if not phrases:
            raise HTTPException(422, 'Enter at least one prohibited phrase.')
        rule.value = '|'.join(dict.fromkeys(p.casefold() for p in phrases))
    if rule.kind != 'fact':
        rule.unit = ''
    if rule.kind != 'required':
        rule.applies_when = 'always'


RULE_FIELDS = ('name', 'kind', 'value', 'unit', 'evidence', 'source', 'approved', 'applies_when', 'category', 'severity', 'rationale')


def prevent_conflict(c, rule, rule_id=None):
    if not rule.approved:
        return
    for other in rules_from(c):
        if other['id'] == rule_id or not other['approved'] or other['kind'] != rule.kind:
            continue
        if rule.kind == 'fact' and other['unit'] == rule.unit:
            raise HTTPException(409, f'An approved {rule.unit} fact already exists: {other["name"]}. Update that rule or unapprove it first.')
        if other['value'].casefold() == rule.value.casefold() and other['applies_when'] == rule.applies_when:
            raise HTTPException(409, f'This approved rule already exists: {other["name"]}. Update it instead.')


def invalidate(c):
    # Every draft is checked against the whole approved rule set, including newly added rules.
    c.execute("UPDATE drafts SET status='needs_review', updated_at=?", (now(),))


@app.get('/api/health')
def health():
    return {'status': 'ok'}


@app.post('/api/ai/check')
def check_nemotron():
    """Explicit, authenticated real text probe; configured is not proof of connectivity."""
    if nemotron.deterministic_only():
        return {'status': 'offline', 'code': 'offline_mode', 'message': 'Offline mode is enabled. Set BRANDFORGE_DETERMINISTIC_ONLY=false and restart the backend for Nemotron.', 'scope': 'text_connectivity'}
    try:
        report = nemotron.review({'copy': 'A thoughtfully designed everyday product.', 'platforms': ['Website'],
            'approved_rules': [{'id': 1, 'name': 'Unsupported claims', 'kind': 'prohibited', 'value': 'best in the world',
                'evidence': 'Avoid unsupported superiority claims.', 'source': 'Synthetic connection check', 'version': 1}],
            'deterministic_findings': []})
        if not report.text_reviewed:
            raise nemotron.AnalysisUnavailable('The model responded but did not confirm text coverage. Retry the check.', 'coverage')
        return {'status': 'ready', 'code': 'ok', 'message': 'Nemotron returned a valid text review. Check each poster or video separately to verify its media analysis.', 'scope': 'text_connectivity'}
    except nemotron.AnalysisUnavailable as error:
        return {'status': 'failed', 'code': error.code, 'message': str(error), 'scope': 'text_connectivity'}


@app.get('/api/workspace')
def workspace():
    with db() as c:
        drafts = []
        for row in c.execute('SELECT * FROM drafts ORDER BY updated_at DESC'):
            item = dict(row)
            for key in ('platforms', 'results', 'dependencies'):
                item[key] = json.loads(item[key])
            drafts.append(item)
        profile = active_profile()
        media = [media_details(row) for row in c.execute('SELECT id,filename,mime FROM media')]
        return {'brand': profile['name'], 'profile': profile, 'media': media, 'rules': rules_from(c), 'drafts': drafts,
                'ai': {'configured': nemotron.configured(), 'mode': 'deterministic_only' if nemotron.deterministic_only() else 'nemotron',
                       'model': nemotron.model_name()},
                'history': [dict(r) for r in c.execute('SELECT * FROM history ORDER BY id DESC LIMIT 30')]}


def perform_analysis(payload, force=False):
    with db() as c:
        rules = rules_from(c)
        media = c.execute('SELECT * FROM media WHERE id=?', (payload.media_id,)).fetchone() if payload.media_id else None
        if payload.media_id and not media:
            raise HTTPException(422, 'Upload the image or video in this brand before attaching it.')
        fingerprint = hashlib.sha256(json.dumps({
            'content': payload.content, 'platforms': payload.platforms, 'rules': [r for r in rules if r['approved']],
            'media': hashlib.sha256(media['data']).hexdigest() if media else None,
            'model': nemotron.model_name(), 'base_url': os.getenv('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1'),
            'offline': nemotron.deterministic_only(), 'engine_version': 3,
        }, sort_keys=True).encode()).hexdigest()
        if payload.report_id and not force:
            cached = c.execute('SELECT * FROM analysis_reports WHERE id=? AND fingerprint=? AND created>?',
                               (payload.report_id, fingerprint, time.time() - 900)).fetchone()
            if cached:
                return json.loads(cached['result'])
    result = build_report(payload, rules, dict(media) if media else None, evaluate)
    result['report_id'] = uuid.uuid4().hex
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        if result['dependencies'] != checked_rules(rules_from(c)):
            raise HTTPException(409, 'Brand rules changed during analysis. Run the check again.')
        c.execute('INSERT INTO analysis_reports (id,fingerprint,result,created) VALUES (?,?,?,?)',
                  (result['report_id'], fingerprint, json.dumps(result), time.time()))
    return result


@app.post('/api/analyze')
def analyze(payload: DraftInput):
    return perform_analysis(payload, force=True)


@app.post('/api/drafts')
def save_draft(payload: DraftInput):
    result = perform_analysis(payload)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        if result['dependencies'] != checked_rules(rules_from(c)):
            raise HTTPException(409, 'Brand rules changed. Check this draft again before saving.')
        cursor = c.execute('INSERT INTO drafts (title,content,platforms,status,results,dependencies,updated_at,media_id) VALUES (?,?,?,?,?,?,?,?)',
                         (payload.title, payload.content, json.dumps(payload.platforms), 'draft', json.dumps(result), json.dumps(result['dependencies']), now(), payload.media_id))
        return {'id': cursor.lastrowid, 'results': result}


class ReviewInput(BaseModel):
    action: Literal['submit', 'approve', 'request_changes', 'recheck']
    note: str = Field(default='', max_length=2000)


@app.post('/api/drafts/{draft_id}/review')
def review(draft_id: int, payload: ReviewInput):
    with db() as c:
        row = c.execute('SELECT * FROM drafts WHERE id=?', (draft_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Draft not found')
        previous = dict(row)
    result = perform_analysis(DraftInput(title=row['title'], content=row['content'], platforms=json.loads(row['platforms']),
                                        media_id=row['media_id'], report_id=json.loads(row['results']).get('report_id')),
                              force=payload.action == 'recheck')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT * FROM drafts WHERE id=?', (draft_id,)).fetchone()
        if dict(row) != previous or result['dependencies'] != checked_rules(rules_from(c)):
            raise HTTPException(409, 'This draft or its brand rules changed during review. Refresh and recheck.')
        if payload.action in ('submit', 'approve') and (result['analysis']['status'] != 'complete' or result['findings']):
            status = 'needs_review' if row['status'] in ('pending', 'approved') else row['status']
            c.execute('UPDATE drafts SET status=?,results=?,dependencies=?,updated_at=? WHERE id=?',
                      (status, json.dumps(result), json.dumps(result['dependencies']), now(), draft_id))
            # Persist the new failure before returning an error, so the previous
            # passing result cannot linger in the review queue after a failed check.
            c.commit()
            if result['analysis']['status'] != 'complete':
                raise HTTPException(409, 'Analysis is incomplete or unavailable. Recheck successfully before submitting or approving.')
            raise HTTPException(409, 'Resolve compliance findings before submitting or approving.')
        if payload.action == 'approve' and row['status'] != 'pending':
            raise HTTPException(409, 'Submit this draft for review before approving.')
        if payload.action == 'submit' and row['status'] not in ('draft', 'changes_requested'):
            raise HTTPException(409, 'Only a current draft or requested revision can be submitted. Recheck outdated drafts first.')
        if payload.action == 'request_changes' and row['status'] != 'pending':
            raise HTTPException(409, 'Only drafts awaiting approval can receive a change request.')
        if payload.action == 'request_changes' and not payload.note.strip():
            raise HTTPException(422, 'Add a review note explaining the requested changes.')
        if payload.action == 'recheck':
            # A harmless check must not discard a human approval or a revision request.
            status = row['status'] if row['status'] != 'needs_review' else 'draft'
            if (result['findings'] or result['analysis']['status'] != 'complete') and status in ('pending', 'approved'):
                status = 'needs_review'
        else:
            status = {'submit': 'pending', 'approve': 'approved', 'request_changes': 'changes_requested'}[payload.action]
        c.execute('UPDATE drafts SET status=?,results=?,dependencies=?,updated_at=? WHERE id=?', (status, json.dumps(result), json.dumps(result['dependencies']), now(), draft_id))
        c.execute('INSERT INTO history (draft_id,action,note,created_at) VALUES (?,?,?,?)', (draft_id, payload.action, payload.note, now()))
        return {'status': status, 'results': result}


class CorrectionReview(CleanInput):
    decision: Literal['accepted', 'rejected']


@app.post('/api/reports/{report_id}/findings/{finding_id}/review')
def review_correction(report_id: str, finding_id: str, payload: CorrectionReview):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT result FROM analysis_reports WHERE id=?', (report_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Report not found in this brand.')
        result = json.loads(row['result'])
        finding = next((f for f in result['findings'] if f['id'] == finding_id), None)
        if not finding:
            raise HTTPException(404, 'Finding not found.')
        finding.update(review_status=payload.decision, reviewed_at=now())
        c.execute('UPDATE analysis_reports SET result=? WHERE id=?', (json.dumps(result), report_id))
        # Accepting a correction records intent; it does not waive a violation or alter assets.
        for draft in c.execute('SELECT id,results FROM drafts').fetchall():
            if json.loads(draft['results']).get('report_id') == report_id:
                c.execute('UPDATE drafts SET results=? WHERE id=?', (json.dumps(result), draft['id']))
        return {'finding': finding, 'passed': result['passed']}


@app.post('/api/rules')
def create_rule(payload: RuleInput):
    validate_rule(payload)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        prevent_conflict(c, payload)
        cursor = c.execute(f'INSERT INTO rules ({",".join(RULE_FIELDS)}) VALUES ({",".join("?" for _ in RULE_FIELDS)})', tuple(getattr(payload, key) for key in RULE_FIELDS))
        if payload.approved:
            invalidate(c)
        return {'id': cursor.lastrowid}


@app.put('/api/rules/{rule_id}')
def update_rule(rule_id: int, payload: RuleInput):
    validate_rule(payload)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        old = c.execute('SELECT * FROM rules WHERE id=?', (rule_id,)).fetchone()
        if not old:
            raise HTTPException(404, 'Rule not found')
        if payload.version is not None and payload.version != old['version']:
            raise HTTPException(409, 'This rule changed since you opened it. Close the editor, retry the workspace connection, and reopen the latest rule.')
        if all(old[key] == getattr(payload, key) for key in RULE_FIELDS):
            return {'updated': False, 'affected_drafts': 0}
        prevent_conflict(c, payload, rule_id)
        c.execute(f'UPDATE rules SET {",".join(key + "=?" for key in RULE_FIELDS)},version=version+1 WHERE id=?', (*(getattr(payload, key) for key in RULE_FIELDS), rule_id))
        if old['approved'] or payload.approved:
            invalidate(c)
        return {'updated': True, 'affected_drafts': c.execute("SELECT COUNT(*) FROM drafts WHERE status='needs_review'").fetchone()[0]}


@app.post('/api/extract')
async def extract(file: UploadFile):
    data = await file.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, 'Upload a file smaller than 10 MB.')
    filename = (file.filename or 'guidelines.txt').replace('\\', '/').rsplit('/', 1)[-1]
    if len(filename) > 400:
        raise HTTPException(422, 'Use a filename shorter than 400 characters.')
    if not data:
        raise HTTPException(422, 'This file is empty. Upload guidelines containing selectable text.')
    visual_pages = []
    if filename.lower().endswith('.pdf'):
        try:
            import pymupdf
            with pymupdf.open(stream=data, filetype='pdf') as document:
                if len(document) > 100:
                    raise HTTPException(422, 'Use a guideline PDF with at most 100 pages.')
                pages = [(i + 1, page.get_text()) for i, page in enumerate(document)]
                if not nemotron.deterministic_only():
                    for index, page in enumerate(document):
                        if not pages[index][1].strip() or page.get_images() or page.get_drawings():
                            if len(visual_pages) >= 6:
                                raise HTTPException(422, 'Split guidelines into uploads with at most six image-based pages. No pages have been silently skipped.')
                            scale = min(1.6, 1400 / max(page.rect.width, page.rect.height))
                            png = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False).tobytes('png')
                            visual_pages.append((index + 1, png))
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, 'Could not read this PDF. Use a text-based, unencrypted PDF.')
    elif filename.lower().endswith(('.txt', '.md')):
        try:
            pages = [(1, data.decode('utf-8-sig'))]
        except UnicodeDecodeError:
            raise HTTPException(422, 'Save text guidelines using UTF-8 encoding and upload again.')
    else:
        raise HTTPException(422, 'Supported files: PDF, TXT, MD.')
    candidates = []
    for page, text in pages:
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            base = {'evidence': line[:5000], 'source': f'{filename} · Page {page}', 'approved': False, 'unit': '', 'applies_when': 'always'}
            match = re.search(r'\b(\d[\d,]*(?:\.\d+)?)\s*(?:km|kilometers?|kilometres?)\b', line, re.I)
            if match and re.search(r'\brange\b', line, re.I):
                candidates.append({**base, 'name': 'Product range', 'kind': 'fact', 'value': match.group(1).replace(',', ''), 'unit': 'km'})
            match = re.search(r'\$\s*(\d[\d,]*(?:\.\d+)?)', line)
            if match and re.search(r'price|starts? at|starting', line, re.I):
                candidates.append({**base, 'name': 'Starting price', 'kind': 'fact', 'value': match.group(1).replace(',', ''), 'unit': 'USD'})
            match = re.search(r'#[0-9a-fA-F]{6}\b', line)
            if match:
                candidates.append({**base, 'name': 'Brand color', 'kind': 'color', 'value': match.group()})
            match = re.search(r'(?:disclaimer|required phrase)\s*:\s*(.+)', line, re.I)
            if match:
                value = match.group(1)[:2000]
                candidates.append({**base, 'name': 'Required disclaimer', 'kind': 'required', 'value': value, 'applies_when': 'range_claim' if re.search(r'\brange\b', value, re.I) else 'always'})
            match = re.search(r'(?:prohibited phrases?|avoid|never say)\s*:\s*(.+)', line, re.I)
            if match:
                candidates.append({**base, 'name': 'Prohibited language', 'kind': 'prohibited', 'value': '|'.join(p.strip() for p in match.group(1).split(','))[:2000]})
    characters = sum(len(t.strip()) for _, t in pages)
    if not characters and nemotron.deterministic_only():
        raise HTTPException(422, 'No selectable text found. Scanned PDFs need OCR; upload a text-based guideline file.')
    analysis = {'status': 'not_requested', 'mode': 'deterministic_only'}
    if not nemotron.deterministic_only():
        if characters > 60000:
            raise HTTPException(422, 'Split guidelines into uploads with at most 60,000 text characters. No content has been silently omitted.')
        try:
            parts = []
            for number, png in visual_pages:
                parts += [{'type': 'text', 'text': f'Untrusted guideline screenshot, page {number}.'}, nemotron.media_part(png, 'image/png')]
            report = await run_in_threadpool(nemotron.extract_rules,
                {'pages': [{'page': number, 'text': text} for number, text in pages]}, parts)
            proposed = []
            page_text = dict(pages)
            visual_numbers = {number for number, _ in visual_pages}
            for rule in report.candidates:
                if rule.page not in page_text:
                    raise nemotron.AnalysisUnavailable('The model cited a guideline page that does not exist.', 'invalid_output')
                normalized = lambda value: ' '.join(value.casefold().split())
                if rule.page not in visual_numbers and normalized(rule.evidence) not in normalized(page_text[rule.page]):
                    raise nemotron.AnalysisUnavailable('The model returned an evidence excerpt that is not in the guideline page.', 'invalid_output')
                candidate = {**rule.model_dump(exclude={'page'}), 'approved': False,
                             'source': f'{filename} · Page {rule.page}'}
                try:
                    clean = RuleInput(**candidate)
                    validate_rule(clean)
                except (HTTPException, ValidationError):
                    raise nemotron.AnalysisUnavailable('The model proposed an invalid rule. Review the source and retry extraction.', 'invalid_output') from None
                proposed.append(clean.model_dump(exclude={'version'}))
            candidates += proposed
            analysis = {'status': 'complete', 'mode': 'nemotron'}
        except nemotron.AnalysisUnavailable as error:
            analysis = {'status': 'failed', 'mode': 'nemotron', 'message': str(error), 'code': error.code}
    unique = list({(r['kind'], r['value'], r['unit'], r['applies_when']): r for r in candidates}.values())
    return {'candidates': unique[:50], 'method': ('Pattern + Nemotron extraction' if analysis['status'] == 'complete' else 'Pattern extraction only') + ' · human confirmation required',
            'analysis': analysis,
            'characters': characters, 'truncated': len(unique) > 50, 'message': 'Review extracted candidates before adding them. Existing facts should be updated rather than duplicated.'}
