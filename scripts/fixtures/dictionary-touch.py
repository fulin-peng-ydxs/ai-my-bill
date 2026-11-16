#!/usr/bin/env python3
"""仅用于独立模拟器的 UI 夹具准备/回读；从不清空已有账本，不提供生产入口。"""
import json
import sqlite3
import sys
import unicodedata
import uuid
from pathlib import Path

mode, container, simulator_id, receipt_file = sys.argv[1:]
uuid.UUID(simulator_id)
folder = Path(container).resolve()
assert f'/CoreSimulator/Devices/{simulator_id}/data/Containers/Data/Application/' in str(folder)
database = folder / 'Library/OfflineLedger/ledgerSQLite.db'
assert database.is_file()
connection = sqlite3.connect(f'file:{database}?mode={"rw" if mode == "prepare" else "ro"}', uri=True)
connection.row_factory = sqlite3.Row
connection.execute('PRAGMA foreign_keys=ON')
receipt_path = Path(receipt_file)
try:
    if mode == 'prepare':
        # 只允许正式初始化后的空账本；不删除或复用用户/其他测试数据。
        assert connection.execute('SELECT count(*) FROM dictionary_item').fetchone()[0] == 8
        for table in ['ledger_entry', 'daily_entry_template', 'product_merge_event']:
            assert connection.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == 0
        ids = {key: str(uuid.uuid4()) for key in ['source', 'target', 'maintenance', 'category', 'unit', 'funding', 'entry', 'template']}
        with connection:
            for key, kind, name in [('source', 'PRODUCT', '触摸合并源'), ('target', 'PRODUCT', '触摸合并目标'),
                                    ('maintenance', 'PRODUCT', '触摸维护商品'), ('category', 'EXPENSE_CATEGORY', '触摸分类'),
                                    ('unit', 'UNIT', '触摸单位'), ('funding', 'FUNDING_CHANNEL', '触摸资金')]:
                normalized = unicodedata.normalize('NFKC', name).lower()
                connection.execute("INSERT INTO dictionary_item(id,kind,name,normalized_name,status,sort_order) VALUES(?,?,?,?,'ACTIVE',10)",
                                   (ids[key], kind, name, normalized))
            connection.execute("""INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
                product_id,product_name_snapshot,primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot)
                VALUES(?,'EXPENSE',1543,?,'历史现金','2026-11-15T01:00:00.000Z','2026-11-15',?,'历史苹果',?,'历史分类',?,'历史斤')""",
                               (ids['entry'], ids['funding'], ids['source'], ids['category'], ids['unit']))
            connection.execute("""INSERT INTO daily_entry_template(id,entry_type,display_name,normalized_name,product_id,product_name_snapshot,primary_category_id,
                primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price_scaled,quantity_scaled,amount_cents,funding_channel_id,funding_channel_name_snapshot,last_used_at,created_at,updated_at)
                VALUES(?,'EXPENSE','触摸合并源','触摸合并源',?,'触摸合并源',?,'触摸分类',?,'触摸单位',123456,1250,1543,?,'触摸资金',
                '2026-11-15T01:00:00.000Z','2026-11-15T01:00:00.000Z','2026-11-15T01:00:00.000Z')""",
                               (ids['template'], ids['source'], ids['category'], ids['unit'], ids['funding']))
        receipt_path.write_text(json.dumps(ids, ensure_ascii=False, indent=2))
        print('DICTIONARY_TOUCH_FIXTURE_PREPARED')
    elif mode == 'check':
        ids = json.loads(receipt_path.read_text())
        def row(statement, values=()):
            result = connection.execute(statement, values).fetchone()
            assert result is not None, statement
            return result
        assert row("SELECT status FROM dictionary_item WHERE id=?", (ids['maintenance'],))['status'] == 'ACTIVE'
        assert row("SELECT count(*) AS n FROM dictionary_item WHERE name='Touch Renamed'")['n'] == 1
        assert row("SELECT count(*) AS n FROM dictionary_item WHERE name='Touch Created'")['n'] == 0
        for kind, name in [('EXPENSE_CATEGORY', 'Touch Category'), ('UNIT', 'Touch Unit'), ('FUNDING_CHANNEL', 'Touch Funding')]:
            assert row('SELECT count(*) AS n FROM dictionary_item WHERE kind=? AND name=?', (kind, name))['n'] == 1
        entry = row('SELECT product_id,product_name_snapshot,CAST(amount_cents AS TEXT) AS cents,row_version FROM ledger_entry WHERE id=?', (ids['entry'],))
        assert tuple(entry) == (ids['target'], '历史苹果', '1543', 2), dict(entry)
        template = row('SELECT product_id,display_name,CAST(amount_cents AS TEXT) AS cents FROM daily_entry_template WHERE id=?', (ids['template'],))
        assert tuple(template) == (ids['target'], '触摸合并目标', '1543'), dict(template)
        assert row('SELECT status FROM dictionary_item WHERE id=?', (ids['source'],))['status'] == 'INACTIVE'
        assert row('SELECT merged_into_id FROM product_details WHERE product_id=?', (ids['source'],))['merged_into_id'] == ids['target']
        events = connection.execute('SELECT source_product_id,target_product_id,affected_ledger_entries,affected_templates FROM product_merge_event').fetchall()
        assert len(events) == 1 and tuple(events[0]) == (ids['source'], ids['target'], 1, 1)
        assert row("SELECT count(*) AS n FROM idempotency_result WHERE operation='product.merge'")['n'] == 1
        print('DICTIONARY_TOUCH_SQLITE_VERIFIED history=1543 snapshot=历史苹果 template=retained events=1')
    else:
        raise ValueError('mode must be prepare or check')
    assert connection.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    assert not connection.execute('PRAGMA foreign_key_check').fetchall()
finally:
    connection.close()
