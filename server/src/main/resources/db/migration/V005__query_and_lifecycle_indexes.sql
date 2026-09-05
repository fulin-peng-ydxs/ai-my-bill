-- T2 查询与生命周期索引。仅创建非重复的业务访问索引；T26 的实测调优必须新建后续 migration。
-- 生产回退单个索引应使用精确的前向 migration；U005 只供空环境或已确认维护窗口人工使用。

CREATE INDEX idx_default_dictionary_active
    ON default_dictionary_item (dictionary_type, status, sort_order, id);
CREATE INDEX idx_expense_category_active
    ON expense_category (tenant_id, status, parent_id, sort_order, id);
CREATE INDEX idx_unit_active ON unit (tenant_id, status, sort_order, id);
CREATE INDEX idx_funding_channel_active ON funding_channel (tenant_id, status, sort_order, id);
CREATE INDEX idx_purchase_channel_active ON purchase_channel (tenant_id, status, sort_order, id);
CREATE INDEX idx_location_label_active ON location_label (tenant_id, status, sort_order, id);
CREATE INDEX idx_income_category_active ON income_category (tenant_id, status, sort_order, id);
CREATE INDEX idx_payer_active ON payer (tenant_id, status, sort_order, id);
CREATE INDEX idx_product_active ON product (tenant_id, status, updated_at DESC, id);

CREATE INDEX idx_ledger_active_cursor
    ON ledger_entry (tenant_id, business_date DESC, business_time DESC, created_at DESC, id DESC)
    WHERE lifecycle_status = 'ACTIVE';
CREATE INDEX idx_ledger_trash_cursor
    ON ledger_entry (tenant_id, deleted_at DESC, id DESC)
    WHERE lifecycle_status = 'TRASHED';
CREATE INDEX idx_ledger_purge_due
    ON ledger_entry (purge_after, tenant_id, id)
    WHERE lifecycle_status = 'TRASHED';
CREATE INDEX idx_ledger_type_date
    ON ledger_entry (tenant_id, entry_type, business_date, id)
    WHERE lifecycle_status = 'ACTIVE';
CREATE INDEX idx_ledger_product_report
    ON ledger_entry (tenant_id, product_id, business_date, id)
    WHERE entry_type = 'EXPENSE' AND lifecycle_status = 'ACTIVE';
CREATE INDEX idx_ledger_income_report
    ON ledger_entry (tenant_id, income_category_id, business_date, id)
    WHERE entry_type = 'INCOME' AND lifecycle_status = 'ACTIVE';

CREATE INDEX idx_adjustment_source_status
    ON expense_adjustment (tenant_id, original_expense_id, status, business_time DESC, id);
CREATE INDEX idx_adjustment_report
    ON expense_adjustment (tenant_id, business_date, id)
    WHERE status = 'EFFECTIVE';
CREATE INDEX idx_adjustment_purge_due
    ON expense_adjustment (purge_after, tenant_id, id) WHERE status = 'TRASHED';

CREATE INDEX idx_daily_template_recent
    ON daily_entry_template (tenant_id, entry_type, last_used_at DESC, id);
CREATE INDEX idx_idempotency_expiry ON idempotency_record (expires_at, tenant_id, id);
CREATE INDEX idx_export_job_owner ON export_job (tenant_id, user_id, created_at DESC, id);
CREATE INDEX idx_export_job_expiry ON export_job (expires_at, tenant_id, id) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_account_deletion_status ON account_deletion_job (status, requested_at, tenant_id, id);
CREATE INDEX idx_admin_audit_query ON admin_audit_log (occurred_at DESC, action, result, id);
CREATE INDEX idx_job_run_queue ON job_run (status, job_type, created_at, id);
CREATE INDEX idx_job_run_tenant ON job_run (tenant_id, created_at DESC, id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_backup_run_status ON backup_run (status, started_at DESC, id);
