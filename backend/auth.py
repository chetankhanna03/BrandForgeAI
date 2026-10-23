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


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=80, pattern=r'^[a-zA-Z0-9_.@-]+$')
    password: str = Field(min_length=12, max_length=256)


def install_auth(app, catalog_db):
    def owner():
        with catalog_db() as c:
            return c.execute('SELECT * FROM owner_account WHERE id=1').fetchone()

    def session(request):
        token = request.cookies.get(COOKIE, '')
        if not token or len(token) > 200:
            return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        with catalog_db() as c:
            return c.execute('SELECT a.username,a.role FROM sessions s JOIN owner_account a ON a.id=s.owner_id '
                             'WHERE s.token_hash=? AND s.expires>?', (digest, time.time())).fetchone()

    def set_session(response):
        token = secrets.token_urlsafe(32)
        with catalog_db() as c:
            c.execute('DELETE FROM sessions WHERE expires<=?', (time.time(),))
            c.execute('INSERT INTO sessions (token_hash,owner_id,expires) VALUES (?,1,?)',
                      (hashlib.sha256(token.encode()).hexdigest(), time.time() + SESSION_SECONDS))
        response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True,
                            secure=os.getenv('BRANDFORGE_SECURE_COOKIE', '').lower() == 'true', samesite='strict', path='/api')

    @app.middleware('http')
    async def require_owner(request: Request, call_next):
        path = request.url.path
        public = {'/api/health', '/api/auth/status', '/api/auth/setup', '/api/auth/login'}
        if path.startswith('/api/'):
            if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                allowed = {'http://localhost:3000', 'http://127.0.0.1:3000',
                           os.getenv('BRANDFORGE_FRONTEND_ORIGIN', 'http://localhost:3000')}
                origin = request.headers.get('origin')
                if origin is not None and origin not in allowed:
                    return JSONResponse(status_code=403, content={'detail': 'This request origin is not allowed.'})
            if path not in public:
                account = session(request)
                if not account:
                    return JSONResponse(status_code=401, content={'detail': 'Sign in to access this workspace.'})
                if account['role'] != 'owner':
                    return JSONResponse(status_code=403, content={'detail': 'Only the workspace owner may perform this action.'})
                request.state.owner = account['username']
        response = await call_next(request)
        if path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/auth/status')
    def status(request: Request):
        account = session(request)
        return {'authenticated': bool(account), 'setup_required': owner() is None,
                'username': account['username'] if account else None}

    @app.post('/api/auth/setup', status_code=201)
    def setup(payload: Credentials, request: Request, response: Response):
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
        with catalog_db() as c:
            c.execute('DELETE FROM login_attempts WHERE attempted_at<?', (time.time() - 900,))
            count = c.execute('SELECT COUNT(*) FROM login_attempts WHERE address=?', (address,)).fetchone()[0]
            if count >= 8:
                raise HTTPException(429, 'Too many login attempts. Wait 15 minutes before retrying.')
            c.execute('INSERT INTO login_attempts (address,attempted_at) VALUES (?,?)', (address, time.time()))
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
        response.delete_cookie(COOKIE, path='/api')
        return {'authenticated': False}
