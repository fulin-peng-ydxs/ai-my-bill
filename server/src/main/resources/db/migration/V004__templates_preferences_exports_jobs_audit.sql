-- T2 模板、偏好、幂等、导出/注销任务与审计模型。租户业务对象继续使用复合归属约束。
-- 来源账目永久删除前由触发器仅清空模板追溯引用，模板业务内容仍保留；生产回退采用 forward-fix。

CREATE TABLE daily_entry_template (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    entry_type varchar(16) NOT NULL CHECK (entry_type IN ('EXPENSE', 'INCOME')),
    display_name varchar(200) NOT NULL CHECK (btrim(display_name) <> ''),
    normalized_name varchar(200) NOT NULL CHECK (btrim(normalized_name) <> ''),
    source_record_id uuid,
    product_id uuid,
    product_name_snapshot varchar(200),
    primary_category_id uuid,
    primary_category_name_snapshot varchar(100),
    secondary_category_id uuid,
    secondary_category_name_snapshot varchar(100),
    unit_id uuid,
    unit_name_snapshot varchar(100),
    unit_price numeric,
    quantity numeric,
    paid_amount numeric,
    purchase_channel_id uuid,
    purchase_channel_name_snapshot varchar(100),
    location_label_id uuid,
    location_label_name_snapshot varchar(100),
    payer_id uuid,
    payer_name_snapshot varchar(100),
    income_category_id uuid,
    income_category_name_snapshot varchar(100),
    income_amount numeric,
    funding_channel_id uuid NOT NULL,
    funding_channel_name_snapshot varchar(100) NOT NULL,
    last_used_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_daily_template_business_key UNIQUE (tenant_id, entry_type, normalized_name),
    CONSTRAINT fk_daily_template_source FOREIGN KEY (tenant_id, source_record_id) REFERENCES ledger_entry (tenant_id, id),
    CONSTRAINT fk_daily_template_product FOREIGN KEY (tenant_id, product_id) REFERENCES product (tenant_id, id),
    CONSTRAINT fk_daily_template_primary_category FOREIGN KEY (tenant_id, primary_category_id) REFERENCES expense_category (tenant_id, id),
    CONSTRAINT fk_daily_template_secondary_category FOREIGN KEY (tenant_id, secondary_category_id, primary_category_id)
        REFERENCES expense_category (tenant_id, id, parent_id),
    CONSTRAINT fk_daily_template_unit FOREIGN KEY (tenant_id, unit_id) REFERENCES unit (tenant_id, id),
    CONSTRAINT fk_daily_template_funding FOREIGN KEY (tenant_id, funding_channel_id) REFERENCES funding_channel (tenant_id, id),
    CONSTRAINT fk_daily_template_purchase FOREIGN KEY (tenant_id, purchase_channel_id) REFERENCES purchase_channel (tenant_id, id),
    CONSTRAINT fk_daily_template_location FOREIGN KEY (tenant_id, location_label_id) REFERENCES location_label (tenant_id, id),
    CONSTRAINT fk_daily_template_payer FOREIGN KEY (tenant_id, payer_id) REFERENCES payer (tenant_id, id),
    CONSTRAINT fk_daily_template_income_category FOREIGN KEY (tenant_id, income_category_id) REFERENCES income_category (tenant_id, id),
    CONSTRAINT ck_daily_template_expense_shape CHECK (
        entry_type <> 'EXPENSE' OR (
            product_id IS NOT NULL AND product_name_snapshot IS NOT NULL AND btrim(product_name_snapshot) <> ''
            AND primary_category_id IS NOT NULL AND primary_category_name_snapshot IS NOT NULL
            AND btrim(primary_category_name_snapshot) <> ''
            AND unit_id IS NOT NULL AND unit_name_snapshot IS NOT NULL AND btrim(unit_name_snapshot) <> ''
            AND unit_price IS NOT NULL AND unit_price BETWEEN 0 AND 99999999.9999
            AND scale(unit_price) <= 4
            AND quantity IS NOT NULL AND quantity > 0 AND quantity <= 999999.999
            AND scale(quantity) <= 3
            AND paid_amount IS NOT NULL AND paid_amount BETWEEN 0 AND 999999999.99
            AND scale(paid_amount) <= 2
            AND payer_id IS NULL AND payer_name_snapshot IS NULL
            AND income_category_id IS NULL AND income_category_name_snapshot IS NULL AND income_amount IS NULL
        )
    ),
    CONSTRAINT ck_daily_template_income_shape CHECK (
        entry_type <> 'INCOME' OR (
            product_id IS NULL AND product_name_snapshot IS NULL
            AND primary_category_id IS NULL AND primary_category_name_snapshot IS NULL
            AND secondary_category_id IS NULL AND secondary_category_name_snapshot IS NULL
            AND unit_id IS NULL AND unit_name_snapshot IS NULL AND unit_price IS NULL AND quantity IS NULL
            AND paid_amount IS NULL AND purchase_channel_id IS NULL AND purchase_channel_name_snapshot IS NULL
            AND location_label_id IS NULL AND location_label_name_snapshot IS NULL
            AND payer_id IS NOT NULL AND payer_name_snapshot IS NOT NULL AND btrim(payer_name_snapshot) <> ''
            AND income_category_id IS NOT NULL AND income_category_name_snapshot IS NOT NULL
            AND btrim(income_category_name_snapshot) <> ''
            AND income_amount IS NOT NULL AND income_amount > 0 AND income_amount <= 999999999.99
            AND scale(income_amount) <= 2
        )
    ),
    CONSTRAINT ck_daily_template_secondary_category_snapshot CHECK (
        (secondary_category_id IS NULL AND secondary_category_name_snapshot IS NULL)
        OR (secondary_category_id IS NOT NULL AND secondary_category_name_snapshot IS NOT NULL
            AND btrim(secondary_category_name_snapshot) <> '')
    ),
    CONSTRAINT ck_daily_template_purchase_channel_snapshot CHECK (
        (purchase_channel_id IS NULL AND purchase_channel_name_snapshot IS NULL)
        OR (purchase_channel_id IS NOT NULL AND purchase_channel_name_snapshot IS NOT NULL
            AND btrim(purchase_channel_name_snapshot) <> '')
    ),
    CONSTRAINT ck_daily_template_location_label_snapshot CHECK (
        (location_label_id IS NULL AND location_label_name_snapshot IS NULL)
        OR (location_label_id IS NOT NULL AND location_label_name_snapshot IS NOT NULL
            AND btrim(location_label_name_snapshot) <> '')
    )
);

CREATE FUNCTION detach_templates_from_deleted_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE daily_entry_template
       SET source_record_id = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = OLD.tenant_id AND source_record_id = OLD.id;
    RETURN OLD;
END;
$$;

CREATE FUNCTION validate_daily_template_source() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE source_type varchar(16); source_lifecycle varchar(16);
BEGIN
    IF TG_OP = 'INSERT' AND NEW.source_record_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'new daily template requires a source ledger entry';
    END IF;
    IF NEW.source_record_id IS NOT NULL THEN
        SELECT entry_type, lifecycle_status INTO source_type, source_lifecycle
          FROM ledger_entry
         WHERE tenant_id = NEW.tenant_id AND id = NEW.source_record_id;
        IF NOT FOUND OR source_type <> NEW.entry_type OR source_lifecycle <> 'ACTIVE' THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'daily template source must be an active ledger entry of the same type';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_daily_template_source
BEFORE INSERT OR UPDATE OF tenant_id, entry_type, source_record_id ON daily_entry_template
FOR EACH ROW EXECUTE FUNCTION validate_daily_template_source();

CREATE TRIGGER trg_detach_templates_from_deleted_ledger
BEFORE DELETE ON ledger_entry FOR EACH ROW EXECUTE FUNCTION detach_templates_from_deleted_ledger();

CREATE TABLE user_preference (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    user_id uuid NOT NULL,
    default_funding_channel_id uuid,
    ledger_default_range varchar(16) NOT NULL DEFAULT 'TODAY'
        CHECK (ledger_default_range IN ('TODAY', 'THIS_WEEK', 'THIS_MONTH')),
    report_default_range varchar(16) NOT NULL DEFAULT 'THIS_MONTH'
        CHECK (report_default_range IN ('THIS_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'THIS_YEAR')),
    theme_mode varchar(16) NOT NULL DEFAULT 'SYSTEM' CHECK (theme_mode IN ('SYSTEM', 'LIGHT', 'DARK')),
    recent_entry_type varchar(16) NOT NULL DEFAULT 'EXPENSE' CHECK (recent_entry_type IN ('EXPENSE', 'INCOME')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, user_id),
    CONSTRAINT fk_user_preference_owner FOREIGN KEY (tenant_id, user_id) REFERENCES app_user (tenant_id, id),
    CONSTRAINT fk_user_preference_funding FOREIGN KEY (tenant_id, default_funding_channel_id)
        REFERENCES funding_channel (tenant_id, id)
);

CREATE TABLE idempotency_record (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    operation varchar(64) NOT NULL,
    idempotency_key varchar(128) NOT NULL,
    request_digest varchar(128) NOT NULL,
    result_reference varchar(128),
    status varchar(16) NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_idempotency_operation_key UNIQUE (tenant_id, operation, idempotency_key)
);

CREATE TABLE export_job (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    filter_snapshot jsonb NOT NULL CHECK (jsonb_typeof(filter_snapshot) = 'object'),
    status varchar(16) NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')),
    file_location varchar(500),
    expires_at timestamptz,
    error_summary varchar(500),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT fk_export_job_owner FOREIGN KEY (tenant_id, user_id) REFERENCES app_user (tenant_id, id),
    CONSTRAINT ck_export_job_result CHECK (
        (status = 'SUCCEEDED' AND file_location IS NOT NULL AND expires_at IS NOT NULL AND error_summary IS NULL)
        OR status <> 'SUCCEEDED'
    )
);

CREATE TABLE account_deletion_job (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    requested_at timestamptz NOT NULL,
    executed_at timestamptz,
    result_summary varchar(500),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT fk_account_deletion_owner FOREIGN KEY (tenant_id, user_id) REFERENCES app_user (tenant_id, id),
    CONSTRAINT uq_account_deletion_user UNIQUE (tenant_id, user_id),
    CONSTRAINT ck_account_deletion_execution
        CHECK ((status = 'SUCCEEDED' AND executed_at IS NOT NULL) OR status <> 'SUCCEEDED')
);

CREATE TABLE admin_audit_log (
    id uuid PRIMARY KEY,
    administrator_user_id uuid NOT NULL REFERENCES app_user (id),
    action varchar(64) NOT NULL,
    object_type varchar(64) NOT NULL,
    object_id varchar(128) NOT NULL,
    result varchar(16) NOT NULL CHECK (result IN ('SUCCEEDED', 'FAILED', 'DENIED')),
    safe_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_summary) = 'object'),
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE job_run (
    id uuid PRIMARY KEY,
    tenant_id uuid REFERENCES tenant (id),
    job_type varchar(64) NOT NULL,
    batch_key varchar(128),
    status varchar(16) NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    started_at timestamptz,
    finished_at timestamptz,
    processed_count bigint NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
    error_summary varchar(500),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_job_run_times CHECK (finished_at IS NULL OR started_at IS NOT NULL)
);

CREATE TABLE backup_run (
    id uuid PRIMARY KEY,
    batch_key varchar(128) NOT NULL UNIQUE,
    status varchar(16) NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    artifact_checksum varchar(128),
    processed_bytes bigint CHECK (processed_bytes >= 0),
    error_summary varchar(500),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_backup_run_result CHECK (
        (status = 'SUCCEEDED' AND finished_at IS NOT NULL AND artifact_checksum IS NOT NULL)
        OR status <> 'SUCCEEDED'
    )
);
