-- T2 收支与退款/报销调整模型。金额使用 numeric，业务日期固定按 Asia/Shanghai 校验。
-- 调整触发器锁定原支出后校验有效累计额，避免并发超额；已有业务数据后禁止执行破坏性回滚。

CREATE TABLE ledger_entry (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    entry_type varchar(16) NOT NULL CHECK (entry_type IN ('EXPENSE', 'INCOME')),
    business_time timestamptz NOT NULL,
    business_date date NOT NULL,
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    lifecycle_status varchar(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (lifecycle_status IN ('ACTIVE', 'TRASHED')),
    deleted_at timestamptz,
    purge_after timestamptz,
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
    calculated_amount numeric,
    paid_amount numeric,
    purchase_channel_id uuid,
    purchase_channel_name_snapshot varchar(100),
    location_label_id uuid,
    location_label_name_snapshot varchar(100),
    income_name varchar(200),
    payer_id uuid,
    payer_name_snapshot varchar(100),
    income_category_id uuid,
    income_category_name_snapshot varchar(100),
    income_amount numeric,
    funding_channel_id uuid NOT NULL,
    funding_channel_name_snapshot varchar(100) NOT NULL,
    note varchar(500),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT fk_ledger_product FOREIGN KEY (tenant_id, product_id) REFERENCES product (tenant_id, id),
    CONSTRAINT fk_ledger_primary_category FOREIGN KEY (tenant_id, primary_category_id) REFERENCES expense_category (tenant_id, id),
    CONSTRAINT fk_ledger_secondary_category FOREIGN KEY (tenant_id, secondary_category_id, primary_category_id)
        REFERENCES expense_category (tenant_id, id, parent_id),
    CONSTRAINT fk_ledger_unit FOREIGN KEY (tenant_id, unit_id) REFERENCES unit (tenant_id, id),
    CONSTRAINT fk_ledger_funding_channel FOREIGN KEY (tenant_id, funding_channel_id) REFERENCES funding_channel (tenant_id, id),
    CONSTRAINT fk_ledger_purchase_channel FOREIGN KEY (tenant_id, purchase_channel_id) REFERENCES purchase_channel (tenant_id, id),
    CONSTRAINT fk_ledger_location_label FOREIGN KEY (tenant_id, location_label_id) REFERENCES location_label (tenant_id, id),
    CONSTRAINT fk_ledger_payer FOREIGN KEY (tenant_id, payer_id) REFERENCES payer (tenant_id, id),
    CONSTRAINT fk_ledger_income_category FOREIGN KEY (tenant_id, income_category_id) REFERENCES income_category (tenant_id, id),
    CONSTRAINT ck_ledger_business_date
        CHECK (business_date = (business_time AT TIME ZONE 'Asia/Shanghai')::date),
    CONSTRAINT ck_ledger_lifecycle
        CHECK ((lifecycle_status = 'ACTIVE' AND deleted_at IS NULL AND purge_after IS NULL)
            OR (lifecycle_status = 'TRASHED' AND deleted_at IS NOT NULL
                AND purge_after = deleted_at + INTERVAL '30 days')),
    CONSTRAINT ck_ledger_expense_shape CHECK (
        entry_type <> 'EXPENSE' OR (
            product_id IS NOT NULL AND product_name_snapshot IS NOT NULL AND btrim(product_name_snapshot) <> ''
            AND primary_category_id IS NOT NULL AND primary_category_name_snapshot IS NOT NULL
            AND btrim(primary_category_name_snapshot) <> ''
            AND unit_id IS NOT NULL AND unit_name_snapshot IS NOT NULL AND btrim(unit_name_snapshot) <> ''
            AND unit_price IS NOT NULL AND unit_price BETWEEN 0 AND 99999999.9999
            AND scale(unit_price) <= 4
            AND quantity IS NOT NULL AND quantity > 0 AND quantity <= 999999.999
            AND scale(quantity) <= 3
            AND calculated_amount IS NOT NULL AND calculated_amount BETWEEN 0 AND 999999999.99
            AND scale(calculated_amount) <= 2
            AND calculated_amount = round(unit_price * quantity, 2)
            AND paid_amount IS NOT NULL AND paid_amount BETWEEN 0 AND 999999999.99
            AND scale(paid_amount) <= 2
            AND income_name IS NULL AND payer_id IS NULL AND payer_name_snapshot IS NULL
            AND income_category_id IS NULL AND income_category_name_snapshot IS NULL AND income_amount IS NULL
        )
    ),
    CONSTRAINT ck_ledger_income_shape CHECK (
        entry_type <> 'INCOME' OR (
            income_name IS NOT NULL AND btrim(income_name) <> ''
            AND payer_id IS NOT NULL AND payer_name_snapshot IS NOT NULL AND btrim(payer_name_snapshot) <> ''
            AND income_category_id IS NOT NULL AND income_category_name_snapshot IS NOT NULL
            AND btrim(income_category_name_snapshot) <> ''
            AND income_amount IS NOT NULL AND income_amount > 0 AND income_amount <= 999999999.99
            AND scale(income_amount) <= 2
            AND product_id IS NULL AND product_name_snapshot IS NULL
            AND primary_category_id IS NULL AND primary_category_name_snapshot IS NULL
            AND secondary_category_id IS NULL AND secondary_category_name_snapshot IS NULL
            AND unit_id IS NULL AND unit_name_snapshot IS NULL AND unit_price IS NULL
            AND quantity IS NULL AND calculated_amount IS NULL AND paid_amount IS NULL
            AND purchase_channel_id IS NULL AND purchase_channel_name_snapshot IS NULL
            AND location_label_id IS NULL AND location_label_name_snapshot IS NULL
        )
    ),
    CONSTRAINT ck_ledger_secondary_category_snapshot CHECK (
        (secondary_category_id IS NULL AND secondary_category_name_snapshot IS NULL)
        OR (secondary_category_id IS NOT NULL AND secondary_category_name_snapshot IS NOT NULL
            AND btrim(secondary_category_name_snapshot) <> '')
    ),
    CONSTRAINT ck_ledger_purchase_channel_snapshot CHECK (
        (purchase_channel_id IS NULL AND purchase_channel_name_snapshot IS NULL)
        OR (purchase_channel_id IS NOT NULL AND purchase_channel_name_snapshot IS NOT NULL
            AND btrim(purchase_channel_name_snapshot) <> '')
    ),
    CONSTRAINT ck_ledger_location_label_snapshot CHECK (
        (location_label_id IS NULL AND location_label_name_snapshot IS NULL)
        OR (location_label_id IS NOT NULL AND location_label_name_snapshot IS NOT NULL
            AND btrim(location_label_name_snapshot) <> '')
    )
);

CREATE TABLE expense_adjustment (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    original_expense_id uuid NOT NULL,
    adjustment_type varchar(16) NOT NULL CHECK (adjustment_type IN ('REFUND', 'REIMBURSEMENT')),
    amount numeric NOT NULL CHECK (amount > 0 AND amount <= 999999999.99 AND scale(amount) <= 2),
    business_time timestamptz NOT NULL,
    business_date date NOT NULL,
    status varchar(24) NOT NULL DEFAULT 'EFFECTIVE'
        CHECK (status IN ('EFFECTIVE', 'REVOKED', 'TRASHED', 'SOURCE_FROZEN')),
    deleted_at timestamptz,
    purge_after timestamptz,
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    note varchar(500),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT fk_adjustment_original_expense FOREIGN KEY (tenant_id, original_expense_id)
        REFERENCES ledger_entry (tenant_id, id),
    CONSTRAINT ck_adjustment_business_date
        CHECK (business_date = (business_time AT TIME ZONE 'Asia/Shanghai')::date),
    CONSTRAINT ck_adjustment_lifecycle CHECK (
        (status IN ('EFFECTIVE', 'REVOKED', 'SOURCE_FROZEN') AND deleted_at IS NULL AND purge_after IS NULL)
        OR (status = 'TRASHED' AND deleted_at IS NOT NULL AND purge_after = deleted_at + INTERVAL '30 days')
    )
);

CREATE FUNCTION protect_expense_with_adjustments() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE effective_total numeric;
BEGIN
    IF OLD.entry_type <> NEW.entry_type THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ledger entry type is immutable';
    END IF;
    IF NEW.entry_type = 'EXPENSE' AND NEW.paid_amount IS DISTINCT FROM OLD.paid_amount THEN
        SELECT COALESCE(sum(amount), 0) INTO effective_total
          FROM expense_adjustment
         WHERE tenant_id = NEW.tenant_id AND original_expense_id = NEW.id AND status = 'EFFECTIVE';
        IF effective_total > NEW.paid_amount THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'source paid amount cannot be lower than effective adjustments';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_expense_with_adjustments
BEFORE UPDATE OF entry_type, paid_amount ON ledger_entry
FOR EACH ROW EXECUTE FUNCTION protect_expense_with_adjustments();

CREATE FUNCTION validate_expense_adjustment_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    source_paid numeric;
    source_type varchar(16);
    source_lifecycle varchar(16);
    effective_total numeric;
BEGIN
    SELECT paid_amount, entry_type, lifecycle_status
      INTO source_paid, source_type, source_lifecycle
      FROM ledger_entry
     WHERE tenant_id = NEW.tenant_id AND id = NEW.original_expense_id
     FOR UPDATE;

    IF NOT FOUND OR source_type <> 'EXPENSE' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'adjustment source must be an expense in the same tenant';
    END IF;
    IF NEW.status = 'EFFECTIVE' AND source_lifecycle <> 'ACTIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'effective adjustment requires an active source expense';
    END IF;

    IF NEW.status = 'EFFECTIVE' THEN
        SELECT COALESCE(sum(amount), 0)
          INTO effective_total
          FROM expense_adjustment
         WHERE tenant_id = NEW.tenant_id
           AND original_expense_id = NEW.original_expense_id
           AND status = 'EFFECTIVE'
           AND id <> NEW.id;
        IF effective_total + NEW.amount > source_paid THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'effective adjustments exceed source paid amount';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_expense_adjustment_total
BEFORE INSERT OR UPDATE OF tenant_id, original_expense_id, amount, status
ON expense_adjustment FOR EACH ROW EXECUTE FUNCTION validate_expense_adjustment_total();

CREATE FUNCTION sync_adjustments_with_source_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.lifecycle_status = 'ACTIVE' AND NEW.lifecycle_status = 'TRASHED' THEN
        UPDATE expense_adjustment
           SET status = 'SOURCE_FROZEN', updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = NEW.tenant_id AND original_expense_id = NEW.id AND status = 'EFFECTIVE';
    ELSIF OLD.lifecycle_status = 'TRASHED' AND NEW.lifecycle_status = 'ACTIVE' THEN
        UPDATE expense_adjustment
           SET status = 'EFFECTIVE', updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = NEW.tenant_id AND original_expense_id = NEW.id AND status = 'SOURCE_FROZEN';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_adjustments_with_source_lifecycle
AFTER UPDATE OF lifecycle_status ON ledger_entry
FOR EACH ROW WHEN (OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status)
EXECUTE FUNCTION sync_adjustments_with_source_lifecycle();
