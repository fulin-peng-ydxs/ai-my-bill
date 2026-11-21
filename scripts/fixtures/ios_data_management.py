"""T12 专用模拟器准备与回读；路径/所有权沿用 dictionary-touch 入口。"""
import json
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


def snapshot(connection):
    tables = [r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    result = {name: sorted([dict(row) for row in connection.execute(f'SELECT * FROM "{name}"')], key=lambda row: json.dumps(row, sort_keys=True))
            for name in tables if name not in ['ledger_meta', 'maintenance_state', 'ledger_draft']}

    result['preference'] = [row for row in result['preference'] if row['key'] != 'updatedAt']
    return result

def prepare(connection, receipt, add_personal):
    assert not connection.execute("SELECT id FROM dictionary_item WHERE name='备份苹果'").fetchall()
    now = datetime.now(ZoneInfo('Asia/Shanghai'))
    ids = {key:str(uuid.uuid4()) for key in ['product','category','unit','funding','payer','expense','income','refund','trash','template']}
    with connection:
        add_personal(connection, 't12', '备份', {k:ids[k] for k in ['product','category','unit','funding','payer']}, now,
                     {k:ids[k] for k in ['expense','income']})
        stamp = now.astimezone(ZoneInfo('UTC')).isoformat(timespec='milliseconds').replace('+00:00','Z')
        connection.execute("INSERT INTO expense_adjustment(id,original_expense_id,adjustment_type,amount_cents,business_time,business_date,note,search_text,created_at,updated_at) VALUES(?,?,'REFUND',300,?,?,'备份退款','退款 备份退款',?,?)", (ids['refund'],ids['expense'],stamp,now.date().isoformat(),stamp,stamp))
        row = dict(connection.execute('SELECT * FROM ledger_entry WHERE id=?',(ids['income'],)).fetchone())
        row.update(id=ids['trash'],lifecycle_status='TRASHED',deleted_at=stamp,purge_after=(now+timedelta(days=29)).isoformat(),amount_cents=500)
        columns = ','.join(row)
        connection.execute(f'INSERT INTO ledger_entry({columns}) VALUES({",".join("?" for _ in row)})',list(row.values()))
        connection.execute("INSERT INTO daily_entry_template(id,entry_type,display_name,normalized_name,product_id,product_name_snapshot,primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price_scaled,quantity_scaled,amount_cents,funding_channel_id,funding_channel_name_snapshot,last_used_at,created_at,updated_at) VALUES(?,'EXPENSE','备份苹果','备份苹果',?,'备份苹果',?,'备份水果',?,'备份份',123456,1250,1500,?,'备份现金',?,?,?)",(ids['template'],ids['product'],ids['category'],ids['unit'],ids['funding'],stamp,stamp,stamp))
        dataset = connection.execute('SELECT dataset_id FROM ledger_meta').fetchone()[0]
        drafts = {'EXPENSE':{'productId':ids['product'],'productName':'备份苹果','primaryCategoryId':ids['category'],'unitId':ids['unit'],'unitPrice':'12.3456','quantity':'1.25','paidAmount':'77','fundingChannelId':ids['funding'],'occurredAt':now.strftime('%Y-%m-%dT%H:%M'),'note':'备份支出草稿'},
                  'INCOME':{'incomeName':'备份后差异','payerId':ids['payer'],'payerName':'备份公司','incomeCategoryId':'61000000-0000-0000-0000-000000000001','amount':'222','fundingChannelId':ids['funding'],'occurredAt':now.strftime('%Y-%m-%dT%H:%M'),'note':'备份收入草稿'}}
        # 全量套件之前的草稿同样保留在备份；本场景只替换两类测试草稿，绝不操作用户数据库。
        for kind, data in drafts.items():
            connection.execute('INSERT INTO ledger_draft VALUES(?,?,1,?,?,?) ON CONFLICT(dataset_id,entry_type) DO UPDATE SET data_json=excluded.data_json,created_at=excluded.created_at,updated_at=excluded.updated_at',(dataset,kind,json.dumps(data,ensure_ascii=False),stamp,stamp))
        for key,value in [('theme','DARK'),('recentEntryType','EXPENSE'),('defaultFundingChannelId',ids['funding'])]:
            connection.execute('INSERT INTO preference VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,json.dumps(value)))
        # 夹具写入不经过生产写队列，显式给本夹具新的快照水位。
        connection.execute("INSERT INTO maintenance_state VALUES('backup_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps({'revision':str(uuid.uuid4())}),))
    receipt.write_text(json.dumps({'dataSource':snapshot(connection),'dataset':dataset,'ids':ids,'drafts':drafts},ensure_ascii=False))
    print('DATA_MANAGEMENT_FIXTURE_PREPARED')


def check(connection, receipt, cases, folder):
    source = json.loads(receipt.read_text())
    current = connection.execute('SELECT dataset_id FROM ledger_meta').fetchone()[0]
    cleared = 58 in cases and 59 not in cases
    if cleared:
        assert current != source['dataset']
        for table in ['ledger_entry','expense_adjustment','daily_entry_template','ledger_draft','product_merge_event','idempotency_result']:
            assert connection.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0, table
        assert connection.execute('SELECT COUNT(*) FROM dictionary_item').fetchone()[0] == 8
        # 清空后启动可生成新的空账本常规快照，旧数据快照绝不能留下。
        root = folder/'Library/OfflineLedger/Snapshots'
        if root.exists():
            import sqlite3
            for manifest in root.glob('*/manifest.json'):
                with sqlite3.connect(f'file:{manifest.parent / "ledger.db"}?mode=ro',uri=True) as db:
                    assert db.execute('SELECT dataset_id FROM ledger_meta').fetchone()[0] == current
    else:
        restored = any(case in cases for case in [57,59])
        assert (current != source['dataset']) == restored
        actual = snapshot(connection)
        if 56 in cases and not restored:
            extra = [row for row in actual['ledger_entry'] if row['income_name']=='备份后差异']
            assert len(extra)==1 and extra[0]['amount_cents']==22200
            # 此页新增还会维护最近值及幂等回执，其他完整性由往返分支精确比对。
            for name in ['dictionary_item','daily_entry_template','expense_adjustment']:
                assert actual[name] == source['dataSource'][name],name
        else:
            assert actual == source['dataSource'], [key for key in actual if actual[key] != source['dataSource'][key]]
        if restored:
            drafts = {row['entry_type']:json.loads(row['data_json']) for row in connection.execute('SELECT * FROM ledger_draft WHERE dataset_id=?',(current,))}
            for kind,fields in source['drafts'].items():
                for key,value in fields.items(): assert drafts[kind][key]==value,(kind,key)
    assert not connection.execute('PRAGMA foreign_key_check').fetchall()
    assert connection.execute('PRAGMA quick_check').fetchone()[0]=='ok'
    saved = list((folder/'Documents').glob('T12-backup-*.mybill'))
    if any(54<=case<=59 for case in cases):
        assert saved,'原生文件选择器未实际保存备份'
        assert all(path.read_bytes().startswith(b'MYBILL-BACKUP-1\n') for path in saved)
    if 53 in cases:
        csv = list((folder/'Documents').glob('T12-csv-*.csv'))
        assert csv and csv[-1].read_bytes().startswith(b'\xef\xbb\xbf')
        assert '备份苹果' in csv[-1].read_text(encoding='utf-8-sig')
    print('DATA_MANAGEMENT_SQLITE_FILES_VERIFIED cases='+','.join(map(str,cases)))
