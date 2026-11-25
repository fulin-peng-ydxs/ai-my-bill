"""Controlled security regressions; no downloads, simulator or business services."""
import hashlib
import importlib.util
import io
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ios_security', Path(__file__).parents[1] / 'lib/ios-security.py')
security = importlib.util.module_from_spec(spec)
spec.loader.exec_module(security)


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        (self.root / 'config').mkdir()
        (self.root / 'config/ios-security-exceptions.json').write_text('{"schema":1,"exceptions":[]}')
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        for key, value in [('user.name', 'fixture'), ('user.email', 'fixture@example.invalid')]:
            subprocess.run(['git', 'config', key, value], cwd=self.root, check=True)
        (self.root / '.gitignore').write_text('.local/\n')
        (self.root / 'source.txt').write_text('ordinary source\n')
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'], cwd=self.root, check=True)

    def archive(self, kind=tarfile.REGTYPE):
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode='w:gz') as package:
            member = tarfile.TarInfo('actionlint')
            member.type = kind
            value = b'#!/bin/sh\necho 1.7.12\n'
            member.size = len(value) if kind == tarfile.REGTYPE else 0
            package.addfile(member, io.BytesIO(value) if member.size else None)
        return out.getvalue()

    def install(self, archive=None, bad_hash=False):
        archive = archive or self.archive()
        name = 'actionlint_1.7.12_darwin_arm64.tar.gz'
        checksum = ('0'*64 if bad_hash else hashlib.sha256(archive).hexdigest()) + '  ' + name
        with patch.object(security.platform, 'system', return_value='Darwin'), patch.object(security.platform, 'machine', return_value='arm64'), patch.object(security, 'download', side_effect=[checksum.encode(), archive]):
            return security.release_tool(self.root, 'actionlint')

    def test_pinned_cache_hit_tamper_and_checksum_failure(self):
        binary = self.install()
        with patch.object(security.platform, 'system', return_value='Darwin'), patch.object(security.platform, 'machine', return_value='arm64'), patch.object(security, 'download', side_effect=AssertionError('cache must not download')):
            self.assertEqual(security.release_tool(self.root, 'actionlint'), binary)
            binary.write_text('tampered')
            with self.assertRaisesRegex(RuntimeError, 'cache is invalid'):
                security.release_tool(self.root, 'actionlint')

    def test_bad_archive_or_link_never_publishes(self):
        for bad_hash, archive in [(True, self.archive()), (False, self.archive(tarfile.SYMTYPE))]:
            with self.assertRaises(RuntimeError):
                self.install(archive, bad_hash)
        self.assertFalse(list((self.root / '.local/ios/tools').rglob('verified.json')))

    def test_interrupted_publication_can_retry(self):
        with patch.object(security.os, 'replace', side_effect=OSError('publish interrupted')):
            with self.assertRaises(OSError):
                self.install()
        self.assertFalse([p for p in (self.root / '.local/ios/tools').rglob('actionlint') if p.is_file()])
        self.assertTrue(self.install().is_file())

    def test_download_failure_is_not_success(self):
        with patch.object(security, 'download', side_effect=OSError('offline')):
            with self.assertRaises(OSError):
                security.release_tool(self.root, 'actionlint')

    def test_wrong_version_is_not_executed_as_valid(self):
        with patch.object(security.subprocess, 'check_output', return_value='wrong\n'):
            with self.assertRaisesRegex(RuntimeError, 'version mismatch'):
                self.install()

    def test_workflows_all_selected_and_failures_propagate(self):
        directory = self.root / '.github/workflows'
        directory.mkdir(parents=True)
        for name in ['a.yml', 'b.yaml']:
            (directory / name).write_text('name: fixture')
        with patch.object(security, 'release_tool', return_value=Path('/controlled/actionlint')), patch.object(security.subprocess, 'run') as run:
            security.scan_workflows(self.root)
            command = run.call_args.args[0]
            self.assertEqual(len([a for a in command if a.endswith(('.yml', '.yaml'))]), 2)
            self.assertIn('-shellcheck=', command)
            run.side_effect = subprocess.CalledProcessError(1, command)
            with self.assertRaises(subprocess.CalledProcessError):
                security.scan_workflows(self.root)
        for file in directory.iterdir(): file.unlink()
        with patch.object(security, 'release_tool', return_value=Path('/controlled/actionlint')):
            with self.assertRaisesRegex(RuntimeError, 'No workflow'):
                security.scan_workflows(self.root)

    def scan(self, value, code=0, **options):
        calls = []
        actual_run = subprocess.run
        def execute(command, **kwargs):
            if command[0] == "git":
                return actual_run(command, **kwargs)
            calls.append(command)
            report = Path(command[command.index('--report-path')+1])
            findings = value(command) if callable(value) else value
            if findings is not None: report.write_text(json.dumps(findings))
            return subprocess.CompletedProcess(command, code, stdout=b'', stderr=b'never echo tool output')
        with patch.object(security, 'release_tool', return_value=Path('/controlled/gitleaks')), patch.object(security.subprocess, 'run', side_effect=execute):
            security.scan_secrets(self.root, **options)
        return calls

    def test_scans_source_and_commit_range_without_ignored_data(self):
        private = self.root / '.local/private.key'
        private.parent.mkdir(); private.write_text('private data')
        base = security.git(self.root, 'rev-parse', 'HEAD').decode().strip()
        calls = self.scan([], base=base)
        self.assertEqual(len(calls), 2)
        self.assertIn('--log-opts='+base+'..HEAD', calls[1])
        self.assertIn('--ignore-gitleaks-allow', calls[0])
        self.assertTrue(private.is_file())
        self.assertFalse(list((self.root / '.local/ios/tmp/ai-agent').iterdir()))

    def test_history_is_explicit_and_does_not_scan_private_tree(self):
        calls = self.scan([], history=True)
        self.assertEqual(len(calls), 1)
        self.assertIn('--log-opts=--all', calls[0])

    def test_failure_missing_report_and_invalid_base_refused(self):
        for value, code in [(None, 0), ({}, 0), ([], 20), ([], 2)]:
            with self.assertRaises(RuntimeError): self.scan(value, code)
        with self.assertRaisesRegex(RuntimeError, 'full commit'):
            self.scan([], base='HEAD~1')

    def test_exact_exception_expiry_changed_content_and_no_inline_bypass(self):
        entry = {'path':'source.txt', 'rule':'fixture-rule', 'lineSha256':hashlib.sha256(b'ordinary source').hexdigest(), 'reason':'synthetic regression material', 'expires':'2099-01-01'}
        file = self.root / 'config/ios-security-exceptions.json'
        file.write_text(json.dumps({'schema':1,'exceptions':[entry]}))
        finding = {'File':'source.txt','RuleID':'fixture-rule','StartLine':1,'EndLine':1}
        # Commit scan findings bind the actual committed bytes, not current file contents.
        finding['Commit'] = security.git(self.root,'rev-parse','HEAD').decode().strip()
        self.scan([finding], 20)
        (self.root / 'source.txt').write_text('changed # gitleaks:allow\n')
        with self.assertRaisesRegex(RuntimeError, 'detected secrets'): self.scan([finding],20)
        entry['expires']='2000-01-01'
        file.write_text(json.dumps({'schema':1,'exceptions':[entry]}))
        with self.assertRaisesRegex(RuntimeError, 'expired'): self.scan([])
        entry['expires']='2099-01-01'
        file.write_text(json.dumps({'schema':1,'exceptions':[entry,entry]}))
        with self.assertRaisesRegex(RuntimeError, 'duplicate'): self.scan([])

    def test_sensitive_filename_and_source_links_are_not_followed(self):
        (self.root / '.env').write_text('fixture only')
        with self.assertRaisesRegex(RuntimeError, 'Sensitive file names'): self.scan([])
        (self.root / '.env').unlink()
        (self.root / 'link.txt').symlink_to(self.root / 'source.txt')
        self.scan([])

    def test_stale_exception_and_unowned_finding_refused(self):
        (self.root / 'config/ios-security-exceptions.json').write_text(json.dumps({'schema':1,'exceptions':[{'path':'source.txt','rule':'fixture','lineSha256':'a'*64,'reason':'fixture','expires':'2099-01-01'}]}))
        with self.assertRaisesRegex(RuntimeError, 'no longer matches'): self.scan([])
        with self.assertRaisesRegex(RuntimeError, 'escaped'):
            self.scan([{'File':'../outside','RuleID':'fixture','StartLine':1,'EndLine':1}],20)


unittest.main()
