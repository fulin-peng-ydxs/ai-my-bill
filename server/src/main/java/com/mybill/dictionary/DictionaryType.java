package com.mybill.dictionary;

import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;

import java.util.Arrays;

/** 八类个人字典的服务端白名单；表名和引用查询只能来自此枚举。 */
enum DictionaryType {
    PRODUCT("product", "product", 200, false,
            "EXISTS (SELECT 1 FROM ledger_entry l WHERE l.tenant_id = d.tenant_id AND l.product_id = d.id) "
                    + "OR EXISTS (SELECT 1 FROM daily_entry_template t WHERE t.tenant_id = d.tenant_id AND t.product_id = d.id)"),
    EXPENSE_CATEGORY("expense-category", "expense_category", 100, true,
            "EXISTS (SELECT 1 FROM ledger_entry l WHERE l.tenant_id = d.tenant_id AND (l.primary_category_id = d.id OR l.secondary_category_id = d.id)) "
                    + "OR EXISTS (SELECT 1 FROM product p WHERE p.tenant_id = d.tenant_id AND (p.default_primary_category_id = d.id OR p.default_secondary_category_id = d.id)) "
                    + "OR EXISTS (SELECT 1 FROM daily_entry_template t WHERE t.tenant_id = d.tenant_id AND (t.primary_category_id = d.id OR t.secondary_category_id = d.id))"),
    UNIT("unit", "unit", 100, false,
            "EXISTS (SELECT 1 FROM ledger_entry l WHERE l.tenant_id = d.tenant_id AND l.unit_id = d.id) "
                    + "OR EXISTS (SELECT 1 FROM product p WHERE p.tenant_id = d.tenant_id AND p.default_unit_id = d.id) "
                    + "OR EXISTS (SELECT 1 FROM daily_entry_template t WHERE t.tenant_id = d.tenant_id AND t.unit_id = d.id)"),
    FUNDING_CHANNEL("funding-channel", "funding_channel", 100, false,
            "EXISTS (SELECT 1 FROM ledger_entry l WHERE l.tenant_id = d.tenant_id AND l.funding_channel_id = d.id) "
                    + "OR EXISTS (SELECT 1 FROM product p WHERE p.tenant_id = d.tenant_id AND p.last_funding_channel_id = d.id) "
                    + "OR EXISTS (SELECT 1 FROM daily_entry_template t WHERE t.tenant_id = d.tenant_id AND t.funding_channel_id = d.id) "
                    + "OR EXISTS (SELECT 1 FROM user_preference u WHERE u.tenant_id = d.tenant_id AND u.default_funding_channel_id = d.id)"),
    PURCHASE_CHANNEL("purchase-channel", "purchase_channel", 100, false,
            "EXISTS (SELECT 1 FROM ledger_entry l WHERE l.tenant_id = d.tenant_id AND l.purchase_channel_id = d.id) "
                    + "OR EXISTS (SELECT 1 FROM product p WHERE p.tenant_id = d.tenant_id AND p.last_purchase_channel_id = d.id) "
                    + "OR EXISTS (SELECT 1 FROM daily_entry_template t WHERE t.tenant_id = d.tenant_id AND t.purchase_channel_id = d.id)"),
    LOCATION("location", "location_label", 100, false,
            "EXISTS (SELECT 1 FROM ledger_entry l WHERE l.tenant_id = d.tenant_id AND l.location_label_id = d.id) "
                    + "OR EXISTS (SELECT 1 FROM daily_entry_template t WHERE t.tenant_id = d.tenant_id AND t.location_label_id = d.id)"),
    INCOME_CATEGORY("income-category", "income_category", 100, false,
            "EXISTS (SELECT 1 FROM ledger_entry l WHERE l.tenant_id = d.tenant_id AND l.income_category_id = d.id) "
                    + "OR EXISTS (SELECT 1 FROM daily_entry_template t WHERE t.tenant_id = d.tenant_id AND t.income_category_id = d.id)"),
    PAYER("payer", "payer", 100, false,
            "EXISTS (SELECT 1 FROM ledger_entry l WHERE l.tenant_id = d.tenant_id AND l.payer_id = d.id) "
                    + "OR EXISTS (SELECT 1 FROM daily_entry_template t WHERE t.tenant_id = d.tenant_id AND t.payer_id = d.id)");

    private final String slug;
    private final String table;
    private final int nameLimit;
    private final boolean hierarchical;
    private final String referenceExpression;

    DictionaryType(String slug, String table, int nameLimit, boolean hierarchical, String referenceExpression) {
        this.slug = slug;
        this.table = table;
        this.nameLimit = nameLimit;
        this.hierarchical = hierarchical;
        this.referenceExpression = referenceExpression;
    }

    String slug() { return slug; }
    String table() { return table; }
    int nameLimit() { return nameLimit; }
    boolean hierarchical() { return hierarchical; }
    String referenceExpression() { return referenceExpression; }

    static DictionaryType fromSlug(String slug) {
        return Arrays.stream(values()).filter(type -> type.slug.equals(slug)).findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DICTIONARY_TYPE_NOT_FOUND",
                        "字典类型不存在。", false));
    }
}
