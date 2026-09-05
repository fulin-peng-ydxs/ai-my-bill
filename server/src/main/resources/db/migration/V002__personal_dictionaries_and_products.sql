-- T2 个人字典、商品与系统默认项。全部个人数据以 tenant_id 作为复合主键及关联前导列。
-- 本迁移不写默认业务数据；仅空环境且无引用时可人工执行对应 U002 回滚脚本。

CREATE TABLE default_dictionary_item (
    id uuid PRIMARY KEY,
    dictionary_type varchar(32) NOT NULL
        CHECK (dictionary_type IN ('EXPENSE_CATEGORY', 'INCOME_CATEGORY', 'UNIT', 'FUNDING_CHANNEL', 'PURCHASE_CHANNEL')),
    stable_key varchar(64) NOT NULL,
    parent_id uuid,
    display_name varchar(100) NOT NULL CHECK (btrim(display_name) <> ''),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_default_dictionary_type_key UNIQUE (dictionary_type, stable_key),
    CONSTRAINT uq_default_dictionary_type_id UNIQUE (dictionary_type, id),
    CONSTRAINT fk_default_dictionary_parent
        FOREIGN KEY (dictionary_type, parent_id)
        REFERENCES default_dictionary_item (dictionary_type, id),
    CONSTRAINT ck_default_dictionary_parent_type
        CHECK (parent_id IS NULL OR dictionary_type = 'EXPENSE_CATEGORY')
);

CREATE FUNCTION enforce_default_category_depth() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_parent_id uuid;
BEGIN
    IF NEW.parent_id = NEW.id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'default category cannot parent itself';
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
        SELECT parent_id INTO parent_parent_id
          FROM default_dictionary_item
         WHERE dictionary_type = NEW.dictionary_type AND id = NEW.parent_id;
        IF FOUND AND parent_parent_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'default expense category supports at most two levels';
        END IF;
        IF EXISTS (SELECT 1 FROM default_dictionary_item WHERE parent_id = NEW.id) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'default category with children must remain a root category';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_default_category_depth
BEFORE INSERT OR UPDATE OF dictionary_type, id, parent_id ON default_dictionary_item
FOR EACH ROW EXECUTE FUNCTION enforce_default_category_depth();

CREATE TABLE expense_category (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    parent_id uuid,
    display_name varchar(100) NOT NULL CHECK (btrim(display_name) <> ''),
    normalized_name varchar(100) NOT NULL CHECK (btrim(normalized_name) <> ''),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_expense_category_name UNIQUE (tenant_id, parent_id, normalized_name),
    CONSTRAINT uq_expense_category_parent_shape UNIQUE (tenant_id, id, parent_id),
    CONSTRAINT fk_expense_category_parent FOREIGN KEY (tenant_id, parent_id)
        REFERENCES expense_category (tenant_id, id)
);

CREATE UNIQUE INDEX uq_expense_category_root_name
    ON expense_category (tenant_id, normalized_name) WHERE parent_id IS NULL;

CREATE FUNCTION enforce_expense_category_depth() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_parent_id uuid;
BEGIN
    IF NEW.parent_id = NEW.id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'expense category cannot parent itself';
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
        SELECT parent_id INTO parent_parent_id
          FROM expense_category
         WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_id;
        IF FOUND AND parent_parent_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'expense category supports at most two levels';
        END IF;
        IF EXISTS (SELECT 1 FROM expense_category WHERE tenant_id = NEW.tenant_id AND parent_id = NEW.id) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category with children must remain a root category';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_expense_category_depth
BEFORE INSERT OR UPDATE OF tenant_id, id, parent_id ON expense_category
FOR EACH ROW EXECUTE FUNCTION enforce_expense_category_depth();

CREATE TABLE unit (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    display_name varchar(100) NOT NULL CHECK (btrim(display_name) <> ''),
    normalized_name varchar(100) NOT NULL CHECK (btrim(normalized_name) <> ''),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_unit_name UNIQUE (tenant_id, normalized_name)
);

CREATE TABLE funding_channel (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    display_name varchar(100) NOT NULL CHECK (btrim(display_name) <> ''),
    normalized_name varchar(100) NOT NULL CHECK (btrim(normalized_name) <> ''),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_funding_channel_name UNIQUE (tenant_id, normalized_name)
);

CREATE TABLE purchase_channel (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    display_name varchar(100) NOT NULL CHECK (btrim(display_name) <> ''),
    normalized_name varchar(100) NOT NULL CHECK (btrim(normalized_name) <> ''),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_purchase_channel_name UNIQUE (tenant_id, normalized_name)
);

CREATE TABLE location_label (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    display_name varchar(100) NOT NULL CHECK (btrim(display_name) <> ''),
    normalized_name varchar(100) NOT NULL CHECK (btrim(normalized_name) <> ''),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_location_label_name UNIQUE (tenant_id, normalized_name)
);

CREATE TABLE income_category (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    display_name varchar(100) NOT NULL CHECK (btrim(display_name) <> ''),
    normalized_name varchar(100) NOT NULL CHECK (btrim(normalized_name) <> ''),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_income_category_name UNIQUE (tenant_id, normalized_name)
);

CREATE TABLE payer (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    display_name varchar(100) NOT NULL CHECK (btrim(display_name) <> ''),
    normalized_name varchar(100) NOT NULL CHECK (btrim(normalized_name) <> ''),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_payer_name UNIQUE (tenant_id, normalized_name)
);

CREATE TABLE product (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    display_name varchar(200) NOT NULL CHECK (btrim(display_name) <> ''),
    normalized_name varchar(200) NOT NULL CHECK (btrim(normalized_name) <> ''),
    default_primary_category_id uuid,
    default_secondary_category_id uuid,
    default_unit_id uuid,
    last_unit_price numeric CHECK (last_unit_price BETWEEN 0 AND 99999999.9999 AND scale(last_unit_price) <= 4),
    last_quantity numeric CHECK (last_quantity > 0 AND last_quantity <= 999999.999 AND scale(last_quantity) <= 3),
    last_funding_channel_id uuid,
    last_purchase_channel_id uuid,
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'MERGED')),
    merged_into_id uuid,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_product_normalized_name UNIQUE (tenant_id, normalized_name),
    CONSTRAINT fk_product_primary_category FOREIGN KEY (tenant_id, default_primary_category_id)
        REFERENCES expense_category (tenant_id, id),
    CONSTRAINT fk_product_secondary_category FOREIGN KEY (tenant_id, default_secondary_category_id, default_primary_category_id)
        REFERENCES expense_category (tenant_id, id, parent_id),
    CONSTRAINT fk_product_unit FOREIGN KEY (tenant_id, default_unit_id)
        REFERENCES unit (tenant_id, id),
    CONSTRAINT fk_product_funding_channel FOREIGN KEY (tenant_id, last_funding_channel_id)
        REFERENCES funding_channel (tenant_id, id),
    CONSTRAINT fk_product_purchase_channel FOREIGN KEY (tenant_id, last_purchase_channel_id)
        REFERENCES purchase_channel (tenant_id, id),
    CONSTRAINT fk_product_merged_into FOREIGN KEY (tenant_id, merged_into_id)
        REFERENCES product (tenant_id, id),
    CONSTRAINT ck_product_merge_state
        CHECK ((status = 'MERGED' AND merged_into_id IS NOT NULL AND merged_into_id <> id)
            OR (status <> 'MERGED' AND merged_into_id IS NULL)),
    CONSTRAINT ck_product_category_pair
        CHECK (default_secondary_category_id IS NULL OR default_primary_category_id IS NOT NULL)
);
