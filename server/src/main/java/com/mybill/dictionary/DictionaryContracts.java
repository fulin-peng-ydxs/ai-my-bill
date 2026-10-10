package com.mybill.dictionary;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.UUID;

final class DictionaryContracts {
    private DictionaryContracts() { }

    record CreateRequest(@NotBlank String name, UUID parentId) { }
    record RenameRequest(@NotBlank String name) { }
    record StatusRequest(@NotNull DictionaryStatus status) { }
    record MoveRequest(@NotNull MoveDirection direction, UUID targetId) { }
    enum MoveDirection { UP, DOWN }

    record DictionaryItem(UUID id, String type, String name, DictionaryStatus status, int sortOrder,
                          UUID parentId, String parentName, boolean referenced) { }
    record DictionaryPage(List<DictionaryItem> items, long total, int page, int size) { }
    record DictionarySummary(String type, long total, long active) { }
    record DictionarySummaries(List<DictionarySummary> items) { }
}
