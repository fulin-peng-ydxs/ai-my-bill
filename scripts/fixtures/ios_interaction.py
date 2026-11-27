"""独立模拟器 iOS 交互夹具：只读参照/回读，触摸与草稿写入必须由原 App 完成。"""
import hashlib
import json
import os
import sqlite3
import uuid
import re
import time
from datetime import datetime, timezone
from contextlib import closing


def fingerprint(connection):
    """保护正式业务、字典与 schema；草稿/偏好按场景另验，维护时钟允许正常推进。"""
    schema = [list(row) for row in connection.execute(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")]
    content = {}
    for table, in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        if table in ('ledger_draft', 'preference', 'maintenance_state'):
            continue
        # 名称仅取自实际 schema，仍引用标识符以拒绝 SQL 拼接歧义。
        quoted = '"' + table.replace('"', '""') + '"'
        content[table] = sorted(json.dumps(list(row), ensure_ascii=False) for row in connection.execute('SELECT * FROM ' + quoted))
    return hashlib.sha256(json.dumps([schema, content], sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def run(check, container, simulator_id, receipt, cases):
    """准备不改库且不覆盖回执；回读须保持安装、数据集、场景和不可变业务参照。"""
    if not __debug__:
        raise RuntimeError('安全校验不允许 Python 优化模式')
    assert cases and cases == sorted(set(cases)) and set(cases) <= {61, 62, 63}
    assert container.is_absolute() and container.resolve() == container
    suffix = '/CoreSimulator/Devices/' + simulator_id + '/data/Containers/Data/Application/'
    assert suffix in str(container) and str(uuid.UUID(container.name)).lower() == container.name.lower()
    assert receipt.is_absolute() and receipt.resolve() == receipt and not receipt.is_symlink()
    database = container / 'Library/OfflineLedger/ledgerSQLite.db'
    assert database.is_file() and database.resolve() == database
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as connection:
        # 一致只读快照，不把多个查询间的数据集切换拼接成合法结果。
        connection.execute('BEGIN')
        assert connection.execute('PRAGMA quick_check').fetchall() == [('ok',)]
        assert connection.execute('PRAGMA foreign_key_check').fetchall() == []
        meta = connection.execute('SELECT dataset_id,schema_version,initialized FROM ledger_meta WHERE singleton=1').fetchone()
        assert meta and meta[2] == 1
        identity = {'container': str(container), 'simulatorId': simulator_id,
                    'dataset': meta[0], 'schemaVersion': meta[1]}
        for table in ('ledger_entry', 'daily_entry_template', 'product_merge_event', 'expense_adjustment', 'idempotency_result'):
            assert connection.execute('SELECT count(*) FROM ' + table).fetchone()[0] == 0, '交互路径不能产生正式业务写入'
        assert connection.execute('SELECT count(*) FROM dictionary_item').fetchone()[0] == 8
        categories = dict(connection.execute("SELECT name,id FROM dictionary_item WHERE kind='INCOME_CATEGORY' AND status='ACTIVE'"))
        for name, index in [('工资', 1), ('其他收入', 8)]:
            assert categories.get(name) == '61000000-0000-0000-0000-' + str(index).zfill(12)
        immutable = fingerprint(connection)
        preferences = dict(connection.execute('SELECT key,value FROM preference'))
        if not check:
            assert connection.execute('SELECT count(*) FROM ledger_draft').fetchone()[0] == 0, '拒绝复用上一轮草稿'
            assert preferences.get('recentEntryType') == '"EXPENSE"'
            reference = {'schema': 1, 'protocol': 'ios-interaction', 'identity': identity,
                         'cases': cases, 'immutable': immutable, 'preferences': preferences,
                         'capturedAt': int(time.time() * 1000)}
            # 排他创建，失败只留下未封存回执；调用方的新 run 不覆盖旧结果或失败锁。
            with open(receipt, 'x') as output:
                os.chmod(receipt, 0o600)
                json.dump(reference, output, ensure_ascii=False)
                output.flush()
                os.fsync(output.fileno())
            print('IOS_INTERACTION_FIXTURE_PREPARED cases=' + ','.join(map(str, cases)))
            return
        assert receipt.is_file() and receipt.stat().st_size <= 65536
        source = json.loads(receipt.read_text())
        assert source['schema'] == 1 and source['protocol'] == 'ios-interaction'
        assert source['identity'] == identity and source['cases'] == cases
        assert source['immutable'] == immutable, '业务或默认字典发生非预期改写'
        expected_preferences = {**source['preferences'], 'recentEntryType': '"INCOME"' if 63 in cases else '"EXPENSE"'}
        if 62 in cases or 63 in cases:
            # 切换类型经正式 PreferenceService 保存，同时更新唯一元数据键；其他键仍逐项精确比较。
            updated = json.loads(preferences.get('updatedAt', 'null'))
            assert isinstance(updated, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', updated)
            elapsed = datetime.strptime(updated, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc) - datetime(1970, 1, 1, tzinfo=timezone.utc)
            updated_ms = elapsed.days * 86400000 + elapsed.seconds * 1000 + elapsed.microseconds // 1000
            assert type(source.get('capturedAt')) is int and source['capturedAt'] <= updated_ms <= int(time.time() * 1000), '偏好保存时间不属于本轮交互'
            expected_preferences['updatedAt'] = preferences['updatedAt']
        assert preferences == expected_preferences, '交互路径改写了无关偏好'
        drafts = {}
        for dataset, kind, version, raw in connection.execute('SELECT dataset_id,entry_type,schema_version,data_json FROM ledger_draft'):
            assert dataset == meta[0] and version == 1 and kind in ('EXPENSE', 'INCOME') and kind not in drafts
            data = json.loads(raw)
            assert isinstance(data, dict)
            drafts[kind] = data
        if 61 in cases:
            assert drafts.get('EXPENSE', {}).get('unitPrice') == '12.3456', '键盘输入必须经 App 持久化'
        if 62 in cases or 63 in cases:
            chosen = '工资' if 63 in cases else '其他收入'
            assert drafts.get('INCOME', {}).get('incomeCategoryId') == categories[chosen], '候选选择未持久化'
        print('IOS_INTERACTION_SQLITE_VERIFIED cases=' + ','.join(map(str, cases)))
