-- T8：追加调整与清理观测元数据。仅由升级事务执行，失败回滚 DDL/履历；不修改旧迁移。
-- 永久删除显式先删关联调整；外键拒绝任何遗留孤儿的旁路。
CREATE TABLE expense_adjustment (
 id TEXT PRIMARY KEY,
 original_expense_id TEXT NOT NULL REFERENCES ledger_entry(id) ON DELETE RESTRICT,
 adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('REFUND','REIMBURSEMENT')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 99999999999),
 business_time TEXT NOT NULL,
 business_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'EFFECTIVE' CHECK(status IN ('EFFECTIVE','REVOKED','TRASHED','SOURCE_FROZEN')),
 note TEXT CHECK(note IS NULL OR length(note)<=500),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version>0),
 deleted_at TEXT,
 purge_after TEXT,
 CHECK((status='TRASHED' AND deleted_at IS NOT NULL AND purge_after IS NOT NULL)
   OR (status<>'TRASHED' AND deleted_at IS NULL AND purge_after IS NULL))
) STRICT;
CREATE INDEX adjustment_source ON expense_adjustment(original_expense_id,status,business_time,id);
CREATE INDEX adjustment_due ON expense_adjustment(purge_after,id) WHERE status='TRASHED';
CREATE INDEX ledger_due ON ledger_entry(purge_after,id) WHERE lifecycle_status='TRASHED';
-- 持久化观测样本与最小执行状态；不记录账目正文。每批业务删除与进度同事务。
CREATE TABLE maintenance_state (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL CHECK(json_valid(value))
) STRICT;
CREATE TRIGGER adjustment_validate_insert BEFORE INSERT ON expense_adjustment BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ledger_entry WHERE id=NEW.original_expense_id AND entry_type='EXPENSE')
   OR (NEW.status='EFFECTIVE' AND NOT EXISTS(SELECT 1 FROM ledger_entry WHERE id=NEW.original_expense_id AND lifecycle_status='ACTIVE'))
   OR (NEW.status='EFFECTIVE' AND NEW.amount_cents+COALESCE((SELECT SUM(amount_cents) FROM expense_adjustment WHERE original_expense_id=NEW.original_expense_id AND status='EFFECTIVE'),0)>(SELECT amount_cents FROM ledger_entry WHERE id=NEW.original_expense_id))
   THEN RAISE(ABORT,'adjustment source or total invalid') END;
END;
CREATE TRIGGER adjustment_validate_update BEFORE UPDATE ON expense_adjustment BEGIN
 SELECT CASE WHEN NEW.original_expense_id<>OLD.original_expense_id
   OR (NEW.status='EFFECTIVE' AND NOT EXISTS(SELECT 1 FROM ledger_entry WHERE id=NEW.original_expense_id AND lifecycle_status='ACTIVE'))
   OR (NEW.status='EFFECTIVE' AND NEW.amount_cents+COALESCE((SELECT SUM(amount_cents) FROM expense_adjustment WHERE original_expense_id=NEW.original_expense_id AND id<>NEW.id AND status='EFFECTIVE'),0)>(SELECT amount_cents FROM ledger_entry WHERE id=NEW.original_expense_id))
   THEN RAISE(ABORT,'adjustment source or total invalid') END;
END;
CREATE TRIGGER ledger_adjustment_minimum BEFORE UPDATE OF amount_cents,lifecycle_status ON ledger_entry
 WHEN NEW.entry_type='EXPENSE' AND NEW.lifecycle_status='ACTIVE' BEGIN
 SELECT CASE WHEN COALESCE((SELECT SUM(amount_cents) FROM expense_adjustment WHERE original_expense_id=NEW.id
   AND (status='EFFECTIVE' OR (OLD.lifecycle_status='TRASHED' AND status='SOURCE_FROZEN'))),0)>NEW.amount_cents
   THEN RAISE(ABORT,'expense below adjustment total') END;
END;
-- 原支出状态改变时同步冻结/解冻，单条 SQL 失败也整体回滚；已撤销/单独删除的调整不复活。
CREATE TRIGGER ledger_freeze_adjustments AFTER UPDATE OF lifecycle_status ON ledger_entry
 WHEN NEW.entry_type='EXPENSE' AND OLD.lifecycle_status<>NEW.lifecycle_status BEGIN
 UPDATE expense_adjustment SET status='SOURCE_FROZEN',updated_at=NEW.updated_at,row_version=row_version+1
   WHERE original_expense_id=NEW.id AND status='EFFECTIVE' AND NEW.lifecycle_status='TRASHED';
 UPDATE expense_adjustment SET status='EFFECTIVE',updated_at=NEW.updated_at,row_version=row_version+1
   WHERE original_expense_id=NEW.id AND status='SOURCE_FROZEN' AND NEW.lifecycle_status='ACTIVE';
END;
