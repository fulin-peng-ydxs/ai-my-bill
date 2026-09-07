package com.mybill.dictionary;

import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;

import java.util.Arrays;

/** 八类个人字典的服务端白名单；表名和引用查询只能来自此枚举。 */
enum DictionaryType {
    PRODUCT("product", 200, false),
    EXPENSE_CATEGORY("expense-category", 100, true),
    UNIT("unit", 100, false),
    FUNDING_CHANNEL("funding-channel", 100, false),
    PURCHASE_CHANNEL("purchase-channel", 100, false),
    LOCATION("location", 100, false),
    INCOME_CATEGORY("income-category", 100, false),
    PAYER("payer", 100, false);

    private final String slug;
    private final int nameLimit;
    private final boolean hierarchical;

    DictionaryType(String slug, int nameLimit, boolean hierarchical) {
        this.slug = slug;
        this.nameLimit = nameLimit;
        this.hierarchical = hierarchical;
    }

    String slug() { return slug; }
    int nameLimit() { return nameLimit; }
    boolean hierarchical() { return hierarchical; }

    static DictionaryType fromSlug(String slug) {
        return Arrays.stream(values()).filter(type -> type.slug.equals(slug)).findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DICTIONARY_TYPE_NOT_FOUND",
                        "字典类型不存在。", false));
    }
}
