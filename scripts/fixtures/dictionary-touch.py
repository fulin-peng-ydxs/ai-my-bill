#!/usr/bin/env python3
"""仅用于独立模拟器的 UI 夹具准备/回读；从不清空已有账本，不提供生产入口。"""
import json
import re
import time
from contextlib import closing
import sqlite3
import sys
import unicodedata
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path

mode, container, simulator_id, receipt_file = sys.argv[1:]
uuid.UUID(simulator_id)
folder = Path(container).resolve()
assert f'/CoreSimulator/Devices/{simulator_id}/data/Containers/Data/Application/' in str(folder)
database = folder / 'Library/OfflineLedger/ledgerSQLite.db'
if mode == 'wait-initialized':
    # 仅准备本轮模拟器环境，读回正式初始化提交；不写库，也不计入冷启动性能。
    for attempt in range(120):
        if database.is_file():
            try:
                with closing(sqlite3.connect(f'file:{database}?mode=ro', uri=True)) as probe:
                    if probe.execute('SELECT initialized FROM ledger_meta WHERE singleton=1').fetchone() == (1,):
                        print('ISOLATED_NATIVE_HOST_INITIALIZED')
                        sys.exit(0)
            except sqlite3.Error:
                # 建表/迁移尚未提交时继续有界等待；到期仍失败，不能当作空账本放行。
                pass
        time.sleep(0.5)
    raise RuntimeError('本轮模拟器的正式账本未在准备预算内初始化')
assert database.is_file()
# debug 数据仅由已校验会话中的全新 App 初始化；复用同一夹具，不开放任意 SQL 或路径。
interaction_match = re.fullmatch(r'debug-(check-)?interaction-((?:6[1-3])(?:,6[1-3])*)', mode)
if interaction_match:
    # 专用协议只读捕获空账本及回读真实草稿，不预写页面待验结果。
    from ios_interaction import run
    run(bool(interaction_match[1]), Path(container), simulator_id, Path(receipt_file),
        [int(case) for case in interaction_match[2].split(',')])
    sys.exit(0)
data_match = re.fullmatch(r'debug-(check-)?data-((?:5[3-9]|60)(?:,(?:5[3-9]|60))*)', mode)
data_cases = [int(case) for case in data_match[2].split(',')] if data_match else []
if data_match: mode = 'debug-check' if data_match[1] else 'prepare-data'
report_match = re.fullmatch(r'debug-(check-)?report-((?:3[6-9]|(?:4[0-9]|5[0-2]))(?:,(?:3[6-9]|(?:4[0-9]|5[0-2])))*)', mode)
report_cases = [int(case) for case in report_match[2].split(',')] if report_match else []
if report_match:
    mode = 'debug-check' if report_match[1] else 'prepare'
query_match = re.fullmatch(r'debug-(check-)?query-((?:3[1-5])(?:,3[1-5])*)', mode)
query_cases = [int(case) for case in query_match[2].split(',')] if query_match else []
if query_match:
    mode = 'debug-check' if query_match[1] else 'prepare'
lifecycle_match = re.fullmatch(r'debug-(check-)?lifecycle-((?:2[6-9]|30)(?:,(?:2[6-9]|30))*)', mode)
lifecycle_cases = [int(case) for case in lifecycle_match[2].split(',')] if lifecycle_match else []
if lifecycle_match:
    mode = 'debug-check' if lifecycle_match[1] else 'prepare'
personal_match = re.fullmatch(r'debug-(check-)?personal-((?:1[7-9]|2[0-5])(?:,(?:1[7-9]|2[0-5]))*)', mode)
personal_cases = [int(case) for case in personal_match[2].split(',')] if personal_match else []
if personal_match:
    mode = 'debug-check' if personal_match[1] else 'prepare'
debug_match = re.fullmatch(r'debug-(check-)?(\d|1[0-6]|entry-cycle|income-note|income-note-after-save)', mode)
debug_entry_cycle = bool(debug_match and debug_match[2] == 'entry-cycle')
debug_income_note = bool(debug_match and debug_match[2] == 'income-note')
debug_income_after_save = bool(debug_match and debug_match[2] == 'income-note-after-save')
debug_case = 16 if debug_entry_cycle or debug_income_note or debug_income_after_save else int(debug_match[2]) if debug_match else None
debug_check = bool(debug_match and debug_match[1])
if debug_match:
    mode = 'debug-check' if debug_check else 'prepare'
connection = sqlite3.connect(f'file:{database}?mode={"rw" if mode in ("prepare", "prepare-paging", "prepare-entry", "prepare-personal", "prepare-lifecycle", "prepare-query", "prepare-report", "prepare-data") else "ro"}', uri=True)
def add_paging_items(connection, ids, kinds=('PRODUCT', 'UNIT')):
    """完整和局部触摸共用相同末页数据，始终拒绝覆盖既有同名样本。"""
    assert connection.execute("SELECT count(*) FROM dictionary_item WHERE name LIKE 'PageProduct%' OR name LIKE 'PageUnit%'").fetchone()[0] == 0
    ids['paging'] = {}
    for kind, prefix in [('PRODUCT', 'PageProduct'), ('UNIT', 'PageUnit')]:
        if kind not in kinds: continue
        for index in range(21):
            key = prefix + f'{index:02}'
            item_id = str(uuid.uuid4())
            ids['paging'][key] = item_id
            connection.execute("INSERT INTO dictionary_item(id,kind,name,normalized_name,status,sort_order) VALUES(?,?,?,?,'ACTIVE',?)", (item_id, kind, key, key.lower(), index * 10))

def add_entry_items(connection):
    # 只添加本轮合成字典与一条过往收入名称；所有待验收写入由原页面完成。
    assert connection.execute("SELECT count(*) FROM dictionary_item WHERE id LIKE 't6-%'").fetchone()[0] == 0
    for key, kind, name in [('product', 'PRODUCT', '测试苹果'), ('category', 'EXPENSE_CATEGORY', '测试水果'),
                             ('unit', 'UNIT', '斤'), ('funding', 'FUNDING_CHANNEL', '测试现金'), ('payer', 'PAYER', '合成公司')]:
        connection.execute("INSERT INTO dictionary_item(id,kind,name,normalized_name,status,sort_order) VALUES(?,?,?,?,'ACTIVE',100)",
                           ('t6-'+key, kind, name, name))
    connection.execute("UPDATE product_details SET default_primary_category_id='t6-category',default_unit_id='t6-unit',last_unit_price_scaled=123456,last_funding_channel_id='t6-funding',updated_at='2099-01-01' WHERE product_id='t6-product'")
    connection.execute("""INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
        income_name,normalized_income_name,payer_id,payer_name_snapshot,income_category_id,income_category_name_snapshot,created_at,updated_at)
        VALUES('t6-name-history','INCOME',100,'t6-funding','测试现金','2000-01-01T00:00:00.000Z','2000-01-01','测试工资','测试工资','t6-payer','合成公司',
        '61000000-0000-0000-0000-000000000001','工资','2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z')""")


def check_entries(connection, case):
    if case == 15:
        row = connection.execute("SELECT CAST(unit_price_scaled AS TEXT),CAST(quantity_scaled AS TEXT),CAST(calculated_amount_cents AS TEXT),CAST(amount_cents AS TEXT),product_name_snapshot,unit_name_snapshot FROM ledger_entry WHERE product_id='t6-product'").fetchall()
        assert [tuple(r) for r in row] == [('123456', '1250', '1543', '1500', '测试苹果', '斤')]
    else:
        rows = connection.execute("SELECT CAST(amount_cents AS TEXT),income_name,payer_name_snapshot,note,row_version,product_id,quantity_scaled FROM ledger_entry WHERE payer_id='t6-payer' AND id<>'t6-name-history'").fetchall()
        assert [tuple(r) for r in rows] == [('100000', '测试工资', '合成公司', 'T6 edited', 2, None, None)]
    print('ENTRY_TOUCH_SQLITE_VERIFIED case=' + str(case))


def income_note_baseline(connection, target):
    """局部备注编辑只允许目标备注及版本变化，不把预置收入算作页面保存证明。"""
    rows = {table: [list(row) for row in connection.execute(
        f'SELECT * FROM {table}' + (' WHERE id<>?' if table == 'ledger_entry' else '') + (' ORDER BY product_id' if table == 'product_details' else ' ORDER BY id'),
        (target,) if table == 'ledger_entry' else ())]
        for table in ['ledger_entry', 'dictionary_item', 'product_details', 'daily_entry_template']}
    rows['dataset'] = [list(row) for row in connection.execute('SELECT dataset_id,schema_version,initialized FROM ledger_meta ORDER BY singleton')]
    return rows


def add_income_note_source(connection, ids):
    now = datetime.now(ZoneInfo('Asia/Shanghai'))
    stamp = now.astimezone(ZoneInfo('UTC')).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    row = dict(connection.execute("SELECT * FROM ledger_entry WHERE id='t6-name-history'").fetchone())
    # 原页面的 datetime-local 以分钟保存，局部来源与真实前序保存的精度一致。
    business_stamp = now.replace(second=0, microsecond=0).astimezone(ZoneInfo('UTC')).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    row.update(id=str(uuid.uuid4()), amount_cents=100000, business_time=business_stamp, business_date=now.date().isoformat(),
               created_at=stamp, updated_at=stamp, note=None, row_version=1)
    connection.execute('INSERT INTO ledger_entry (' + ','.join(row) + ') VALUES (' + ','.join('?' for _ in row) + ')', tuple(row.values()))
    connection.execute("INSERT OR REPLACE INTO preference(key,value) VALUES('recentEntryType','\"INCOME\"')")
    ids['incomeNoteTarget'] = row['id']
    ids['incomeNoteBaseline'] = income_note_baseline(connection, row['id'])
    ids['incomeNoteOriginal'] = row


def add_income_save_drafts(connection, ids):
    """只准备原连续保存的输入状态；正式收入必须由该页面前置创建。"""
    dataset = connection.execute('SELECT dataset_id FROM ledger_meta WHERE singleton=1').fetchone()[0]
    now = datetime.now(ZoneInfo('Asia/Shanghai')).replace(second=0, microsecond=0)
    local = now.strftime('%Y-%m-%dT%H:%M')
    stamp = now.astimezone(ZoneInfo('UTC')).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    drafts = {
        'EXPENSE': {'unitPrice': '77', 'quantity': '1', 'paidAmount': '77', 'occurredAt': local,
                    'productSelectionState': json.dumps({'version': 1, 'productId': '', 'paidManual': False, 'rollback': {}}, separators=(',', ':'))},
        'INCOME': {'incomeName': '测试工资', 'incomeCategoryId': '61000000-0000-0000-0000-000000000001',
                   'payerId': 't6-payer', 'fundingChannelId': 't6-funding', 'amount': '', 'occurredAt': local, 'note': ''},
    }
    for entry_type, data in drafts.items():
        connection.execute('INSERT INTO ledger_draft VALUES(?,?,1,?,?,?)', (dataset, entry_type, json.dumps(data), stamp, stamp))
    connection.execute("INSERT OR REPLACE INTO preference(key,value) VALUES('recentEntryType','\"INCOME\"')")
    ids['incomeSaveBaseline'] = income_note_baseline(connection, '')
    ids['incomeSaveBusinessTime'] = stamp
    ids['incomeSaveBusinessDate'] = now.date().isoformat()


def add_personal_items(connection, prefix='t7', label='日常', dictionary_ids=None, occurred_at=None, ledger_ids=None):
    item_ids = dictionary_ids or {key:prefix+'-'+key for key in ['product','category','unit','funding','payer']}
    assert connection.execute("SELECT count(*) FROM dictionary_item WHERE id LIKE ?", (prefix+'-%',)).fetchone()[0] == 0
    for key, kind, name in [('product','PRODUCT','苹果'),('category','EXPENSE_CATEGORY','水果'),('unit','UNIT','份'),('funding','FUNDING_CHANNEL','现金'),('payer','PAYER','公司')]:
        connection.execute("INSERT INTO dictionary_item(id,kind,name,normalized_name,status,sort_order) VALUES(?,?,?,?,'ACTIVE',100)", (item_ids[key],kind,label+name,label+name))
    now = occurred_at or datetime.now(ZoneInfo('Asia/Shanghai'))
    stamp = now.astimezone(ZoneInfo('UTC')).isoformat(timespec='milliseconds').replace('+00:00','Z')
    connection.execute("""INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
        product_id,product_name_snapshot,normalized_product_name_snapshot,primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,
        unit_price_scaled,quantity_scaled,calculated_amount_cents,note,updated_at) VALUES(?,'EXPENSE',1500,?,?,?,?,?,?,?,?,?,?,?,123456,1250,1543,'来源备注',?)""",
        ((ledger_ids or {}).get('expense',prefix+'-expense'),item_ids['funding'],label+'现金',stamp,now.date().isoformat(),item_ids['product'],label+'苹果',label+'苹果',item_ids['category'],label+'水果',item_ids['unit'],label+'份',stamp))
    connection.execute("""INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
        income_name,normalized_income_name,payer_id,payer_name_snapshot,income_category_id,income_category_name_snapshot,note,updated_at)
        VALUES(?,'INCOME',100000,?,?,?,?,?,?,?,?,'61000000-0000-0000-0000-000000000001','工资','来源收入备注',?)""",
        ((ledger_ids or {}).get('income',prefix+'-income'),item_ids['funding'],label+'现金',stamp,now.date().isoformat(),label+'工资',label+'工资',item_ids['payer'],label+'公司',stamp))


def add_report_items(connection):
    # UI runner 和 SQL 回归共用绝对范围；准备与执行跨午夜/月/年不改变样本或期望。
    fixture = report_touch_fixture()
    now = datetime.fromisoformat(fixture['occurredAt'].replace('Z', '+00:00')).astimezone(ZoneInfo('Asia/Shanghai'))
    dictionary_ids = {key:str(uuid.uuid4()) for key in ['product','category','unit','funding','payer']}
    add_personal_items(connection, 't10', '报表', dictionary_ids, now)
    stamp = now.astimezone(ZoneInfo('UTC')).isoformat(timespec='milliseconds').replace('+00:00','Z')
    connection.execute("INSERT INTO expense_adjustment(id,original_expense_id,adjustment_type,amount_cents,business_time,business_date,note,created_at,updated_at,search_text) VALUES('t10-refund','t10-expense','REFUND',300,?,?,'报表退款',?,?,'退款 报表退款')",(stamp,now.date().isoformat(),stamp,stamp))

def add_dimension_items(connection):
    """本轮专用报表夹具；固定业务日期，读回时核验所有样本未被页面分析修改。"""
    fixture = report_touch_fixture()
    stamp = datetime.fromisoformat(fixture['occurredAt'].replace('Z', '+00:00'))
    base = dict(connection.execute("SELECT * FROM ledger_entry WHERE id='t10-expense'").fetchone())
    def clone(identifier, at, cents, quantity=1000, **changes):
        row = dict(base)
        iso = at.isoformat(timespec='milliseconds').replace('+00:00','Z')
        row.update(id=str(uuid.uuid4()), business_time=iso, business_date=at.astimezone(ZoneInfo('Asia/Shanghai')).date().isoformat(),
                   amount_cents=cents, quantity_scaled=quantity, unit_price_scaled=cents*100, calculated_amount_cents=(cents*100*quantity+50000)//100000,
                   created_at=iso, updated_at=iso)
        row.update(changes)
        columns = list(row)
        assert all(re.fullmatch(r'[a-z_]+', key) for key in columns)
        connection.execute('INSERT INTO ledger_entry('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',tuple(row[key] for key in columns))
    for i, days in enumerate([180,100,50]): clone('t11-history-'+str(i), stamp-timedelta(days=days), 1000)
    clone('t11-equal',stamp,3000,2000)
    clone('t11-high',stamp,1501)
    dictionary_ids = {key:str(uuid.uuid4()) for key in ['unit','purchase','location','duplicate']}
    for key,kind,name in [('unit','UNIT','报表箱'),('purchase','PURCHASE_CHANNEL','未指定'),('location','LOCATION_LABEL','未指定'),('duplicate','PRODUCT','报表重复商品')]:
        connection.execute("INSERT INTO dictionary_item(id,kind,name,normalized_name,status) VALUES(?,?,?,?,'ACTIVE')",(dictionary_ids[key],kind,name,name))
    clone('t11-unit',stamp,2000,2000,unit_id=dictionary_ids['unit'],unit_name_snapshot='报表箱',purchase_channel_id=dictionary_ids['purchase'],purchase_channel_name_snapshot='未指定',location_label_id=dictionary_ids['location'],location_label_name_snapshot='未指定')
    for i,minutes in enumerate([0,9,20]):
        clone('t11-duplicate-'+str(i),stamp+timedelta(minutes=minutes),700,product_id=dictionary_ids['duplicate'],product_name_snapshot='报表重复商品',normalized_product_name_snapshot='报表重复商品')
    snapshot = [dict(row) for row in connection.execute("SELECT * FROM ledger_entry ORDER BY id")]
    return snapshot

def report_touch_fixture():
    return json.loads((Path(__file__).resolve().parents[2] / 'app/test-support/reportTouchFixture.json').read_text())

def check_reports(connection, cases):
    rows = connection.execute("SELECT id,amount_cents,row_version,note FROM ledger_entry WHERE id LIKE 't10-%' ORDER BY id").fetchall()
    assert len(rows) == 2
    expected = [('t10-expense',1600 if 38 in cases else 1500,2 if 38 in cases else 1,'来源备注'),('t10-income',100000,1,'来源收入备注')]
    assert [tuple(row) for row in rows] == expected
    row = connection.execute("SELECT amount_cents,status,row_version,original_expense_id FROM expense_adjustment WHERE id='t10-refund'").fetchone()
    assert tuple(row) == (300,'EFFECTIVE',1,'t10-expense')
    fixture = report_touch_fixture()
    dates = connection.execute("SELECT business_time,business_date FROM ledger_entry WHERE id LIKE 't10-%' UNION ALL SELECT business_time,business_date FROM expense_adjustment WHERE id='t10-refund'").fetchall()
    assert [tuple(row) for row in dates] == [(fixture['occurredAt'],fixture['endDate'])] * 3
    if any(case >= 43 for case in cases):
        expected_snapshot = json.loads(receipt_path.read_text())['dimensionSnapshot']
        actual_snapshot = [dict(row) for row in connection.execute("SELECT * FROM ledger_entry ORDER BY id")]
        assert actual_snapshot == expected_snapshot, '多维/质量分析不能改写样本'
    print('REPORT_TOUCH_SQLITE_VERIFIED cases=' + ','.join(map(str,cases)))

def add_query_items(connection):
    """只准备查询样本；编辑备注、筛选和翻页结果均由真实页面产生。"""
    assert connection.execute("SELECT count(*) FROM ledger_entry WHERE id LIKE 't9-%'").fetchone()[0] == 0
    ids = {key: str(uuid.uuid4()) for key in ['product','category','unit','funding','payer']}
    for key, kind, name in [('product','PRODUCT','明细苹果'),('category','EXPENSE_CATEGORY','明细水果'),
            ('unit','UNIT','份'),('funding','FUNDING_CHANNEL','明细现金'),('payer','PAYER','明细公司')]:
        connection.execute("INSERT INTO dictionary_item(id,kind,name,normalized_name,status) VALUES(?,?,?,?,'ACTIVE')", (ids[key],kind,name,name))
    now = datetime.now(ZoneInfo('Asia/Shanghai'))
    stamp = now.astimezone(ZoneInfo('UTC')).isoformat(timespec='milliseconds').replace('+00:00','Z')
    connection.execute("""INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
        product_id,product_name_snapshot,normalized_product_name_snapshot,primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,
        unit_price_scaled,quantity_scaled,calculated_amount_cents,created_at,updated_at,search_text,adjustment_source_search_text)
        VALUES('t9-expense','EXPENSE',1500,?,'明细现金',?,?,?,?,?,?,?,?,'份',150000,1000,1500,?,?,'明细苹果 明细水果 明细现金','明细苹果 明细水果 明细现金')""",
        (ids['funding'],stamp,now.date().isoformat(),ids['product'],'明细苹果','明细苹果',ids['category'],'明细水果',ids['unit'],stamp,stamp))
    for index in range(23):
        key = 't9-income' if index == 22 else f't9-query-{index:02}'
        name = '明细工资' if index == 22 else f'查询工资{index:02}' + (' 超长名称用于检查原明细行自然换行与金额可读性' if index == 20 else '')
        when = datetime.fromtimestamp(now.timestamp()-(86400 if index == 21 else 0),ZoneInfo('Asia/Shanghai'))
        occurred = when.astimezone(ZoneInfo('UTC')).isoformat(timespec='milliseconds').replace('+00:00','Z')
        connection.execute("""INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
            income_name,normalized_income_name,payer_id,payer_name_snapshot,income_category_id,income_category_name_snapshot,created_at,updated_at,search_text)
            VALUES(?,'INCOME',100000,?,'明细现金',?,?,?,?,?,'明细公司','61000000-0000-0000-0000-000000000001','工资',?,?,?)""",
            (key,ids['funding'],occurred,when.date().isoformat(),name,name,ids['payer'],stamp,stamp,name+' 明细公司 工资 明细现金'))

def check_query(connection, cases):
    rows = connection.execute("SELECT id,amount_cents,note,row_version,search_text FROM ledger_entry WHERE id LIKE 't9-%'").fetchall()
    assert len(rows) == 24
    for row in rows:
        edited = 33 in cases and row['id'] == 't9-query-00'
        assert row['amount_cents'] == (1500 if row['id'] == 't9-expense' else 100000)
        assert row['row_version'] == (2 if edited else 1)
        assert row['note'] == ('T9 edited' if edited else None)
        if edited: assert 't9 edited' in row['search_text']
    assert connection.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    assert connection.execute('PRAGMA foreign_key_check').fetchall() == []
    print('LEDGER_QUERY_TOUCH_SQLITE_VERIFIED cases=' + ','.join(map(str,cases)))


def add_lifecycle_items(connection):
    add_personal_items(connection, 't8', '生命周期')
    now = datetime.now(ZoneInfo('Asia/Shanghai'))
    for key, name, days in [('expired','生命周期到期收入',31),('retained','生命周期保留收入',1)]:
        deleted = datetime.fromtimestamp(now.timestamp()-days*86400,ZoneInfo('UTC')).isoformat(timespec='milliseconds').replace('+00:00','Z')
        due = datetime.fromtimestamp(now.timestamp()+(30-days)*86400,ZoneInfo('UTC')).isoformat(timespec='milliseconds').replace('+00:00','Z')
        connection.execute("""INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
            income_name,normalized_income_name,payer_id,payer_name_snapshot,income_category_id,income_category_name_snapshot,lifecycle_status,deleted_at,purge_after)
            SELECT ?,'INCOME',100,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,?,?,payer_id,payer_name_snapshot,income_category_id,income_category_name_snapshot,'TRASHED',?,?
            FROM ledger_entry WHERE id='t8-income'""",('t8-'+key,name,name,deleted,due))
    connection.execute("INSERT INTO maintenance_state VALUES('clock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (json.dumps({'wall':int(now.timestamp()*1000),'monotonic':0,'session':'owned-touch-fixture'}),))


def check_lifecycle(connection,cases):
    def one(sql): return connection.execute(sql).fetchone()[0]
    assert one("SELECT count(*) FROM ledger_entry WHERE id='t8-income' AND amount_cents=100000 AND row_version=1") == 1
    assert one("SELECT count(*) FROM ledger_entry WHERE id='t8-expired'") == 0
    assert one("SELECT count(*) FROM ledger_entry WHERE id='t8-retained' AND lifecycle_status='TRASHED'") == 1
    assert one("SELECT count(*) FROM ledger_entry WHERE product_id='t8-product'") == (0 if 29 in cases else 1)
    if 29 in cases:
        assert one("SELECT count(*) FROM expense_adjustment WHERE original_expense_id='t8-expense'") == 0
    elif 26 in cases:
        rows=connection.execute("SELECT amount_cents,status,row_version FROM expense_adjustment WHERE original_expense_id='t8-expense'").fetchall()
        assert [tuple(r) for r in rows] == [(300,'SOURCE_FROZEN' if 28 in cases else 'EFFECTIVE',4 if 28 in cases else 1)]
        assert one("SELECT row_version FROM ledger_entry WHERE id='t8-expense'") == (4 if 28 in cases else 1)
        assert one("SELECT amount_cents FROM ledger_entry WHERE id='t8-expense'") == 1500
    assert one("SELECT count(*) FROM ledger_entry WHERE product_id='t8-product' OR payer_id='t8-payer'") == (2 if 29 in cases else 3)
    assert list(connection.execute('PRAGMA foreign_key_check')) == []
    assert connection.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    print('LIFECYCLE_TOUCH_SQLITE_VERIFIED cases='+','.join(map(str,cases)))


def check_personal(connection, cases):
    def one(statement):
        return connection.execute(statement).fetchone()[0]
    assert one("SELECT count(*) FROM ledger_entry WHERE id='t7-expense' AND amount_cents=1500 AND note='来源备注' AND row_version=1") == 1
    assert one("SELECT count(*) FROM ledger_entry WHERE id='t7-income' AND amount_cents=100000 AND note='来源收入备注' AND row_version=1") == 1
    assert one("SELECT count(*) FROM ledger_entry WHERE product_id='t7-product' OR payer_id='t7-payer'") == 2
    if 17 in cases or 18 in cases:
        assert one("SELECT count(*) FROM daily_entry_template WHERE product_id='t7-product'") == (0 if 20 in cases else 1)
        if 20 not in cases:
            assert one("SELECT row_version FROM daily_entry_template WHERE product_id='t7-product'") == (3 if 18 in cases else 2)
    if 19 in cases:
        assert one("SELECT status FROM dictionary_item WHERE id='t7-unit'") == 'INACTIVE'
    if 20 in cases:
        assert one("SELECT count(*) FROM daily_entry_template WHERE product_id='t7-product'") == 0
    if 21 in cases:
        assert one("SELECT count(*) FROM daily_entry_template WHERE payer_id='t7-payer'") == 0
    drafts = {row['entry_type']: json.loads(row['data_json']) for row in connection.execute('SELECT * FROM ledger_draft WHERE dataset_id=(SELECT dataset_id FROM ledger_meta)')}
    if 18 in cases or 20 in cases:
        assert drafts['EXPENSE']['paidAmount'] == ('77' if 22 in cases else '15')
        assert not drafts['EXPENSE'].get('note')
        if 20 in cases:
            assert not drafts['EXPENSE'].get('unitId')
    if 21 in cases:
        assert drafts['INCOME']['amount'] == ('222' if 22 in cases else '1000')
        assert not drafts['INCOME'].get('note')
    if 22 in cases or 24 in cases:
        assert drafts['EXPENSE']['paidAmount'] == '77' and drafts['INCOME']['amount'] == '222'
    if 23 in cases or 24 in cases:
        assert one("SELECT value FROM preference WHERE key='theme'") == ('"SYSTEM"' if 25 in cases else '"DARK"')
        assert one("SELECT value FROM preference WHERE key='ledgerRange'") == ('"TODAY"' if 25 in cases else '"THIS_WEEK"')
    if 22 in cases or 24 in cases:
        assert one("SELECT value FROM preference WHERE key='recentEntryType'") == ('"EXPENSE"' if 25 in cases else '"INCOME"')
    print('PERSONAL_TOUCH_SQLITE_VERIFIED cases=' + ','.join(map(str,cases)))


connection.row_factory = sqlite3.Row
connection.execute('PRAGMA foreign_keys=ON')
receipt_path = Path(receipt_file)
try:
    if mode == 'capture-data-defaults':
        from ios_data_management import capture_clear_defaults
        capture_clear_defaults(connection, receipt_path)
    elif mode == 'prepare-data':
        from ios_data_management import prepare
        prepare(connection, receipt_path, add_personal_items)
    elif mode == 'check-data' or (mode == 'debug-check' and data_cases):
        from ios_data_management import check
        check(connection, receipt_path, data_cases or list(range(53,60)), folder)
    elif mode == 'debug-check' and report_cases:
        check_reports(connection, report_cases)
    elif mode == 'prepare-report':
        with connection: add_report_items(connection)
        print('REPORT_TOUCH_FIXTURE_PREPARED')
    elif mode == 'check-report':
        check_reports(connection, [36,37,38,39,40])
    elif mode == 'prepare-dimensions':
        with connection: snapshot = add_dimension_items(connection)
        receipt_path.write_text(json.dumps({'dimensionSnapshot':snapshot},ensure_ascii=False))
        print('REPORT_DIMENSION_FIXTURE_PREPARED')
    elif mode == 'check-dimensions':
        check_reports(connection, [38,43,44,45,46])
    elif mode == 'debug-check' and query_cases:
        check_query(connection, query_cases)
    elif mode == 'prepare-query':
        with connection: add_query_items(connection)
        print('LEDGER_QUERY_TOUCH_FIXTURE_PREPARED')
    elif mode == 'check-query':
        check_query(connection, [31,32,33,34,35])
    elif mode == 'debug-check' and lifecycle_cases:
        check_lifecycle(connection,lifecycle_cases)
    elif mode == 'prepare-lifecycle':
        with connection: add_lifecycle_items(connection)
        print('LIFECYCLE_TOUCH_FIXTURE_PREPARED')
    elif mode == 'check-lifecycle':
        check_lifecycle(connection,list(range(26,31)))
    elif mode == 'debug-check' and personal_cases:
        check_personal(connection, personal_cases)
        if 19 in personal_cases:
            assert connection.execute("SELECT count(*) FROM dictionary_item WHERE kind='UNIT' AND name LIKE 'PageUnit%' AND status='ACTIVE'").fetchone()[0] == 21
    elif mode == 'prepare-personal':
        with connection:
            add_personal_items(connection)
        print('PERSONAL_TOUCH_FIXTURE_PREPARED')
    elif mode == 'check-personal':
        check_personal(connection, list(range(17,26)))
    elif mode == 'debug-check':
        ids = json.loads(receipt_path.read_text())
        def one(sql, values=()):
            return connection.execute(sql, values).fetchone()[0]
        if debug_case in [1, 2, 3, 4, 5]:
            expected = {1: 'Touch Created', 2: 'Touch Renamed', 3: 'Touch Category', 4: 'Touch Unit', 5: 'Touch Funding'}[debug_case]
            assert one('SELECT count(*) FROM dictionary_item WHERE name=?', (expected,)) == 1
            if debug_case == 2:
                assert one("SELECT count(*) FROM dictionary_item WHERE name='Touch Created'") == 0
        if debug_case in [6, 7]:
            assert one('SELECT status FROM dictionary_item WHERE id=?', (ids['maintenance'],)) == ('INACTIVE' if debug_case == 6 else 'ACTIVE')
        merged_history = debug_case in [9, 10]
        expected_product = ids['target'] if merged_history else ids['source']
        entry = connection.execute('SELECT product_id,product_name_snapshot,CAST(amount_cents AS TEXT),row_version FROM ledger_entry WHERE id=?', (ids['entry'],)).fetchone()
        assert tuple(entry) == (expected_product, '历史苹果', '1543', 2 if merged_history else 1)
        template = connection.execute('SELECT product_id,CAST(amount_cents AS TEXT) FROM daily_entry_template WHERE id=?', (ids['template'],)).fetchone()
        assert tuple(template) == (expected_product, '1543')
        assert one('SELECT count(*) FROM product_merge_event') == (1 if merged_history or debug_case == 12 else 0)
        if debug_case == 12:
            assert one('SELECT merged_into_id FROM product_details WHERE product_id=?', (ids['paging']['PageProduct20'],)) == ids['paging']['PageProduct00']
            assert one("SELECT count(*) FROM dictionary_item d JOIN product_details p ON p.product_id=d.id WHERE d.name LIKE 'PageProduct%' AND p.merged_into_id IS NULL") == 20
        if debug_case == 14:
            assert one('SELECT status FROM dictionary_item WHERE id=?', (ids['paging']['PageUnit20'],)) == 'INACTIVE'
            assert one("SELECT count(*) FROM dictionary_item WHERE name LIKE 'PageUnit%' AND status='ACTIVE'") == 20
        print('DICTIONARY_DEBUG_SQLITE_VERIFIED case=' + str(debug_case))
        if debug_case in [15, 16]:
            check_entries(connection, debug_case)
            if debug_income_after_save:
                row = connection.execute("SELECT * FROM ledger_entry WHERE payer_id='t6-payer' AND id<>'t6-name-history'").fetchone()
                assert income_note_baseline(connection, row['id']) == ids['incomeSaveBaseline']
                assert row['business_time'] == ids['incomeSaveBusinessTime'] and row['business_date'] == ids['incomeSaveBusinessDate']
                assert row['income_category_id'] == '61000000-0000-0000-0000-000000000001' and row['funding_channel_id'] == 't6-funding'
                assert row['search_text'] == '测试工资 合成公司 工资 测试现金 t6 edited'
                assert row['adjustment_source_search_text'] == '测试现金'
                dataset = connection.execute('SELECT dataset_id FROM ledger_meta WHERE singleton=1').fetchone()[0]
                draft = json.loads(connection.execute("SELECT data_json FROM ledger_draft WHERE dataset_id=? AND entry_type='EXPENSE'", (dataset,)).fetchone()[0])
                assert draft['unitPrice'] == '77' and draft['paidAmount'] == '77' and draft['quantity'] == '1'
            if debug_income_note:
                target = ids['incomeNoteTarget']
                assert income_note_baseline(connection, target) == ids['incomeNoteBaseline']
                row = dict(connection.execute('SELECT * FROM ledger_entry WHERE id=?', (target,)).fetchone())
                assert row['note'] == 'T6 edited' and row['row_version'] == 2
                # 修改会重建检索派生列；初始历史来源可为空，但不能放行错误的终态索引。
                expected_search = '测试工资 合成公司 工资 测试现金 t6 edited'
                assert row['search_text'] == expected_search
                assert row['adjustment_source_search_text'] == '测试现金'
                for key, value in ids['incomeNoteOriginal'].items():
                    if key not in ['note', 'row_version', 'updated_at', 'search_text', 'adjustment_source_search_text']:
                        assert row[key] == value, key
            if debug_case == 16:
                # 单收入场景不提交支出草稿；组合场景必须保留前一用例的支出。
                if debug_entry_cycle:
                    check_entries(connection, 15)
                else:
                    assert one("SELECT count(*) FROM ledger_entry WHERE product_id='t6-product'") == 0
    elif mode == 'prepare-entry':
        with connection:
            add_entry_items(connection)
        print('ENTRY_TOUCH_FIXTURE_PREPARED')
    elif mode == 'check-entry':
        check_entries(connection, 15)
        check_entries(connection, 16)
    elif mode == 'check-empty':
        assert connection.execute('SELECT count(*) FROM dictionary_item').fetchone()[0] == 8
        for table in ['ledger_entry', 'daily_entry_template', 'product_merge_event']:
            assert connection.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == 0
        print('DICTIONARY_TOUCH_UNOWNED_REJECTION_NO_WRITES')
    elif mode == 'prepare-paging':
        ids = json.loads(receipt_path.read_text())
        assert connection.execute('SELECT count(*) FROM product_merge_event').fetchone()[0] == 1
        with connection:
            add_paging_items(connection, ids)
        receipt_path.write_text(json.dumps(ids, ensure_ascii=False, indent=2))
        print('DICTIONARY_TOUCH_PAGING_FIXTURE_PREPARED')
    elif mode == 'check-paging':
        ids = json.loads(receipt_path.read_text())
        assert connection.execute("SELECT count(*) FROM dictionary_item d JOIN product_details p ON p.product_id=d.id WHERE d.name LIKE 'PageProduct%' AND p.merged_into_id IS NULL").fetchone()[0] == 20
        assert connection.execute("SELECT count(*) FROM dictionary_item WHERE name LIKE 'PageUnit%' AND status='ACTIVE'").fetchone()[0] == 20
        assert connection.execute('SELECT merged_into_id FROM product_details WHERE product_id=?', (ids['paging']['PageProduct20'],)).fetchone()[0] == ids['paging']['PageProduct00']
        assert connection.execute('SELECT status FROM dictionary_item WHERE id=?', (ids['paging']['PageUnit20'],)).fetchone()[0] == 'INACTIVE'
        assert connection.execute('SELECT count(*) FROM product_merge_event').fetchone()[0] == 2
        entry = connection.execute('SELECT product_id,product_name_snapshot,CAST(amount_cents AS TEXT),row_version FROM ledger_entry WHERE id=?', (ids['entry'],)).fetchone()
        assert tuple(entry) == (ids['target'], '历史苹果', '1543', 2)
        print('DICTIONARY_TOUCH_PAGING_SQLITE_VERIFIED products=20 activeUnits=20 historyUnchanged=true')
    elif mode == 'prepare':
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
        if report_cases:
            with connection:
                add_report_items(connection)
                if any(case >= 43 for case in report_cases):
                    ids['dimensionSnapshot'] = add_dimension_items(connection)
        if query_cases:
            with connection: add_query_items(connection)
        if lifecycle_cases:
            with connection: add_lifecycle_items(connection)
        if personal_cases:
            with connection:
                add_personal_items(connection)
                if 19 in personal_cases:
                    # 还原完整流程先验收分页后留下的长列表；停用仍必须经页面操作，不能预写终态。
                    add_paging_items(connection, ids, kinds=('UNIT',))
        if debug_case is not None:
            with connection:
                if debug_case in [15, 16]:
                    add_entry_items(connection)
                    if debug_income_note:
                        add_income_note_source(connection, ids)
                    if debug_income_after_save:
                        add_income_save_drafts(connection, ids)
                if debug_case == 2:
                    connection.execute("INSERT INTO dictionary_item(id,kind,name,normalized_name,status,sort_order) VALUES(?,'PRODUCT','Touch Created','touch created','ACTIVE',20)", (str(uuid.uuid4()),))
                if debug_case == 7:
                    connection.execute("UPDATE dictionary_item SET status='INACTIVE' WHERE id=?", (ids['maintenance'],))
                if debug_case in [11, 12, 13, 14]:
                    add_paging_items(connection, ids)
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
        raise ValueError('unknown fixture mode')
    assert connection.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    assert not connection.execute('PRAGMA foreign_key_check').fetchall()
finally:
    connection.close()
