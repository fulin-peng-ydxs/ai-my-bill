-- T5：仅由 LedgerDatabase 在 v1→v2 升级/新装事务中执行；先校验旧引用，再追加结构。
-- 不更改 0001 摘要，不重铺 seed，不按名称映射用户项。冲突或中断整体回滚，升级前由生命周期保留快照。
-- 产品合并仍保留源字典与去向；旧 ACTIVE/INACTIVE 约束不重建，已合并项以 product_details 标识并退出候选。
CREATE TABLE dictionary_upgrade_guard (ok INTEGER NOT NULL CHECK(ok=1)) STRICT;
INSERT INTO dictionary_upgrade_guard
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM dictionary_item d LEFT JOIN dictionary_item p ON p.id=d.parent_id
  WHERE d.parent_id IS NOT NULL AND (p.id IS NULL OR p.kind<>'EXPENSE_CATEGORY' OR p.parent_id IS NOT NULL)
) OR EXISTS (
  SELECT 1 FROM ledger_entry l LEFT JOIN dictionary_item f ON f.id=l.funding_channel_id
  WHERE f.id IS NULL OR f.kind<>'FUNDING_CHANNEL'
) THEN 0 ELSE 1 END;
DROP TABLE dictionary_upgrade_guard;

-- 产品扩展独立于八类字典的共同标识；仅所有权行可级联删除，历史/模板/合并事件的 FK 继续拒绝删除。
CREATE TABLE product_details (
  product_id TEXT PRIMARY KEY REFERENCES dictionary_item(id) ON DELETE CASCADE,
  merged_into_id TEXT REFERENCES product_details(product_id) ON DELETE RESTRICT,
  default_primary_category_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  default_secondary_category_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  default_unit_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  last_unit_price_scaled INTEGER CHECK(last_unit_price_scaled BETWEEN 0 AND 999999999999),
  last_quantity_scaled INTEGER CHECK(last_quantity_scaled BETWEEN 1 AND 999999999),
  last_funding_channel_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  last_purchase_channel_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  CHECK(merged_into_id IS NULL OR merged_into_id<>product_id),
  CHECK(default_secondary_category_id IS NULL OR default_primary_category_id IS NOT NULL)
) STRICT;
INSERT INTO product_details(product_id) SELECT id FROM dictionary_item WHERE kind='PRODUCT';
CREATE INDEX product_merge_destination ON product_details(merged_into_id) WHERE merged_into_id IS NOT NULL;
CREATE TRIGGER dictionary_product_details AFTER INSERT ON dictionary_item WHEN NEW.kind='PRODUCT'
BEGIN
  INSERT INTO product_details(product_id) VALUES(NEW.id);
END;
CREATE TRIGGER dictionary_identity_immutable BEFORE UPDATE OF kind,parent_id ON dictionary_item
WHEN NEW.kind<>OLD.kind OR NEW.parent_id IS NOT OLD.parent_id
BEGIN
  SELECT RAISE(ABORT,'dictionary identity is immutable');
END;
CREATE TRIGGER dictionary_parent_insert BEFORE INSERT ON dictionary_item
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM dictionary_item p WHERE p.id=NEW.parent_id AND p.kind='EXPENSE_CATEGORY' AND p.parent_id IS NULL AND p.status='ACTIVE')
BEGIN
  SELECT RAISE(ABORT,'invalid category parent');
END;
CREATE TRIGGER dictionary_category_status BEFORE UPDATE OF status ON dictionary_item WHEN NEW.kind='EXPENSE_CATEGORY'
BEGIN
  SELECT CASE WHEN NEW.status='INACTIVE' AND EXISTS(SELECT 1 FROM dictionary_item c WHERE c.parent_id=NEW.id AND c.status='ACTIVE')
    THEN RAISE(ABORT,'active category children exist') END;
  SELECT CASE WHEN NEW.status='ACTIVE' AND NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item p WHERE p.id=NEW.parent_id AND p.status='ACTIVE')
    THEN RAISE(ABORT,'category parent is inactive') END;
END;
CREATE TRIGGER dictionary_preference_delete BEFORE DELETE ON dictionary_item
WHEN EXISTS(SELECT 1 FROM preference WHERE key='defaultFundingChannelId' AND json_extract(value,'$')=OLD.id)
BEGIN
  SELECT RAISE(ABORT,'dictionary is referenced by preference');
END;

-- 仅补充 T5 引用和快照存储，存量 v1 共同行不猜测商品或分类。收支必填/保存规则由 T6 接入。
ALTER TABLE ledger_entry ADD COLUMN product_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT;
ALTER TABLE ledger_entry ADD COLUMN product_name_snapshot TEXT;
ALTER TABLE ledger_entry ADD COLUMN primary_category_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT;
ALTER TABLE ledger_entry ADD COLUMN primary_category_name_snapshot TEXT;
ALTER TABLE ledger_entry ADD COLUMN secondary_category_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT;
ALTER TABLE ledger_entry ADD COLUMN secondary_category_name_snapshot TEXT;
ALTER TABLE ledger_entry ADD COLUMN unit_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT;
ALTER TABLE ledger_entry ADD COLUMN unit_name_snapshot TEXT;
ALTER TABLE ledger_entry ADD COLUMN purchase_channel_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT;
ALTER TABLE ledger_entry ADD COLUMN purchase_channel_name_snapshot TEXT;
ALTER TABLE ledger_entry ADD COLUMN location_label_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT;
ALTER TABLE ledger_entry ADD COLUMN location_label_name_snapshot TEXT;
ALTER TABLE ledger_entry ADD COLUMN income_category_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT;
ALTER TABLE ledger_entry ADD COLUMN income_category_name_snapshot TEXT;
ALTER TABLE ledger_entry ADD COLUMN payer_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT;
ALTER TABLE ledger_entry ADD COLUMN payer_name_snapshot TEXT;
ALTER TABLE ledger_entry ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
CREATE INDEX ledger_product_reference ON ledger_entry(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX ledger_primary_category_reference ON ledger_entry(primary_category_id) WHERE primary_category_id IS NOT NULL;
CREATE INDEX ledger_secondary_category_reference ON ledger_entry(secondary_category_id) WHERE secondary_category_id IS NOT NULL;
CREATE INDEX ledger_unit_reference ON ledger_entry(unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX ledger_purchase_channel_reference ON ledger_entry(purchase_channel_id) WHERE purchase_channel_id IS NOT NULL;
CREATE INDEX ledger_location_label_reference ON ledger_entry(location_label_id) WHERE location_label_id IS NOT NULL;
CREATE INDEX ledger_income_category_reference ON ledger_entry(income_category_id) WHERE income_category_id IS NOT NULL;
CREATE INDEX ledger_payer_reference ON ledger_entry(payer_id) WHERE payer_id IS NOT NULL;

-- T5 只提供模板存储与商品合并协调；模板创建/回填 UI 仍在 T7。金额/单价/数量均为缩放整数。
CREATE TABLE daily_entry_template (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('EXPENSE','INCOME')),
  display_name TEXT NOT NULL CHECK(length(trim(display_name))>0),
  normalized_name TEXT NOT NULL CHECK(length(normalized_name)>0),
  source_record_id TEXT REFERENCES ledger_entry(id) ON DELETE SET NULL,
  product_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  product_name_snapshot TEXT,
  primary_category_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  primary_category_name_snapshot TEXT,
  secondary_category_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  secondary_category_name_snapshot TEXT,
  unit_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  unit_name_snapshot TEXT,
  purchase_channel_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  purchase_channel_name_snapshot TEXT,
  location_label_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  location_label_name_snapshot TEXT,
  income_category_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  income_category_name_snapshot TEXT,
  payer_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  payer_name_snapshot TEXT,
  unit_price_scaled INTEGER CHECK(unit_price_scaled BETWEEN 0 AND 999999999999),
  quantity_scaled INTEGER CHECK(quantity_scaled BETWEEN 1 AND 999999999),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 0 AND 99999999999),
  funding_channel_id TEXT NOT NULL REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  funding_channel_name_snapshot TEXT NOT NULL,
  last_used_at TEXT NOT NULL CHECK(julianday(last_used_at) IS NOT NULL),
  created_at TEXT NOT NULL CHECK(julianday(created_at) IS NOT NULL),
  updated_at TEXT NOT NULL CHECK(julianday(updated_at) IS NOT NULL),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(entry_type,normalized_name),
  CHECK((entry_type='EXPENSE' AND product_id IS NOT NULL AND product_name_snapshot IS NOT NULL
    AND primary_category_id IS NOT NULL AND primary_category_name_snapshot IS NOT NULL
    AND unit_id IS NOT NULL AND unit_name_snapshot IS NOT NULL AND unit_price_scaled IS NOT NULL AND quantity_scaled IS NOT NULL
    AND payer_id IS NULL AND income_category_id IS NULL)
    OR (entry_type='INCOME' AND product_id IS NULL AND primary_category_id IS NULL AND secondary_category_id IS NULL
    AND unit_id IS NULL AND unit_price_scaled IS NULL AND quantity_scaled IS NULL
    AND purchase_channel_id IS NULL AND location_label_id IS NULL
    AND payer_id IS NOT NULL AND payer_name_snapshot IS NOT NULL
    AND income_category_id IS NOT NULL AND income_category_name_snapshot IS NOT NULL AND amount_cents>0))
) STRICT;
CREATE UNIQUE INDEX template_product_key ON daily_entry_template(product_id) WHERE entry_type='EXPENSE';
CREATE INDEX template_recent ON daily_entry_template(entry_type,last_used_at DESC,id);
CREATE INDEX template_product_reference ON daily_entry_template(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX template_primary_category_reference ON daily_entry_template(primary_category_id) WHERE primary_category_id IS NOT NULL;
CREATE INDEX template_secondary_category_reference ON daily_entry_template(secondary_category_id) WHERE secondary_category_id IS NOT NULL;
CREATE INDEX template_unit_reference ON daily_entry_template(unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX template_purchase_channel_reference ON daily_entry_template(purchase_channel_id) WHERE purchase_channel_id IS NOT NULL;
CREATE INDEX template_location_label_reference ON daily_entry_template(location_label_id) WHERE location_label_id IS NOT NULL;
CREATE INDEX template_income_category_reference ON daily_entry_template(income_category_id) WHERE income_category_id IS NOT NULL;
CREATE INDEX template_payer_reference ON daily_entry_template(payer_id) WHERE payer_id IS NOT NULL;
CREATE INDEX template_funding_channel_reference ON daily_entry_template(funding_channel_id) WHERE funding_channel_id IS NOT NULL;

-- 合并事件保存当时影响；后续链式合并更新产品当前去向，不改写历史事件及名称快照。
CREATE TABLE product_merge_event (
  id TEXT PRIMARY KEY,
  source_product_id TEXT NOT NULL REFERENCES product_details(product_id) ON DELETE RESTRICT,
  target_product_id TEXT NOT NULL REFERENCES product_details(product_id) ON DELETE RESTRICT,
  affected_ledger_entries INTEGER NOT NULL CHECK(affected_ledger_entries>=0),
  affected_templates INTEGER NOT NULL CHECK(affected_templates BETWEEN 0 AND 1),
  template_conflict INTEGER NOT NULL CHECK(template_conflict IN (0,1)),
  occurred_at TEXT NOT NULL,
  CHECK(source_product_id<>target_product_id)
) STRICT;
CREATE INDEX product_merge_event_source ON product_merge_event(source_product_id,occurred_at);
CREATE INDEX product_merge_event_target ON product_merge_event(target_product_id,occurred_at);

CREATE TRIGGER product_details_reference_insert BEFORE INSERT ON product_details
BEGIN
  SELECT CASE WHEN NEW.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.product_id AND kind='PRODUCT') THEN RAISE(ABORT,'invalid product_details.product_id') END;
  SELECT CASE WHEN NEW.merged_into_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.merged_into_id AND kind='PRODUCT') THEN RAISE(ABORT,'invalid product_details.merged_into_id') END;
  SELECT CASE WHEN NEW.default_primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.default_primary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid product_details.default_primary_category_id') END;
  SELECT CASE WHEN NEW.default_secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.default_secondary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid product_details.default_secondary_category_id') END;
  SELECT CASE WHEN NEW.default_unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.default_unit_id AND kind='UNIT') THEN RAISE(ABORT,'invalid product_details.default_unit_id') END;
  SELECT CASE WHEN NEW.last_funding_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.last_funding_channel_id AND kind='FUNDING_CHANNEL') THEN RAISE(ABORT,'invalid product_details.last_funding_channel_id') END;
  SELECT CASE WHEN NEW.last_purchase_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.last_purchase_channel_id AND kind='PURCHASE_CHANNEL') THEN RAISE(ABORT,'invalid product_details.last_purchase_channel_id') END;
  SELECT CASE WHEN NEW.default_primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.default_primary_category_id AND parent_id IS NULL) THEN RAISE(ABORT,'invalid primary category') END;
  SELECT CASE WHEN NEW.default_secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.default_secondary_category_id AND parent_id=NEW.default_primary_category_id) THEN RAISE(ABORT,'invalid secondary category') END;
END;

CREATE TRIGGER product_details_reference_update BEFORE UPDATE ON product_details
BEGIN
  SELECT CASE WHEN NEW.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.product_id AND kind='PRODUCT') THEN RAISE(ABORT,'invalid product_details.product_id') END;
  SELECT CASE WHEN NEW.merged_into_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.merged_into_id AND kind='PRODUCT') THEN RAISE(ABORT,'invalid product_details.merged_into_id') END;
  SELECT CASE WHEN NEW.default_primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.default_primary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid product_details.default_primary_category_id') END;
  SELECT CASE WHEN NEW.default_secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.default_secondary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid product_details.default_secondary_category_id') END;
  SELECT CASE WHEN NEW.default_unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.default_unit_id AND kind='UNIT') THEN RAISE(ABORT,'invalid product_details.default_unit_id') END;
  SELECT CASE WHEN NEW.last_funding_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.last_funding_channel_id AND kind='FUNDING_CHANNEL') THEN RAISE(ABORT,'invalid product_details.last_funding_channel_id') END;
  SELECT CASE WHEN NEW.last_purchase_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.last_purchase_channel_id AND kind='PURCHASE_CHANNEL') THEN RAISE(ABORT,'invalid product_details.last_purchase_channel_id') END;
  SELECT CASE WHEN NEW.default_primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.default_primary_category_id AND parent_id IS NULL) THEN RAISE(ABORT,'invalid primary category') END;
  SELECT CASE WHEN NEW.default_secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.default_secondary_category_id AND parent_id=NEW.default_primary_category_id) THEN RAISE(ABORT,'invalid secondary category') END;
END;

CREATE TRIGGER ledger_entry_reference_insert BEFORE INSERT ON ledger_entry
BEGIN
  SELECT CASE WHEN NEW.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.product_id AND kind='PRODUCT') THEN RAISE(ABORT,'invalid ledger_entry.product_id') END;
  SELECT CASE WHEN NEW.primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.primary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid ledger_entry.primary_category_id') END;
  SELECT CASE WHEN NEW.secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.secondary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid ledger_entry.secondary_category_id') END;
  SELECT CASE WHEN NEW.unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.unit_id AND kind='UNIT') THEN RAISE(ABORT,'invalid ledger_entry.unit_id') END;
  SELECT CASE WHEN NEW.purchase_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.purchase_channel_id AND kind='PURCHASE_CHANNEL') THEN RAISE(ABORT,'invalid ledger_entry.purchase_channel_id') END;
  SELECT CASE WHEN NEW.location_label_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.location_label_id AND kind='LOCATION_LABEL') THEN RAISE(ABORT,'invalid ledger_entry.location_label_id') END;
  SELECT CASE WHEN NEW.income_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.income_category_id AND kind='INCOME_CATEGORY') THEN RAISE(ABORT,'invalid ledger_entry.income_category_id') END;
  SELECT CASE WHEN NEW.payer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.payer_id AND kind='PAYER') THEN RAISE(ABORT,'invalid ledger_entry.payer_id') END;
  SELECT CASE WHEN NEW.funding_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.funding_channel_id AND kind='FUNDING_CHANNEL') THEN RAISE(ABORT,'invalid ledger_entry.funding_channel_id') END;
  SELECT CASE WHEN NEW.primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.primary_category_id AND parent_id IS NULL) THEN RAISE(ABORT,'invalid primary category') END;
  SELECT CASE WHEN NEW.secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.secondary_category_id AND parent_id=NEW.primary_category_id) THEN RAISE(ABORT,'invalid secondary category') END;
END;

CREATE TRIGGER ledger_entry_reference_update BEFORE UPDATE ON ledger_entry
BEGIN
  SELECT CASE WHEN NEW.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.product_id AND kind='PRODUCT') THEN RAISE(ABORT,'invalid ledger_entry.product_id') END;
  SELECT CASE WHEN NEW.primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.primary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid ledger_entry.primary_category_id') END;
  SELECT CASE WHEN NEW.secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.secondary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid ledger_entry.secondary_category_id') END;
  SELECT CASE WHEN NEW.unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.unit_id AND kind='UNIT') THEN RAISE(ABORT,'invalid ledger_entry.unit_id') END;
  SELECT CASE WHEN NEW.purchase_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.purchase_channel_id AND kind='PURCHASE_CHANNEL') THEN RAISE(ABORT,'invalid ledger_entry.purchase_channel_id') END;
  SELECT CASE WHEN NEW.location_label_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.location_label_id AND kind='LOCATION_LABEL') THEN RAISE(ABORT,'invalid ledger_entry.location_label_id') END;
  SELECT CASE WHEN NEW.income_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.income_category_id AND kind='INCOME_CATEGORY') THEN RAISE(ABORT,'invalid ledger_entry.income_category_id') END;
  SELECT CASE WHEN NEW.payer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.payer_id AND kind='PAYER') THEN RAISE(ABORT,'invalid ledger_entry.payer_id') END;
  SELECT CASE WHEN NEW.funding_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.funding_channel_id AND kind='FUNDING_CHANNEL') THEN RAISE(ABORT,'invalid ledger_entry.funding_channel_id') END;
  SELECT CASE WHEN NEW.primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.primary_category_id AND parent_id IS NULL) THEN RAISE(ABORT,'invalid primary category') END;
  SELECT CASE WHEN NEW.secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.secondary_category_id AND parent_id=NEW.primary_category_id) THEN RAISE(ABORT,'invalid secondary category') END;
END;

CREATE TRIGGER daily_entry_template_reference_insert BEFORE INSERT ON daily_entry_template
BEGIN
  SELECT CASE WHEN NEW.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.product_id AND kind='PRODUCT') THEN RAISE(ABORT,'invalid daily_entry_template.product_id') END;
  SELECT CASE WHEN NEW.primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.primary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid daily_entry_template.primary_category_id') END;
  SELECT CASE WHEN NEW.secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.secondary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid daily_entry_template.secondary_category_id') END;
  SELECT CASE WHEN NEW.unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.unit_id AND kind='UNIT') THEN RAISE(ABORT,'invalid daily_entry_template.unit_id') END;
  SELECT CASE WHEN NEW.purchase_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.purchase_channel_id AND kind='PURCHASE_CHANNEL') THEN RAISE(ABORT,'invalid daily_entry_template.purchase_channel_id') END;
  SELECT CASE WHEN NEW.location_label_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.location_label_id AND kind='LOCATION_LABEL') THEN RAISE(ABORT,'invalid daily_entry_template.location_label_id') END;
  SELECT CASE WHEN NEW.income_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.income_category_id AND kind='INCOME_CATEGORY') THEN RAISE(ABORT,'invalid daily_entry_template.income_category_id') END;
  SELECT CASE WHEN NEW.payer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.payer_id AND kind='PAYER') THEN RAISE(ABORT,'invalid daily_entry_template.payer_id') END;
  SELECT CASE WHEN NEW.funding_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.funding_channel_id AND kind='FUNDING_CHANNEL') THEN RAISE(ABORT,'invalid daily_entry_template.funding_channel_id') END;
  SELECT CASE WHEN NEW.primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.primary_category_id AND parent_id IS NULL) THEN RAISE(ABORT,'invalid primary category') END;
  SELECT CASE WHEN NEW.secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.secondary_category_id AND parent_id=NEW.primary_category_id) THEN RAISE(ABORT,'invalid secondary category') END;
END;

CREATE TRIGGER daily_entry_template_reference_update BEFORE UPDATE ON daily_entry_template
BEGIN
  SELECT CASE WHEN NEW.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.product_id AND kind='PRODUCT') THEN RAISE(ABORT,'invalid daily_entry_template.product_id') END;
  SELECT CASE WHEN NEW.primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.primary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid daily_entry_template.primary_category_id') END;
  SELECT CASE WHEN NEW.secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.secondary_category_id AND kind='EXPENSE_CATEGORY') THEN RAISE(ABORT,'invalid daily_entry_template.secondary_category_id') END;
  SELECT CASE WHEN NEW.unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.unit_id AND kind='UNIT') THEN RAISE(ABORT,'invalid daily_entry_template.unit_id') END;
  SELECT CASE WHEN NEW.purchase_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.purchase_channel_id AND kind='PURCHASE_CHANNEL') THEN RAISE(ABORT,'invalid daily_entry_template.purchase_channel_id') END;
  SELECT CASE WHEN NEW.location_label_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.location_label_id AND kind='LOCATION_LABEL') THEN RAISE(ABORT,'invalid daily_entry_template.location_label_id') END;
  SELECT CASE WHEN NEW.income_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.income_category_id AND kind='INCOME_CATEGORY') THEN RAISE(ABORT,'invalid daily_entry_template.income_category_id') END;
  SELECT CASE WHEN NEW.payer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.payer_id AND kind='PAYER') THEN RAISE(ABORT,'invalid daily_entry_template.payer_id') END;
  SELECT CASE WHEN NEW.funding_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.funding_channel_id AND kind='FUNDING_CHANNEL') THEN RAISE(ABORT,'invalid daily_entry_template.funding_channel_id') END;
  SELECT CASE WHEN NEW.primary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.primary_category_id AND parent_id IS NULL) THEN RAISE(ABORT,'invalid primary category') END;
  SELECT CASE WHEN NEW.secondary_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.secondary_category_id AND parent_id=NEW.primary_category_id) THEN RAISE(ABORT,'invalid secondary category') END;
END;

-- 引用保护与候选投影通过索引查询产品默认/最近值，不逐项全表扫描。
CREATE INDEX product_default_primary_category_id_reference ON product_details(default_primary_category_id) WHERE default_primary_category_id IS NOT NULL;
CREATE INDEX product_default_secondary_category_id_reference ON product_details(default_secondary_category_id) WHERE default_secondary_category_id IS NOT NULL;
CREATE INDEX product_default_unit_id_reference ON product_details(default_unit_id) WHERE default_unit_id IS NOT NULL;
CREATE INDEX product_last_funding_channel_id_reference ON product_details(last_funding_channel_id) WHERE last_funding_channel_id IS NOT NULL;
CREATE INDEX product_last_purchase_channel_id_reference ON product_details(last_purchase_channel_id) WHERE last_purchase_channel_id IS NOT NULL;
CREATE UNIQUE INDEX product_merge_once ON product_merge_event(source_product_id);
