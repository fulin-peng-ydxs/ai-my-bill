"""使用临时 CA、回环端口和模拟 API 验证代理；不安装系统根信任。"""
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time

REPO = Path(__file__).resolve().parent.parent


class ApiProbe(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(401)
        self.send_header('Content-Type', 'application/json')
        self.send_header('X-Trace-Id', 'test-proxy-trace')
        self.end_headers()
        self.wfile.write(json.dumps({
            'code': 'UNAUTHORIZED', 'xff': self.headers.get('X-Forwarded-For'),
        }).encode())

    def log_message(self, *_args):
        pass


def create_test_certificates(pki):
    script = REPO / 'deploy/tls/internal-ca.sh'

    def invoke(*args):
        return subprocess.run(['bash', str(script), *map(str, args)],
                              capture_output=True, text=True, timeout=10)

    for args in [('init', pki / 'ca'), ('issue', pki / 'ca', '10.0.0.10', pki / 'issued')]:
        result = invoke(*args)
        assert result.returncode == 0, result.stderr
    assert (pki / 'ca/ca.key').stat().st_mode & 0o777 == 0o600
    assert (pki / 'issued/server.key').stat().st_mode & 0o777 == 0o600
    assert invoke('init', pki / 'ca').returncode != 0
    assert invoke('issue', pki / 'ca', '8.8.8.8', pki / 'public').returncode != 0
    assert invoke('issue', pki / 'ca', '10.0.0.10', pki / 'issued').returncode != 0
    wrong_ip = subprocess.run([
        'openssl', 'verify', '-CAfile', str(pki / 'ca/ca.crt'),
        '-verify_ip', '10.0.0.11', str(pki / 'issued/server.crt'),
    ], capture_output=True, timeout=10)
    assert wrong_ip.returncode != 0
    print('CA permissions, SAN identity, public IP rejection and overwrite protection passed.')


def verify_proxy(binary, temporary, backend_port):
    pki = temporary / 'pki'
    pki.mkdir()
    create_test_certificates(pki)
    (temporary / 'index.html').write_text('<html>my-bill-probe</html>')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        tls_port = probe.getsockname()[1]

    config = (REPO / 'deploy/Caddyfile').read_text()
    config = config.replace('admin localhost:2019', 'admin off')
    config = config.replace('https://:8443 {', f'https://:{tls_port} {{\n bind 127.0.0.1')
    config = config.replace('/etc/my-bill/tls', str(pki / 'issued'))
    config = config.replace('root * /srv', f'root * {temporary}')
    config = config.replace('app:{$MY_BILL_SERVER_PORT:8080}', f'127.0.0.1:{backend_port}')
    config_path = temporary / 'Caddyfile'
    config_path.write_text(config)

    def request(path, extra=()):
        return subprocess.run([
            'curl', '--http1.1', '--silent', '--show-error', '--noproxy', '*',
            '--cacert', str(pki / 'ca/ca.crt'), '--connect-to',
            f'10.0.0.10:{tls_port}:127.0.0.1:{tls_port}', '--max-time', '3', '-i',
            *extra, f'https://10.0.0.10:{tls_port}{path}',
        ], capture_output=True, text=True, timeout=5)

    for allowed in ['127.0.0.1/32', '0.0.0.0/0 ::/0', '192.0.2.1/32']:
        log_path = temporary / 'caddy.log'
        with log_path.open('w') as log:
            process = subprocess.Popen([
                str(binary), 'run', '--config', str(config_path), '--adapter', 'caddyfile',
            ], env={**os.environ, 'MY_BILL_ALLOWED_CIDRS': allowed}, stdout=log, stderr=log)
            try:
                for _ in range(30):
                    response = request('/login')
                    if response.returncode == 0:
                        break
                    if process.poll() is not None:
                        raise AssertionError(log_path.read_text())
                    time.sleep(0.1)
                assert response.returncode == 0, (response.stderr, log_path.read_text())
                if allowed != '192.0.2.1/32':
                    assert '200 OK' in response.stdout and 'my-bill-probe' in response.stdout
                    assert 'Content-Security-Policy:' in response.stdout
                    assert 'Cache-Control: no-cache' in response.stdout
                    api = request('/api/v1/unknown?token=private-query', ['-H', 'X-Forwarded-For: 203.0.113.9', '-H', 'Cookie: test=private-cookie', '-H', 'Authorization: Bearer private-token'])
                    assert api.returncode == 0, api.stderr
                    assert '401 Unauthorized' in api.stdout and 'Cache-Control: no-store' in api.stdout
                    assert '"xff": null' in api.stdout and 'my-bill-probe' not in api.stdout
                    print('Trusted IP HTTPS, SPA, CSP, API no-store/no HTML fallback and header removal passed.')
                else:
                    assert '403 Forbidden' in response.stdout and 'my-bill-probe' not in response.stdout
                    denied_api = request('/api/v1/unknown')
                    assert denied_api.returncode == 0 and '403 Forbidden' in denied_api.stdout
                    assert 'UNAUTHORIZED' not in denied_api.stdout
                    print('Unauthorized source denied before static/API handlers.')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        events = [json.loads(line) for line in log_path.read_text().splitlines() if line.startswith('{')]
        access = [event for event in events if event.get('logger', '').startswith('http.log.access')]
        assert access, 'access log missing'
        for event in access:
            assert 'uri' not in event['request'] and 'headers' not in event['request']
            assert 'resp_headers' not in event
        assert not any(secret in log_path.read_text() for secret in ('private-query', 'private-cookie', 'private-token'))
        if allowed != '192.0.2.1/32':
            assert any(event.get('traceId') == 'test-proxy-trace' for event in access)
        print('Access JSON/privacy filtering and server trace correlation passed.')


def main():
    if len(sys.argv) != 2:
        raise SystemExit('用法: python3 scripts/test-intranet-proxy.py <已校验的Caddy二进制>')
    binary = Path(sys.argv[1]).resolve()
    backend = http.server.ThreadingHTTPServer(('127.0.0.1', 0), ApiProbe)
    threading.Thread(target=backend.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix='my-bill-proxy-') as directory:
            verify_proxy(binary, Path(directory), backend.server_port)
    finally:
        backend.shutdown()
        backend.server_close()


if __name__ == '__main__':
    main()
