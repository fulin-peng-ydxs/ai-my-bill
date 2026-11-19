#!/usr/bin/env python3
"""受管模拟器专用空账本基线；App 已终止后才由调度器捕获/恢复，不接受任意备份路径。"""
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import uuid
from contextlib import closing
from pathlib import Path

if not __debug__:
    raise RuntimeError('基线安全检查不允许 Python 优化模式')

def owned_context(context_file, container, app_hash, rebind=False):
    context_file, container = Path(context_file), Path(container)
    session = context_file.parent
    assert session.parent == Path.cwd() / '.local/ios/tmp/ai-agent'
    assert re.fullmatch(r'ios-debug-[A-Za-z0-9]+', session.name)
    assert session.resolve() == session and context_file.name == 'test-context.json'
    assert context_file.is_file() and not context_file.is_symlink()
    assert context_file.stat().st_uid == os.getuid() and context_file.stat().st_mode & 0o077 == 0
    assert context_file.stat().st_size <= 4096
    context = json.loads(context_file.read_text())
    assert context['schema'] == 1 and context['kind'] == 'ios-debug' and context['state'] == 'open'
    assert context['appId'] == 'com.mybill.offline'
    uuid.UUID(context['runId'])
    uuid.UUID(context['simulatorId'])
    assert context['name'] == '我的账单调试-' + context['runId']
    suffix = '/CoreSimulator/Devices/' + context['simulatorId'] + '/data/Containers/Data/Application/'
    def owned_container(folder):
        assert folder.is_absolute() and folder.resolve() == folder
        assert suffix in str(folder) and str(uuid.UUID(folder.name)).lower() == folder.name.lower()
    owned_container(container)
    # 安装回执由调度器在核验实际 bundle 后产生；禁止将其他会话/安装的数据当作合成数据重置。
    lease_file = session / 'ui-install.json'
    assert lease_file.is_file() and not lease_file.is_symlink()
    assert lease_file.stat().st_uid == os.getuid() and lease_file.stat().st_mode & 0o077 == 0
    assert lease_file.stat().st_size <= 4096
    lease = json.loads(lease_file.read_text())
    identity = {key: context[key] for key in ['runId', 'simulatorId', 'appId']}
    identity.update(container=str(container), appHash=app_hash)
    assert re.fullmatch('[a-f0-9]{64}', app_hash)
    owned_container(Path(lease['container']))
    assert all(lease.get(k) == v for k, v in identity.items() if k != 'container')
    if not rebind: assert lease == identity
    ledger = container / 'Library/OfflineLedger'
    assert ledger.resolve() == ledger and ledger.is_dir()
    assert not any(p.is_symlink() for p in ledger.rglob('*'))
    return session, ledger, identity


def validate_database(file, empty=False):
    with closing(sqlite3.connect(file.as_uri() + '?mode=ro', uri=True)) as db:
        assert db.execute('PRAGMA quick_check').fetchall() == [('ok',)]
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        meta = db.execute('SELECT initialized,schema_version,dataset_id FROM ledger_meta WHERE singleton=1').fetchone()
        assert meta and meta[0] == 1
        if empty:
            assert db.execute('SELECT count(*) FROM dictionary_item').fetchone()[0] == 8
            assert db.execute('SELECT count(*) FROM dictionary_item WHERE seed_key IS NULL').fetchone()[0] == 0
            for table in ['ledger_entry', 'daily_entry_template', 'product_merge_event',
                          'expense_adjustment', 'ledger_draft', 'idempotency_result']:
                assert db.execute('SELECT count(*) FROM ' + table).fetchone()[0] == 0
        return {'schemaVersion': meta[1], 'datasetId': meta[2]}


def checksum(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def run(mode, context_file, container, app_hash):
    session, ledger, identity = owned_context(context_file, container, app_hash, mode == 'rebind')
    baseline = session / 'ui-baseline'
    database = ledger / 'ledgerSQLite.db'
    if mode == 'capture':
        assert not baseline.exists(), '基线存在时拒绝覆盖'
        meta = validate_database(database, empty=True)
        staging = Path(tempfile.mkdtemp(prefix='ui-baseline-', dir=session))
        try:
            target = staging / 'ledgerSQLite.db'
            with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as source:
                with closing(sqlite3.connect(target)) as destination:
                    source.backup(destination)
            validate_database(target, empty=True)
            (staging / 'receipt.json').write_text(json.dumps({**identity, **meta, 'sha256': checksum(target)}))
            staging.rename(baseline)
        finally:
            if staging.exists(): shutil.rmtree(staging)
    elif mode in ['validate', 'restore', 'rebind']:
        assert baseline.resolve() == baseline and not any(p.is_symlink() for p in baseline.rglob('*'))
        receipt = json.loads((baseline / 'receipt.json').read_text())
        # container 保留捕获来源；XCTest 可搬迁同一数据沙盒，不能只凭路径变化重装。
        # 当前路径仍须有安装回执绑定，迁移前另外核验实际库的不可变数据集和 schema。
        assert all(receipt.get(k) == v for k, v in identity.items() if k != 'container')
        source = baseline / 'ledgerSQLite.db'
        assert checksum(source) == receipt['sha256']
        assert validate_database(source, empty=True) == {k: receipt[k] for k in ['schemaVersion', 'datasetId']}
        if mode in ['restore', 'rebind']:
            assert validate_database(database) == {k: receipt[k] for k in ['schemaVersion', 'datasetId']}
        if mode == 'rebind':
            lease_file = session / 'ui-install.json'
            pending = lease_file.with_name('ui-install-' + str(uuid.uuid4()) + '.tmp')
            try:
                with open(pending, 'x') as output:
                    os.chmod(pending, 0o600)
                    json.dump(identity, output)
                pending.replace(lease_file)
            finally:
                if pending.exists(): pending.unlink()
        if mode == 'restore':
            # 先完整校验，准备同文件系统替换目录；失败回滚原目录，不留下半份账本。
            staging = Path(tempfile.mkdtemp(prefix='offline-reset-', dir=ledger.parent))
            previous = ledger.with_name('offline-previous-' + str(uuid.uuid4()))
            try:
                shutil.copy2(source, staging / 'ledgerSQLite.db')
                ledger.rename(previous)
                try:
                    staging.rename(ledger)
                except BaseException:
                    previous.rename(ledger)
                    raise
                shutil.rmtree(previous)
            finally:
                if staging.exists(): shutil.rmtree(staging)
    else:
        raise ValueError('unknown baseline operation')
    print('UI_BASELINE_' + mode.upper() + '_VERIFIED')


if __name__ == '__main__':
    run(*sys.argv[1:])
