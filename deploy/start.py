"""Run the API and frontend together; stop the container if either exits."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen


def configure():
    # Render provides the actual public URL, including any assigned name suffix.
    if os.getenv('RENDER_EXTERNAL_URL'):
        os.environ.setdefault('BRANDFORGE_FRONTEND_ORIGIN', os.environ['RENDER_EXTERNAL_URL'].rstrip('/'))
    Path(os.environ.get('BRANDFORGE_DB', '/var/data/brandforge.db')).parent.mkdir(parents=True, exist_ok=True)


def main():
    configure()
    children = []
    stopping = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        api = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.main:app',
                                '--host', '127.0.0.1', '--port', '8000', '--no-proxy-headers'])
        children.append(api)
        deadline = time.monotonic() + 60
        while not stopping:
            if api.poll() is not None:
                raise RuntimeError('The backend exited during startup.')
            try:
                with urlopen('http://127.0.0.1:8000/api/health', timeout=2) as response:
                    if response.status == 200:
                        break
            except (URLError, TimeoutError):
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError('The backend did not become healthy within 60 seconds.')
            time.sleep(0.25)
        if stopping:
            return 0
        env = {**os.environ, 'HOSTNAME': '0.0.0.0', 'PORT': os.getenv('PORT', '10000')}
        children.append(subprocess.Popen(['node', 'server.js'], cwd='/app/frontend', env=env))
        while not stopping:
            if any(child.poll() is not None for child in children):
                raise RuntimeError('An application process exited. Restarting the service is required.')
            time.sleep(0.5)
        return 0
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == '__main__':
    sys.exit(main())
