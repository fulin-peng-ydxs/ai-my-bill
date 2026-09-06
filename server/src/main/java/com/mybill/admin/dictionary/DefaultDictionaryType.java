package com.mybill.admin.dictionary;

import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;

import java.util.Arrays;

/** 管理员可维护的五类新用户默认字典白名单。 */
enum DefaultDictionaryType {
    EXPENSE_CATEGORY("expense-category", true),
    INCOME_CATEGORY("income-category", false),
    UNIT("unit", false),
    FUNDING_CHANNEL("funding-channel", false),
    PURCHASE_CHANNEL("purchase-channel", false);

    private final String slug;
    private final boolean hierarchical;

    DefaultDictionaryType(String slug, boolean hierarchical) {
        this.slug = slug;
        this.hierarchical = hierarchical;
    }

    String slug() { return slug; }
    boolean hierarchical() { return hierarchical; }

    static DefaultDictionaryType fromSlug(String slug) {
        return Arrays.stream(values()).filter(type -> type.slug.equals(slug)).findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DEFAULT_DICTIONARY_TYPE_NOT_FOUND",
                        "默认字典类型不存在。", false));
    }
}
