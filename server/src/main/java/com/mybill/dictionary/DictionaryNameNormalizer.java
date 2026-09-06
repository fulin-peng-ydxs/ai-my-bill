package com.mybill.dictionary;

import java.text.Normalizer;
import java.util.Locale;

/** 个人字典唯一键统一执行 NFKC、首尾去空白、连续空白折叠和稳定小写。 */
public final class DictionaryNameNormalizer {
    private DictionaryNameNormalizer() { }

    public static String displayName(String value) {
        return value == null ? "" : value.replaceAll("^[\\p{Z}\\s]+|[\\p{Z}\\s]+$", "");
    }

    public static String normalizedName(String value) {
        return Normalizer.normalize(displayName(value), Normalizer.Form.NFKC)
                .replaceAll("[\\p{Z}\\s]+", " ")
                .strip()
                .toLowerCase(Locale.ROOT);
    }
}
