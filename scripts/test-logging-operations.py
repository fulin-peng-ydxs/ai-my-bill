"""Isolated command adapters exercise the real SSH quoting/remote log path; no Docker or server mutation."""
import gzip
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

REPO = Path(__file__).resolve().parent.parent


def main():
    with tempfile.TemporaryDirectory(prefix='my-bill-ops-log-') as directory:
        root = Path(directory).resolve()
        shutil.copytree(REPO / 'scripts', root / 'scripts')
        shutil.copytree(REPO / 'deploy', root / 'deploy')
        executor = root / 'deploy/scripts/operate-service.sh'
        # The harness changes only its private copy's root guard; production retains the guard.
        executor.write_text(executor.read_text().replace('[[ "${EUID}" -eq 0 ]]', '[[ "${EUID}" -ge 0 ]]'))
        (root / 'current').mkdir()
        shutil.copytree(root / 'deploy', root / 'current/deploy')
        targets = root / 'targets'; targets.mkdir()
        (root / 'known_hosts').write_text('fixture')
        (root / 'runtime.env').touch()
        values = {
            'BILL_TARGET_ID': 'fixture', 'BILL_HOST': '127.0.0.1', 'BILL_SSH_USER': 'root',
            'BILL_KNOWN_HOSTS_FILE': str(root / 'known_hosts'), 'BILL_REMOTE_ROOT': str(root),
            'BILL_ENV_FILE': str(root / 'runtime.env'), 'BILL_CA_FILE': str(root / 'ca.crt'),
            'BILL_BACKUP_STATUS_FILE': str(root / 'status'),
            'BILL_HEALTH_URL': 'https://127.0.0.1/api/v1/health',
        }
        (targets / 'fixture.env').write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
        binary = root / 'bin'; binary.mkdir()
        (binary / 'ssh').write_text('''#!/usr/bin/env python3
import json,os,sys
with open(os.environ['SSH_CALLS'], 'a') as output: output.write(json.dumps(sys.argv[1:])+'\\n')
os.execv('/bin/bash',['bash','-c',sys.argv[-1]])
''')
        (binary / 'docker').write_text('''#!/usr/bin/env python3
import json,os,sys
with open(os.environ['CALLS'], 'a') as output: output.write(json.dumps(sys.argv[1:])+'\\n')
if os.environ.get('FAIL_DOCKER'): sys.exit(9)
print('app | {"traceId":"fixture-trace","message":"fixture-event"}')
print('app | unrelated')
''')
        (binary / 'journalctl').write_text('#!/usr/bin/env bash\necho "fixture-system-event"\n')
        for path in binary.iterdir(): path.chmod(0o755)
        env = {**os.environ, 'PATH': str(binary) + ':' + os.environ['PATH'],
               'MY_BILL_DEPLOY_TARGET_DIRECTORY': str(targets), 'CALLS': str(root / 'calls'), 'SSH_CALLS': str(root / 'ssh-calls')}

        def invoke(*args, failure=False):
            result = subprocess.run(['bash', str(root / 'scripts/operations.sh'), *args], env=env,
                                    capture_output=True, text=True, timeout=10)
            assert (result.returncode != 0) == failure, result.stderr
            return result

        result = invoke('logs', 'fixture', '--service', 'app', '--since', '30m', '--tail', '17', '--trace-id', 'fixture-trace')
        assert 'fixture-event' in result.stdout and 'unrelated' not in result.stdout
        call = json.loads((root / 'calls').read_text().splitlines()[-1])
        assert call[-1] == 'app' and call[call.index('--tail') + 1] == '17'
        assert call[call.index('--since') + 1].isdigit()
        assert '-tt' not in json.loads((root / 'ssh-calls').read_text().splitlines()[-1])
        invoke('logs', 'fixture', '--trace-id', 'missing-trace')
        invoke('logs', 'fixture', '--service', 'app', '--follow')
        assert '--follow' in json.loads((root / 'calls').read_text().splitlines()[-1])
        assert '-tt' in json.loads((root / 'ssh-calls').read_text().splitlines()[-1])
        invoke('logs', 'fixture', '--service', 'bootstrap-admin')
        assert 'deploy/compose.bootstrap.yaml' in json.loads((root / 'calls').read_text().splitlines()[-1])
        for args in [('--tail', '0'), ('--tail', '9999999999999'), ('--since', '31d'),
                     ('--service', 'app;touch /tmp/unsafe'), ('--trace-id', '$(touch /tmp/unsafe)'), ('--follow',)]:
            invoke('logs', 'fixture', *args, failure=True)
        invoke('logs-export', 'fixture', '--service', 'app', '--since', '2h')
        exports = list((root / '.local/logs/operations/fixture').glob('*.gz'))
        assert len(exports) == 1 and 'fixture-event' in gzip.open(exports[0], 'rt').read()
        assert exports[0].stat().st_mode & 0o077 == 0
        archive = root / 'logs'; archive.mkdir(mode=0o700)
        (archive / '.my-bill-log-archive').write_text('my-bill-log-archive-v1\n')
        archive_file = archive / 'snapshot.20261006T000000Z.1.fixture.ABCDEF.log.gz'
        with gzip.open(archive_file, 'wt') as output: output.write('fixture-archived-trace\n')
        result = invoke('logs', 'fixture', '--archive', 'latest')
        assert 'fixture-archived-trace' in result.stdout
        invoke('logs', 'fixture', '--archive', '../../escape', failure=True)
        invoke('logs', 'fixture', '--archive', 'latest', '--service', 'app', failure=True)
        env['FAIL_DOCKER'] = '1'
        invoke('logs-export', 'fixture', failure=True)
        assert not list((root / '.local/logs/operations/fixture').glob('.diagnostic.*'))
        assert len(list((root / '.local/logs/operations/fixture').glob('*.gz'))) == 1
        print('PASS: SSH/remote log filters, follow, bootstrap overlay, rejected input, private export and failure cleanup')


if __name__ == '__main__':
    main()
