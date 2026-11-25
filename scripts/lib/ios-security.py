"""Pinned offline-App CI tools and redacted scans; never reads ignored local data."""
import hashlib
from datetime import date, datetime, timezone
import io
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = {
    'actionlint': ('rhysd/actionlint', '1.7.12', '-version'),
    'gitleaks': ('gitleaks/gitleaks', '8.30.1', 'version'),
}


def plain(path):
    if path.is_symlink() or not path.is_file() or path.resolve() != path.absolute():
        raise RuntimeError('Tool/report path must be a regular file')
    return path.read_bytes()


def download(url, limit):
    # Use the OS curl trust store; do not disable TLS verification or change host certificates.
    value = subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--location',
                                     '--proto', '=https', '--proto-redir', '=https', '--max-time', '30',
                                     '--max-filesize', str(limit), url], timeout=35)
    if len(value) > limit:
        raise RuntimeError('Tool download exceeded size limit')
    return value


def private_directory(root, relative):
    """Reject links before creating descendants, preserving unrelated sessions and directories."""
    current = root
    for part in Path(relative).parts:
        current = current / part
        if current.is_symlink():
            raise RuntimeError('Private tool directory cannot traverse symbolic links')
        current.mkdir(exist_ok=True, mode=0o700)
        if not current.is_dir():
            raise RuntimeError('Private tool directory is invalid')
    return current


def release_tool(root, name):
    """Verify official archive, extract only the executable, atomically publish cache."""
    repository, version, flag = TOOLS[name]
    system = {'Darwin': 'darwin', 'Linux': 'linux'}[platform.system()]
    arch = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'amd64'}[platform.machine()]
    folder = root / '.local/ios/tools' / name / version / (system + '-' + arch)
    private_directory(root, folder.parent.relative_to(root))
    if folder.resolve() != folder.absolute():
        raise RuntimeError('Tool cache cannot traverse symbolic links')
    binary, proof = folder / name, folder / 'verified.json'
    if binary.exists() or proof.exists():
        value = json.loads(plain(proof))
        if value.get('version') != version or value.get('sha256') != hashlib.sha256(plain(binary)).hexdigest():
            raise RuntimeError('Pinned tool cache is invalid; refusing execution')
    else:
        asset_arch = 'x64' if name == 'gitleaks' and arch == 'amd64' else arch
        asset = '{}_{}_{}_{}.tar.gz'.format(name, version, system, asset_arch)
        base = 'https://github.com/{}/releases/download/v{}'.format(repository, version)
        rows = download(base + '/' + name + '_' + version + '_checksums.txt', 1024 * 1024).decode().splitlines()
        checksums = {row.split()[1].lstrip('*'): row.split()[0] for row in rows if len(row.split()) == 2}
        archive = download(base + '/' + asset, 40 * 1024 * 1024)
        if hashlib.sha256(archive).hexdigest() != checksums.get(asset):
            raise RuntimeError('Official tool archive checksum mismatch')
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as package:
            members = [m for m in package.getmembers() if m.name == name]
            if len(members) != 1 or not members[0].isfile() or members[0].size > 80 * 1024 * 1024:
                raise RuntimeError('Executable archive member is invalid')
            contents = package.extractfile(members[0]).read()
        with tempfile.TemporaryDirectory(prefix='install-', dir=folder.parent) as temporary:
            publication = Path(temporary) / 'verified'
            publication.mkdir()
            staged = publication / name
            staged.write_bytes(contents)
            staged.chmod(0o755)
            # Publish the complete cache directory atomically; interrupted installs remain retryable.
            metadata = publication / 'verified.json'
            metadata.write_text(json.dumps({'version': version, 'sha256': hashlib.sha256(contents).hexdigest()}))
            os.replace(publication, folder)
    actual = subprocess.check_output([str(binary), flag], text=True, timeout=10)
    if actual.splitlines()[0].strip() != version:
        raise RuntimeError('Pinned tool version mismatch')
    return binary


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, timeout=30)


def source_paths(root):
    names = git(root, 'ls-files', '-co', '--exclude-standard', '-z').decode().split('\0')
    paths = sorted(set(filter(None, names)))
    if not paths:
        raise RuntimeError('Empty source inventory')
    for name in paths:
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise RuntimeError('Source path escaped repository')
    return paths


def scan_workflows(root):
    executable = release_tool(root, 'actionlint')
    files = sorted((root / '.github/workflows').glob('*.y*ml'))
    if not files:
        raise RuntimeError('No workflow files found')
    for file in files:
        plain(file)
    # Only workflow syntax/expressions: optional host shellcheck/pyflakes are not implicit dependencies.
    subprocess.run([str(executable), '-shellcheck=', '-pyflakes=', *map(str, files)], cwd=root, check=True, timeout=60)
    print(json.dumps({'tool': 'actionlint', 'version': TOOLS['actionlint'][1], 'files': len(files), 'status': 'passed'}))


def exceptions(root):
    value = json.loads(plain(root / 'config/ios-security-exceptions.json'))
    if value.get('schema') != 1 or not isinstance(value.get('exceptions'), list):
        raise RuntimeError('Invalid security exception inventory')
    allowed = set()
    for item in value['exceptions']:
        identity = (item.get('path'), item.get('rule'), item.get('lineSha256'))
        name = item.get('path', '')
        if (not name or Path(name).is_absolute() or '..' in Path(name).parts or
                not item.get('reason') or not re.fullmatch('[a-f0-9]{64}', item.get('lineSha256', '')) or
                not item.get('rule') or date.fromisoformat(item['expires']) <= datetime.now(timezone.utc).date() or identity in allowed):
            raise RuntimeError('Invalid, duplicate or expired security exception')
        allowed.add(identity)
    return allowed


def finding_identity(root, snapshot, label, finding):
    name = finding.get('File', '')
    if label == 'source':
        absolute = Path(name)
        name = str(absolute.relative_to(snapshot)) if absolute.is_absolute() else name
    if not name or Path(name).is_absolute() or '..' in Path(name).parts:
        raise RuntimeError('Secret finding path escaped source scope')
    contents = plain(snapshot / name) if label == 'source' else git(root, 'show', finding['Commit'] + ':' + name)
    start, end = finding.get('StartLine'), finding.get('EndLine')
    lines = contents.splitlines()
    if type(start) is not int or type(end) is not int or not 1 <= start <= end <= len(lines):
        raise RuntimeError('Secret finding line range is invalid')
    return name, finding['RuleID'], hashlib.sha256(b'\n'.join(lines[start-1:end])).hexdigest()


def scan_secrets(root, history=False, base=None):
    """Scan the controlled tree plus commit range; no inline allow comments or external ignore files."""
    executable = release_tool(root, 'gitleaks')
    paths = source_paths(root)
    allowed = exceptions(root)
    matched = set()
    if base:
        if not re.fullmatch('[a-fA-F0-9]{40}', base):
            raise RuntimeError('Secret scan base must be a full commit SHA')
        git(root, 'cat-file', '-e', base + '^{commit}')
    sensitive = re.compile(r'(^|/)(\.env|id_(rsa|dsa|ecdsa|ed25519))$|\.(jks|p12|pfx|key)$')
    if any(sensitive.search(name) for name in paths):
        raise RuntimeError('Sensitive file names in source inventory')
    parent = root / '.local/ios/tmp/ai-agent'
    private_directory(root, parent.relative_to(root))
    with tempfile.TemporaryDirectory(prefix='security-', dir=parent) as temporary:
        folder = Path(temporary)
        snapshot = folder / 'source'
        snapshot.mkdir()
        for name in paths:
            source, destination = root / name, snapshot / name
            if not source.exists() and not source.is_symlink():
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_symlink():
                destination.write_text(os.readlink(source))
            else:
                shutil.copyfile(source, destination)
        config, ignore = folder / 'rules.toml', folder / 'ignore'
        config.write_text('[extend]\nuseDefault = true\n')
        ignore.write_text('')
        common = ['--config', str(config), '--gitleaks-ignore-path', str(ignore), '--ignore-gitleaks-allow',
                  '--redact=100', '--no-banner', '--no-color', '--exit-code=20', '--timeout=60', '--report-format=json']
        revision = '--all' if history else (base + '..HEAD' if base else '-1')
        if history:
            names = git(root, 'log', '--all', '--name-only', '--format=').decode().splitlines()
            if any(sensitive.search(name) for name in names):
                raise RuntimeError('Sensitive file names in history')
        scans = [('history', ['git', str(root), '--log-opts=' + revision])] if history else [
            ('source', ['dir', str(snapshot)]), ('commits', ['git', str(root), '--log-opts=' + revision])]
        for label, args in scans:
            report = folder / (label + '.json')
            result = subprocess.run([str(executable), *args, *common, '--report-path', str(report)],
                                    cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=70)
            findings = json.loads(plain(report)) if report.exists() else None
            if result.returncode not in (0, 20) or not isinstance(findings, list) or (result.returncode == 20 and not findings):
                raise RuntimeError('Gitleaks did not complete: ' + label)
            rejected = []
            for finding in findings:
                identity = finding_identity(root, snapshot, label, finding)
                if identity not in allowed:
                    rejected.append({'path': identity[0], 'rule': identity[1], 'line': finding.get('StartLine')})
                elif label == 'source':
                    matched.add(identity)
            if rejected:
                # Never print matches, tokens or snippets, including in unexpected tool errors.
                print(json.dumps({'status': 'failed', 'scan': label, 'findings': rejected}), file=sys.stderr)
                raise RuntimeError('Gitleaks detected secrets: ' + label)
        if not history and allowed - matched:
            raise RuntimeError('Security exception no longer matches current source; update the inventory')
        print(json.dumps({'tool': 'gitleaks', 'version': TOOLS['gitleaks'][1], 'history': history, 'status': 'passed'}))


def main():
    command = sys.argv[1:]
    if command == ['quality']:
        scan_workflows(ROOT)
    elif command == ['secrets-history']:
        scan_secrets(ROOT, history=True)
    elif command == ['secrets'] or (len(command) == 3 and command[:2] == ['secrets', '--base']):
        scan_secrets(ROOT, base=command[2] if len(command) == 3 else None)
    else:
        raise RuntimeError('Expected quality | secrets [--base SHA] | secrets-history')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Security check failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
