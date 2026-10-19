"""Exercise same-day backup refresh through the real ops entry point with SSH/SCP adapters."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

REPO = Path(__file__).resolve().parent.parent
parent = Path(tempfile.gettempdir()) / 'ai-agent/ai-my-bill'
parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='backup-pull-', dir=parent) as directory:
    root = Path(directory)
    remote = root / 'remote'; remote.mkdir()
    local = root / 'local'
    targets = root / 'targets'; targets.mkdir()
    binary = root / 'bin'; binary.mkdir()
    known = root / 'known_hosts'; known.touch()
    date = '2026-10-19'
    (targets / 'sample.env').write_text(f'''BILL_TARGET_ID=sample
BILL_HOST=192.0.2.1
BILL_KNOWN_HOSTS_FILE={known}
BILL_HEALTH_URL=https://192.0.2.1/api/v1/health
BILL_OFFSITE_BACKUP_DIRECTORY={local}
''')
    (binary / 'ssh').write_text('''#!/usr/bin/env python3
import os,pathlib,sys
p=pathlib.Path(os.environ['REMOTE_DIR'])/'2026-10-19.sha256'
print(p.read_text(),end='')
''')
    (binary / 'scp').write_text('''#!/usr/bin/env python3
import os,pathlib,shutil,sys
remote=pathlib.Path(os.environ['REMOTE_DIR']); destination=pathlib.Path(sys.argv[-1])
with open(os.environ['COPY_CALLS'],'a') as f:f.write('copy\\n')
for arg in sys.argv:
 if ':/var/backups/' in arg:
  name=arg.rsplit('/',1)[-1]; shutil.copyfile(remote/name,destination/name)
if os.environ.get('SCENARIO')=='corrupt': (destination/'2026-10-19.cms').write_bytes(b'corrupt')
if os.environ.get('SCENARIO')=='changed': (destination/'2026-10-19.sha256').write_text('0'*64+'  2026-10-19.cms\\n')
''')
    for path in binary.iterdir(): path.chmod(0o755)
    env = {**os.environ, 'PATH': str(binary)+':'+os.environ['PATH'], 'REMOTE_DIR': str(remote),
           'COPY_CALLS': str(root/'calls'), 'MY_BILL_DEPLOY_TARGET_DIRECTORY': str(targets)}
    def publish(content):
        (remote/f'{date}.cms').write_bytes(content)
        (remote/f'{date}.sha256').write_text(hashlib.sha256(content).hexdigest()+f'  {date}.cms\n')
    def run(scenario='', success=True):
        result = subprocess.run(['bash', str(REPO/'scripts/operations.sh'), 'backup-pull', 'sample', date],
                                env={**env, 'SCENARIO': scenario}, capture_output=True, text=True)
        assert (result.returncode == 0) == success, result.stdout+result.stderr
    publish(b'old'); run()
    copies = (root/'calls').read_text(); run()
    assert (root/'calls').read_text() == copies
    publish(b'new'); run()
    assert (local/'daily'/f'{date}.cms').read_bytes() == b'new'
    history = local/'history'/date/hashlib.sha256(b'old').hexdigest()
    assert (history/f'{date}.cms').read_bytes() == b'old'
    assert history.stat().st_mode & 0o077 == 0
    publish(b'newer')
    for scenario in ['corrupt', 'changed']:
        run(scenario, success=False)
        assert (local/'daily'/f'{date}.cms').read_bytes() == b'new'
    (remote/f'{date}.sha256').write_text('invalid\n'); run(success=False)
    assert (local/'daily'/f'{date}.cms').read_bytes() == b'new'
    print('PASS: first pull, same-version reuse, same-day refresh/history, corrupt/racing/invalid remote rejection')
