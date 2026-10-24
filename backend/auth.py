"""Single-owner authentication for the local workspace, with server-side sessions."""
import hashlib
import hmac
import ipaddress
import os
import secrets
import time

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

COOKIE = 'brandforge_session'
SESSION_SECONDS = 8 * 3600
DEMO_USERNAME = 'judge'
DEMO_PASSWORD = 'BrandForgeDemo2026!'


def demo_enabled():
    return os.getenv('BRANDFORGE_DEMO_LOGIN', 'true').lower() == 'true'


def owner_setup_enabled():
    return os.getenv('BRANDFORGE_OWNER_SETUP', 'true').lower() == 'true'


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=80, pattern=r'^[a-zA-Z0-9_.@-]+$')
    password: str = Field(min_length=12, max_length=256)


def install_auth(app, catalog_db, demo_namespace, initialize_demo):
    with catalog_db() as c:
        c.execute('CREATE TABLE IF NOT EXISTS demo_sessions (token_hash TEXT PRIMARY KEY, namespace TEXT NOT NULL, expires REAL NOT NULL)')
    def owner():
        with catalog_db() as c:
            return c.execute('SELECT * FROM owner_account WHERE id=1').fetchone()

    def session(request):
        token = request.cookies.get(COOKIE, '')
        if not token or len(token) > 200:
            return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        with catalog_db() as c:
            account = c.execute('SELECT a.username,a.role FROM sessions s JOIN owner_account a ON a.id=s.owner_id '
                             'WHERE s.token_hash=? AND s.expires>?', (digest, time.time())).fetchone()
            if account:
                return dict(account)
            if demo_enabled():
                row = c.execute('SELECT namespace FROM demo_sessions WHERE token_hash=? AND expires>?', (digest,time.time())).fetchone()
                if row:
                    return {'username': DEMO_USERNAME, 'role': 'judge', 'namespace': row['namespace']}
        return None

    def set_session(response, namespace=None):
        token = secrets.token_urlsafe(32)
        with catalog_db() as c:
            c.execute('DELETE FROM sessions WHERE expires<=?', (time.time(),))
            c.execute('DELETE FROM demo_sessions WHERE expires<=?', (time.time(),))
            if namespace:
                c.execute('INSERT INTO demo_sessions (token_hash,namespace,expires) VALUES (?,?,?)',
                          (hashlib.sha256(token.encode()).hexdigest(), namespace, time.time()+SESSION_SECONDS))
            else:
                c.execute('INSERT INTO sessions (token_hash,owner_id,expires) VALUES (?,1,?)',
                          (hashlib.sha256(token.encode()).hexdigest(), time.time() + SESSION_SECONDS))
        response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True,
                            secure=os.getenv('BRANDFORGE_SECURE_COOKIE', '').lower() == 'true', samesite='strict', path='/api')

    @app.middleware('http')
    async def require_owner(request: Request, call_next):
        path = request.url.path
        public = {'/api/health', '/api/auth/status', '/api/auth/setup', '/api/auth/login'}
        namespace_token = None
        if path.startswith('/api/'):
            if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                allowed = {'http://localhost:3000', 'http://127.0.0.1:3000',
                           os.getenv('BRANDFORGE_FRONTEND_ORIGIN', 'http://localhost:3000')}
                origin = request.headers.get('origin')
                if origin is not None and origin not in allowed:
                    return JSONResponse(status_code=403, content={'detail': 'This request origin is not allowed.'})
            account = session(request)
            if path not in public:
                if not account:
                    return JSONResponse(status_code=401, content={'detail': 'Sign in to access this workspace.'})
                if account['role'] not in ('owner','judge'):
                    return JSONResponse(status_code=403, content={'detail': 'Only the workspace owner may perform this action.'})
                request.state.owner = account['username']
            if account and account['role']=='judge':
                namespace_token = demo_namespace.set(account['namespace'])
        try:
            response = await call_next(request)
        finally:
            if namespace_token is not None:
                demo_namespace.reset(namespace_token)
        if path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/auth/status')
    def status(request: Request):
        account = session(request)
        return {'authenticated': bool(account), 'setup_required': owner_setup_enabled() and owner() is None,
                'username': account['username'] if account else None,
                'role': account['role'] if account else None,
                'demo': {'enabled': demo_enabled(), **({'username':DEMO_USERNAME,'password':DEMO_PASSWORD} if demo_enabled() else {})}}

    @app.post('/api/auth/setup', status_code=201)
    def setup(payload: Credentials, request: Request, response: Response):
        if not owner_setup_enabled():
            raise HTTPException(403, 'Owner setup is disabled for this hosted demo. Use the judge demo login.')
        account = session(request)
        if account and account['role']=='judge':
            raise HTTPException(403, 'The judge demo cannot configure the private owner account.')
        if payload.username==DEMO_USERNAME:
            raise HTTPException(409, 'This ID is reserved for the judge demo. Use the demo sign-in button or choose another owner ID.')
        # First account can only be claimed from the loopback-bound local app.
        try:
            local = ipaddress.ip_address(request.client.host).is_loopback
        except (ValueError, AttributeError):
            local = False
        if not local:
            raise HTTPException(403, 'Initial owner setup must be performed on this computer through loopback.')
        if owner() is not None:
            raise HTTPException(409, 'The owner account is already configured. Sign in instead.')
        salt = secrets.token_bytes(16)
        password_hash = hashlib.pbkdf2_hmac('sha256', payload.password.encode(), salt, 600000)
        with catalog_db() as c:
            c.execute('BEGIN IMMEDIATE')
            if c.execute('SELECT 1 FROM owner_account').fetchone():
                raise HTTPException(409, 'The owner account is already configured. Sign in instead.')
            c.execute('INSERT INTO owner_account (id,username,salt,password_hash,role) VALUES (1,?,?,?,?)',
                      (payload.username, salt.hex(), password_hash.hex(), 'owner'))
        set_session(response)
        return {'authenticated': True, 'username': payload.username}

    @app.post('/api/auth/login')
    def login(payload: Credentials, request: Request, response: Response):
        address = (request.client.host if request.client else 'unknown')[:100]
        # Public demo sign-ins must not reset the owner's brute-force counter.
        address = f'judge:{address}' if payload.username==DEMO_USERNAME else address
        with catalog_db() as c:
            c.execute('DELETE FROM login_attempts WHERE attempted_at<?', (time.time() - 900,))
            count = c.execute('SELECT COUNT(*) FROM login_attempts WHERE address=?', (address,)).fetchone()[0]
            if count >= 8:
                raise HTTPException(429, 'Too many login attempts. Wait 15 minutes before retrying.')
            c.execute('INSERT INTO login_attempts (address,attempted_at) VALUES (?,?)', (address, time.time()))
        if demo_enabled() and hmac.compare_digest(payload.username,DEMO_USERNAME) and hmac.compare_digest(payload.password,DEMO_PASSWORD):
            namespace = secrets.token_hex(16)
            initialize_demo(namespace)
            with catalog_db() as c:
                c.execute('DELETE FROM login_attempts WHERE address=?',(address,))
            set_session(response, namespace)
            return {'authenticated':True,'username':DEMO_USERNAME,'role':'judge'}
        account = owner()
        salt = bytes.fromhex(account['salt']) if account else b'\0' * 16
        actual = hashlib.pbkdf2_hmac('sha256', payload.password.encode(), salt, 600000).hex()
        if not account or not hmac.compare_digest(account['username'], payload.username) or not hmac.compare_digest(account['password_hash'], actual):
            raise HTTPException(401, 'Incorrect username or password.')
        with catalog_db() as c:
            c.execute('DELETE FROM login_attempts WHERE address=?', (address,))
        set_session(response)
        return {'authenticated': True, 'username': payload.username}

    @app.post('/api/auth/logout')
    def logout(request: Request, response: Response):
        digest = hashlib.sha256(request.cookies.get(COOKIE, '').encode()).hexdigest()
        with catalog_db() as c:
            c.execute('DELETE FROM sessions WHERE token_hash=?', (digest,))
            c.execute('DELETE FROM demo_sessions WHERE token_hash=?', (digest,))
        response.delete_cookie(COOKIE, path='/api')
        return {'authenticated': False}
