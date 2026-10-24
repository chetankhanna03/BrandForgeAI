from deploy.start import configure
from deploy import start
import pytest


def test_render_launcher_configures_origin_and_database_directory(tmp_path, monkeypatch):
    monkeypatch.delenv('BRANDFORGE_FRONTEND_ORIGIN', raising=False)
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://assigned-name.onrender.com/')
    monkeypatch.setenv('BRANDFORGE_DB', str(tmp_path / 'data' / 'brandforge.db'))
    configure()
    import os
    assert os.environ['BRANDFORGE_FRONTEND_ORIGIN'] == 'https://assigned-name.onrender.com'
    assert (tmp_path / 'data').is_dir()


def test_render_launcher_preserves_custom_origin(tmp_path, monkeypatch):
    monkeypatch.setenv('BRANDFORGE_FRONTEND_ORIGIN', 'https://demo.example.com')
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://assigned-name.onrender.com')
    monkeypatch.setenv('BRANDFORGE_DB', str(tmp_path / 'brandforge.db'))
    configure()
    import os
    assert os.environ['BRANDFORGE_FRONTEND_ORIGIN'] == 'https://demo.example.com'


def test_frontend_exit_stops_backend_and_fails_container(monkeypatch):
    class Process:
        def __init__(self, code=None):
            self.code = code
            self.terminated = False

        def poll(self):
            return self.code

        def terminate(self):
            self.terminated = True
            self.code = 0

        def wait(self, timeout=None):
            return self.code

    class Healthy:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    api, frontend = Process(), Process(1)
    processes = iter([api, frontend])
    monkeypatch.setattr(start, 'configure', lambda: None)
    monkeypatch.setattr(start.signal, 'signal', lambda *args: None)
    monkeypatch.setattr(start.subprocess, 'Popen', lambda *args, **kwargs: next(processes))
    monkeypatch.setattr(start, 'urlopen', lambda *args, **kwargs: Healthy())
    with pytest.raises(RuntimeError, match='application process exited'):
        start.main()
    assert api.terminated


def test_failed_backend_never_starts_frontend(monkeypatch):
    calls = []

    class FailedProcess:
        def poll(self):
            return 1

        def wait(self, timeout=None):
            return 1

    def launch(*args, **kwargs):
        calls.append(args)
        return FailedProcess()

    monkeypatch.setattr(start, 'configure', lambda: None)
    monkeypatch.setattr(start.signal, 'signal', lambda *args: None)
    monkeypatch.setattr(start.subprocess, 'Popen', launch)
    with pytest.raises(RuntimeError, match='backend exited during startup'):
        start.main()
    assert len(calls) == 1
