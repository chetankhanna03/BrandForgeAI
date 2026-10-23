import base64

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


DETAILS = {'name': 'Bloom Studio', 'product': 'Handmade skincare', 'industry': 'Beauty',
           'tagline': 'Care, naturally.', 'website': 'bloom.studio', 'platforms': ['Instagram', 'Website']}
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=')


def create(client, **changes):
    response = client.post('/api/brands', json={**DETAILS, **changes})
    assert response.status_code == 201
    profile = response.json()
    return profile, {'X-Brand-ID': profile['id']}


def test_new_brand_is_persistent_and_isolated_from_demo(client):
    demo_draft = client.post('/api/drafts', json=GOOD).json()['id']
    profile, headers = create(client)
    workspace = client.get('/api/workspace', headers=headers).json()
    assert workspace['profile'] == profile
    assert workspace['rules'] == workspace['drafts'] == workspace['history'] == []
    assert len(client.get('/api/workspace').json()['rules']) == 6
    assert client.get('/api/workspace').json()['drafts'][0]['id'] == demo_draft
    result = client.post('/api/analyze', headers=headers, json=GOOD).json()
    assert result['findings'][0]['title'] == 'No active text rules'
    rule = {'name': 'Footer', 'kind': 'required', 'value': 'Bloom with care.', 'evidence': 'Our brand footer.', 'source': 'Brand owner', 'approved': True}
    client.post('/api/rules', json=rule, headers=headers)
    assert len(client.get('/api/workspace', headers=headers).json()['rules']) == 1
    assert client.get('/api/workspace').json()['drafts'][0]['status'] == 'draft'
    assert client.post(f'/api/drafts/{demo_draft}/review', headers=headers, json={'action': 'approve'}).status_code == 404
    other, other_headers = create(client, name='Another brand')
    assert other['id'] != profile['id']
    assert client.get('/api/workspace', headers=other_headers).json()['rules'] == []
    assert len(client.get('/api/brands').json()['brands']) == 3


def test_brand_validation_and_editing(client):
    for invalid in ({'name': '   '}, {'product': ''}, {'platforms': []}, {'platforms': ['Instagram', 'Instagram']}, {'platforms': ['Unknown']}):
        assert client.post('/api/brands', json={**DETAILS, **invalid}).status_code == 422
    profile, headers = create(client, platforms=['LinkedIn'])
    response = client.put(f'/api/brands/{profile["id"]}', json={**DETAILS, 'name': 'Bloom & Co'}, headers=headers)
    assert response.status_code == 200
    assert client.get('/api/workspace', headers=headers).json()['profile']['name'] == 'Bloom & Co'
    assert client.put('/api/brands/demo', json=DETAILS).status_code == 409
    for invalid in ('../outside', 'a' * 32):
        assert client.get('/api/workspace', headers={'X-Brand-ID': invalid}).status_code == 404


def test_media_is_saved_with_draft_and_scoped_to_brand(client):
    _, headers = create(client)
    response = client.post('/api/media', headers=headers, files={'file': ('creative.png', PNG, 'image/png')})
    assert response.status_code == 201
    media = response.json()
    assert media['kind'] == 'image'
    assert client.get(media['url']).content == PNG
    assert client.get(f'/api/media/{media["id"]}').status_code == 404
    assert client.post('/api/drafts', json={**GOOD, 'media_id': media['id']}).status_code == 422
    saved = client.post('/api/drafts', headers=headers, json={**GOOD, 'media_id': media['id']})
    assert saved.status_code == 200
    workspace = client.get('/api/workspace', headers=headers).json()
    assert workspace['drafts'][0]['media_id'] == media['id']
    assert workspace['media'] == [media]


def test_video_range_requests_and_upload_validation(client, tiny_mp4):
    video = tiny_mp4()
    media = client.post('/api/media', files={'file': ('clip.mp4', video, 'video/mp4')}).json()
    assert media['kind'] == 'video'
    response = client.get(media['url'], headers={'Range': 'bytes=4-11'})
    assert response.status_code == 206
    assert response.content == video[4:12]
    assert response.headers['content-range'] == f'bytes 4-11/{len(video)}'
    assert client.get(media['url'], headers={'Range': f'bytes={len(video) + 1}-'}).status_code == 416
    assert client.post('/api/media', files={'file': ('empty.png', b'', 'image/png')}).status_code == 422
    assert client.post('/api/media', files={'file': ('fake.png', b'<script>bad</script>', 'image/png')}).status_code == 422
    assert client.post('/api/media', files={'file': ('large.mp4', b'x' * (10 * 1024 * 1024 + 1), 'video/mp4')}).status_code == 413
