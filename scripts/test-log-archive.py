"""Verify archive boundaries and failed-process diagnostics without any external service."""
import gzip
import os
from pathlib import Path
import subprocess
import tempfile
import time

REPO = Path(__file__).resolve().parent.parent
LIBRARY = REPO / 'deploy/scripts/log-archive.sh'


def main():
    with tempfile.TemporaryDirectory(prefix='my-bill-archive-') as directory:
        root = Path(directory).resolve()
        archives = root / 'logs'

        def shell(script, expected=0):
            result = subprocess.run(['bash', '-c', 'set -euo pipefail; source "$1"; ' + script,
                                     '--', str(LIBRARY), str(archives)], capture_output=True, text=True, timeout=10)
            assert result.returncode == expected, result.stderr
            return result

        shell('log_archive_prepare "$2" 14 100; log_archive_write deployment fixture bash -c "echo migration-start; exit 17"', 17)
        files = list(archives.glob('*.gz'))
        assert len(files) == 1
        content = gzip.open(files[0], 'rt').read()
        assert 'migration-start' in content and 'archiveResult=17' in content
        assert files[0].stat().st_mode & 0o077 == 0
        assert archives.stat().st_mode & 0o077 == 0
        shell('log_archive_prepare "$2" 14 100; log_archive_write snapshot fixture echo snapshot-trace')
        assert len(list(archives.glob('*.gz'))) == 2
        old = archives / 'snapshot.20200101T000000Z.1.fixture.ABCDEF.log.gz'
        old.write_bytes(b'expired'); os.utime(old, (time.time()-15*86400,)*2)
        other = archives / 'unrelated.log.gz'; other.write_bytes(b'do not delete')
        abandoned = archives / '.deployment.20200101T000000Z.99999999.fixture.ABCDEF'
        abandoned.write_bytes(b'interrupted')
        shell('log_archive_prepare "$2" 14 100; log_archive_prune')
        assert not old.exists() and not abandoned.exists() and other.exists()
        large = archives / 'bootstrap.20261001T000000Z.1.fixture.ABCDEF.log.gz'
        with large.open('wb') as stream: stream.truncate(101*1024*1024)
        os.utime(large, (time.time()-1000,)*2)
        shell('log_archive_prepare "$2" 14 100; log_archive_prune')
        assert not large.exists() and other.exists()
        unsafe = root / 'linked'; unsafe.symlink_to(archives, target_is_directory=True)
        result = subprocess.run(['bash','-c','source "$1"; log_archive_prepare "$2" 14 100', '--',str(LIBRARY),str(unsafe)],capture_output=True)
        assert result.returncode != 0
        archives.chmod(0o755)
        shell('log_archive_prepare "$2" 14 100', 1)
        print('PASS: compressed success/failure records, exit status, private permissions, age/capacity pruning and symlink refusal')


if __name__ == '__main__':
    main()
