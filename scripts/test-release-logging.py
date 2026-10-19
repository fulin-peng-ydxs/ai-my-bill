"""Run the release executor against isolated command adapters, including migration failure boundaries."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

REPO = Path(__file__).resolve().parent.parent


def scenario(failure):
    with tempfile.TemporaryDirectory(prefix='my-bill-release-log-') as directory:
        root = Path(directory).resolve()
        release = root / 'service'; release.mkdir()
        old = release / 'old'; old.mkdir()
        previous = 'a' * 40; commit = 'b' * 40
        (old / 'REVISION').write_text(previous)
        (release / 'current').symlink_to(old, target_is_directory=True)
        incoming = release / 'incoming' / commit; incoming.mkdir(parents=True)
        source = root / 'source'; source.mkdir(); shutil.copytree(REPO / 'deploy', source / 'deploy')
        with tarfile.open(incoming / 'source.tar', 'w') as tar: tar.add(source / 'deploy', arcname='deploy')
        web = root / 'web'; web.mkdir(); (web / 'index.html').write_text('fixture'); (web / 'sw.js').write_text('fixture')
        with tarfile.open(incoming / 'web-dist.tar.gz', 'w:gz') as tar: tar.add(web, arcname='web/dist')
        (incoming / 'manifest.txt').write_text('fixture')
        (incoming / 'build.properties').write_text('commit=' + commit + '\n')
        for name in ['apply-release.sh', 'log-archive.sh']:
            shutil.copy(REPO / 'deploy/scripts' / name, incoming / name)
        executor = incoming / 'apply-release.sh'
        executor.write_text(executor.read_text().replace('[[ "${EUID}" -eq 0 ]]', '[[ "${EUID}" -ge 0 ]]'))
        (incoming / 'SHA256SUMS').write_text(''.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n'
                                                  for path in sorted(incoming.iterdir()) if path.is_file()))
        (root / 'runtime.env').write_text('MY_BILL_WEB_DIST=/preserved/old\nUNCHANGED=value\n')
        (root / 'ca.crt').touch()
        raw = root / ('c' * 64) / (('c' * 64) + '-json.log')
        raw.parent.mkdir(); raw.write_text('corrupt-json-evidence')
        (root / 'status').write_text('status=SUCCEEDED\nlatestCompletedAt=fixture\n')
        binary = root / 'bin'; binary.mkdir()
        (binary / 'flock').write_text('#!/usr/bin/env python3\nimport fcntl,sys\nfcntl.flock(int(sys.argv[-1]),fcntl.LOCK_EX | fcntl.LOCK_NB)\n')
        (binary / 'docker').write_text('''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['CALLS'],'a') as output: output.write(json.dumps({'args':args,'version':os.environ.get('MY_BILL_VERSION')})+'\\n')
if args[0]=='compose':
 if 'ps' in args and '-q' in args: print('fixture-'+args[-1])
 elif 'run' in args:
  print('migration-output')
  if os.environ['SCENARIO']=='migration': sys.exit(13)
 elif 'build' in args: print('build-output')
elif args[0]=='inspect':
 fmt=' '.join(args)
 if '.State.Running' in fmt: print('true' if os.environ['SCENARIO']=='active-corrupt-log' else 'false')
 elif '.HostConfig.LogConfig.Type' in fmt: print('json-file' if os.environ['SCENARIO']=='corrupt-log' else 'unavailable')
 elif '.LogPath' in fmt: print(os.environ['RAW_LOG'])
 elif '{{.Id}}' in fmt: print('c'*64)
 elif '.State.Health' in fmt: print('healthy')
 elif 'container=' in fmt: print('container=fixture image=fixture created=fixture')
 else: print('sha256:fixture')
elif args[0]=='logs':
 print('retained-output fixture-trace')
 if os.environ['SCENARIO'] in ['snapshot','corrupt-log','active-corrupt-log']: sys.exit(9)
elif args[0]=='image': print('sha256:new')
elif args[0]=='run': print('0'*64+' /app/my-bill-server.jar')
elif args[0]=='exec': print('12:012')
''')
        (binary / 'systemctl').write_text('#!/usr/bin/env bash\nfor arg in \"$@\"; do [[ \"$arg\" != --value ]] || exit 2; done\n[[ \"$1\" != show ]] || echo Result=success\n')
        (binary / 'curl').write_text('#!/usr/bin/env bash\n[[ "${@: -1}" != *.html && "${@: -1}" != *.js ]] || { if [[ "$SCENARIO" == web-mismatch ]]; then printf stale; else printf fixture; fi; }\nexit 0\n')
        (binary / 'chmod').write_text('#!/usr/bin/env bash\n[[ "$1" != --reference=* ]] || exit 0\nexec /bin/chmod "$@"\n')
        (binary / 'chown').write_text('#!/usr/bin/env bash\nexit 0\n')
        (binary / 'date').write_text('#!/usr/bin/env bash\nif [[ "$*" == *" -d "* ]]; then /bin/date -u +%s; else exec /bin/date "$@"; fi\n')
        (binary / 'sha256sum').write_text('''#!/usr/bin/env python3
import hashlib,pathlib,sys
if len(sys.argv)==1: print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest(),'-')
elif sys.argv[1]=='-c':
 for line in pathlib.Path(sys.argv[2]).read_text().splitlines():
  digest,name=line.split(None,1); assert hashlib.sha256(pathlib.Path(name.strip()).read_bytes()).hexdigest()==digest
else:
 for name in sys.argv[1:]: print(hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest(),name)
''')
        (binary / 'mv').write_text('''#!/usr/bin/env python3
import os,sys
if sys.argv[1]=='-Tf': os.replace(sys.argv[2],sys.argv[3])
else: os.execv('/bin/mv',['mv',*sys.argv[1:]])
''')
        for path in binary.iterdir(): path.chmod(0o755)
        env = {**os.environ, 'LC_ALL': 'C', 'LANG':'C', 'PATH': str(binary) + ':' + os.environ['PATH'],
               'CALLS': str(root / 'calls'), 'SCENARIO': failure, 'RAW_LOG': str(raw)}
        command = ['bash', str(executor), '--commit', commit, '--incoming-dir', str(incoming), '--release-root', str(release),
                   '--env-file', str(root / 'runtime.env'), '--ca-file', str(root / 'ca.crt'),
                   '--health-url', 'https://127.0.0.1/api/v1/health', '--backup-service', 'fixture.service',
                   '--backup-status-file', str(root / 'status'), '--compose-overlay', 'deploy/compose.intranet.yaml']
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=20)
        expected = 0 if failure in ['success', 'corrupt-log'] else 13 if failure == 'migration' else 1
        assert result.returncode == expected, result.stderr + result.stdout
        archives = list((release / 'logs').glob('*.log.gz'))
        records = {path.name.split('.')[0]: gzip.open(path, 'rt').read() for path in archives}
        assert 'deployment' in records and f'archiveResult={expected}' in records['deployment']
        calls = [json.loads(line) for line in (root / 'calls').read_text().splitlines()]
        logs_indices = [i for i, item in enumerate(calls) if item['args'][0] == 'logs']
        migration_indices = [i for i, item in enumerate(calls) if 'run' in item['args'] and item['args'][-1] == 'migrate']
        if failure in ['snapshot', 'active-corrupt-log']:
            assert not migration_indices
            assert any('start' in item['args'] and item['args'][-2:] == ['app','proxy'] for item in calls)
        else:
            assert max(logs_indices) < migration_indices[0]
            assert 'retained-output' in records['snapshot']
        if failure not in ['success', 'web-mismatch', 'corrupt-log']:
            assert not any('--force-recreate' in item['args'] for item in calls)
            assert (release / 'current').resolve() == old
        else:
            assert (release / 'current/REVISION').read_text().strip() == commit
            assert (root / 'runtime.env').read_text() == f'MY_BILL_WEB_DIST={release}/current/web/dist\nUNCHANGED=value\n'
            assert list(root.glob('runtime.env.before-*'))[0].read_text().startswith('MY_BILL_WEB_DIST=/preserved/old\n')
            recreates = [item['args'] for item in calls if '--force-recreate' in item['args']]
            assert len(recreates) == 2 and all('--no-deps' in args for args in recreates)
            assert not any('up' in item['args'] and item['args'][-1] == 'db' for item in calls)
            assert all(item['version'] == commit for item in calls if 'build' in item['args'] or 'run' in item['args'] or '--force-recreate' in item['args'])
        if failure == 'corrupt-log':
            assert 'snapshotFallback=raw-json-file-tail' in records['snapshot']
            assert 'corrupt-json-evidence' in records['snapshot']
            assert raw.read_text() == 'corrupt-json-evidence'
        assert all(path.stat().st_mode & 0o077 == 0 for path in archives)
        print('PASS: isolated release logging / ' + failure)


if __name__ == '__main__':
    for failure in ['success', 'migration', 'snapshot', 'web-mismatch', 'corrupt-log', 'active-corrupt-log']: scenario(failure)
