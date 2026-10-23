import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.auth import COOKIE

CREDS = {'username': 'owner', 'password': 'correct-password-for-tests'}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', str(tmp_path / 'auth.db'))
    monkeypatch.setenv('BRANDFORGE_DETERMINISTIC_ONLY', 'true')
    main.initialize()
    with TestClient(main.app, client=('127.0.0.1', 50100)) as client:
        yield client


def test_owner_setup_login_cookie_and_logout(client):
    assert client.get('/api/auth/status').json()['setup_required']
    response = client.post('/api/auth/setup', json=CREDS)
    assert response.status_code == 201
    assert 'HttpOnly' in response.headers['set-cookie'] and 'SameSite=strict' in response.headers['set-cookie']
    assert 'Path=/api' in response.headers['set-cookie']
    assert client.get('/api/workspace').status_code == 200
    assert client.post('/api/auth/setup', json=CREDS).status_code == 409
    assert client.post('/api/auth/logout').status_code == 200
    assert client.get('/api/workspace').status_code == 401
    assert client.post('/api/auth/login', json={**CREDS, 'password': 'incorrect-password'}).status_code == 401
    assert client.post('/api/auth/login', json=CREDS).status_code == 200
    assert client.get('/api/auth/status').json()['authenticated']
    with main.db(catalog=True) as c:
        stored = dict(c.execute('SELECT * FROM owner_account').fetchone())
        session = dict(c.execute('SELECT * FROM sessions').fetchone())
    assert CREDS['password'] not in str(stored)
    assert client.cookies.get(COOKIE) not in str(session)


@pytest.mark.parametrize('method,path', [('GET', '/api/workspace'), ('GET', '/api/brands'),
    ('POST', '/api/analyze'), ('POST', '/api/extract'), ('POST', '/api/media'),
    ('GET', '/api/media/any?brand_id=demo'), ('POST', '/api/drafts/1/review'),
    ('PUT', '/api/rules/1'), ('PUT', '/api/brands/any'), ('POST', '/api/reports/any/findings/any/review')])
def test_private_routes_require_authentication(client, method, path):
    assert client.request(method, path).status_code == 401


def test_non_owner_role_and_expired_session_are_rejected(client):
    client.post('/api/auth/setup', json=CREDS)
    with main.db(catalog=True) as c:
        c.execute("UPDATE owner_account SET role='viewer'")
    assert client.get('/api/workspace').status_code == 403
    with main.db(catalog=True) as c:
        c.execute("UPDATE owner_account SET role='owner'")
        c.execute('UPDATE sessions SET expires=0')
    assert client.get('/api/workspace').status_code == 401


def test_bootstrap_requires_loopback_and_mutations_check_origin(client):
    with TestClient(main.app, client=('203.0.113.4', 50100)) as remote:
        assert remote.post('/api/auth/setup', json=CREDS).status_code == 403
    assert client.post('/api/auth/setup', json=CREDS, headers={'Origin': 'https://attacker.example'}).status_code == 403
    client.post('/api/auth/setup', json=CREDS)
    assert client.post('/api/brands', json={}, headers={'Origin': 'http://localhost:9999'}).status_code == 403
    assert client.post('/api/auth/logout', headers={'Origin': 'http://localhost:3000'}).status_code == 200


def test_login_rate_limits_and_validation_do_not_echo_passwords(client):
    response = client.post('/api/auth/setup', json={**CREDS, 'password': 'short-key'})
    assert response.status_code == 422 and 'short-key' not in response.text
    client.post('/api/auth/setup', json=CREDS)
    client.post('/api/auth/logout')
    for _ in range(8):
        assert client.post('/api/auth/login', json={**CREDS, 'password': 'incorrect-password'}).status_code == 401
    assert client.post('/api/auth/login', json=CREDS).status_code == 429
