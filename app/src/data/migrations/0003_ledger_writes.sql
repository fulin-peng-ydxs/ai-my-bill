-- T6：存量缺失字段保持 NULL，不为旧记录臆造量价或收入名称。
ALTER TABLE ledger_entry ADD COLUMN unit_price_scaled INTEGER CHECK(unit_price_scaled IS NULL OR unit_price_scaled BETWEEN 0 AND 999999999999);
ALTER TABLE ledger_entry ADD COLUMN quantity_scaled INTEGER CHECK(quantity_scaled IS NULL OR quantity_scaled BETWEEN 1 AND 999999999);
ALTER TABLE ledger_entry ADD COLUMN calculated_amount_cents INTEGER CHECK(calculated_amount_cents IS NULL OR calculated_amount_cents BETWEEN 0 AND 99999999999);
ALTER TABLE ledger_entry ADD COLUMN income_name TEXT CHECK(income_name IS NULL OR length(income_name) BETWEEN 1 AND 200);
ALTER TABLE ledger_entry ADD COLUMN normalized_income_name TEXT;
ALTER TABLE ledger_entry ADD COLUMN note TEXT CHECK(note IS NULL OR length(note)<=500);
ALTER TABLE ledger_entry ADD COLUMN updated_at TEXT;
CREATE INDEX ledger_recent_product ON ledger_entry(product_id,updated_at DESC,id DESC);
CREATE INDEX ledger_recent_payer ON ledger_entry(payer_id,updated_at DESC,id DESC);
CREATE INDEX ledger_income_names ON ledger_entry(normalized_income_name,created_at DESC);

CREATE TABLE payer_details (
  payer_id TEXT PRIMARY KEY NOT NULL REFERENCES dictionary_item(id) ON DELETE CASCADE,
  last_income_category_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  last_funding_channel_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX payer_recent_category_reference ON payer_details(last_income_category_id) WHERE last_income_category_id IS NOT NULL;
CREATE INDEX payer_recent_funding_reference ON payer_details(last_funding_channel_id) WHERE last_funding_channel_id IS NOT NULL;
CREATE TRIGGER payer_recent_kinds_insert BEFORE INSERT ON payer_details BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.payer_id AND kind='PAYER')
    OR (NEW.last_income_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.last_income_category_id AND kind='INCOME_CATEGORY'))
    OR (NEW.last_funding_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.last_funding_channel_id AND kind='FUNDING_CHANNEL'))
    THEN RAISE(ABORT,'payer recent kind mismatch') END;
END;
CREATE TRIGGER payer_recent_kinds_update BEFORE UPDATE ON payer_details BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.payer_id AND kind='PAYER')
    OR (NEW.last_income_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.last_income_category_id AND kind='INCOME_CATEGORY'))
    OR (NEW.last_funding_channel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_item WHERE id=NEW.last_funding_channel_id AND kind='FUNDING_CHANNEL'))
    THEN RAISE(ABORT,'payer recent kind mismatch') END;
END;
