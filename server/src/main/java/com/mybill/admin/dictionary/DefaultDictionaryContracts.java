package com.mybill.admin.dictionary;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.UUID;

final class DefaultDictionaryContracts {
    private DefaultDictionaryContracts() { }

    record CreateRequest(@NotBlank String name, UUID parentId) { }
    record StatusRequest(@NotNull DefaultDictionaryStatus status) { }
    record MoveRequest(@NotNull MoveDirection direction, UUID targetId) { }
    enum MoveDirection { UP, DOWN }

    record DefaultDictionaryItem(UUID id, String type, String name, DefaultDictionaryStatus status, int sortOrder,
                                 UUID parentId, String parentName) { }
    record DefaultDictionaryPage(List<DefaultDictionaryItem> items, long total, int page, int size) { }
    record DefaultDictionarySummary(String type, long total, long active) { }
    record DefaultDictionarySummaries(List<DefaultDictionarySummary> items) { }
}
