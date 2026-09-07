package com.mybill.dictionary;

import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

/** 收入模块使用的显式字典边界；所有查询受当前租户 RLS 上下文约束。 */
@Service
public class IncomeDictionaryService {
    private final MybatisOperations operations;
    private final IncomeDictionaryServiceMapper mapper;

    public IncomeDictionaryService(MybatisOperations operations, IncomeDictionaryServiceMapper mapper) {
        this.operations = operations;
        this.mapper = mapper;
    }

    public IncomeReferences lockActiveReferences(UUID payerId, UUID categoryId, UUID fundingId) {
        return new IncomeReferences(lock("PAYER", payerId).orElse(null),
                lock("INCOME_CATEGORY", categoryId).orElse(null), lock("FUNDING_CHANNEL", fundingId).orElse(null));
    }

    private Optional<NamedReference> lock(String type, UUID id) {
        return operations.select(mapper::lock).param("type", type).param("id", id)
                .map((row, index) -> new NamedReference(row.getObject("id", UUID.class), row.getString("display_name")))
                .optional();
    }

    public record NamedReference(UUID id, String name) { }
    public record IncomeReferences(NamedReference payer, NamedReference category, NamedReference fundingChannel) { }
}
