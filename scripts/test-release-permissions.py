"""Run the real candidate script with build adapters under a private umask."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

REPO = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='my-bill-release-permissions-') as directory:
    root = Path(directory)
    scripts = root / 'scripts'; scripts.mkdir()
    for name in ['build-release-candidate.sh', 'release-manifest.mjs']:
        shutil.copy(REPO / 'scripts' / name, scripts / name)
    (scripts / 'toolchain.sh').write_text('resolve_toolchain(){ :; }\n')
    binary = root / 'bin'; binary.mkdir()
    (binary / 'git').write_text('#!/bin/sh\n[ "$1" != rev-parse ] || echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n')
    (binary / 'npm').write_text('#!/bin/sh\numask 077\nmkdir -p web/dist/assets\nprintf public-page > web/dist/index.html\nprintf public-script > web/dist/assets/app.js\n')
    (root / 'mvnw').write_text('#!/bin/sh\nmkdir -p server/target\nprintf fixture-jar > server/target/fixture.jar\n')
    for path in [*binary.iterdir(), root / 'mvnw']: path.chmod(0o755)
    result = subprocess.run(['bash', '-c', 'umask 077; bash scripts/build-release-candidate.sh'], cwd=root,
                            env={**os.environ, 'PATH':str(binary)+':'+os.environ['PATH']}, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    for path in (root / 'web/dist').rglob('*'):
        assert path.stat().st_mode & 0o777 == (0o755 if path.is_dir() else 0o644), path
    assert (root / 'web/dist').stat().st_mode & 0o777 == 0o755
    manifest = root / '.local/web/release-candidate' / ('a'*40) / 'manifest.txt'
    assert manifest.stat().st_mode & 0o077 == 0
    assert (root / 'web/dist/index.html').read_text() == 'public-page'
    assert 'assets/app.js' in manifest.read_text()
print('PASS: public static assets readable and candidate metadata private under umask 077')
