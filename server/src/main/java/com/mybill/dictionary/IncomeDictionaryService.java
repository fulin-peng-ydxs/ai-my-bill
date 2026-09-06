package com.mybill.dictionary;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

/** 收入模块使用的显式字典边界；所有查询受当前租户 RLS 上下文约束。 */
@Service
public class IncomeDictionaryService {
    private final JdbcClient jdbc;

    public IncomeDictionaryService(JdbcClient jdbc) { this.jdbc = jdbc; }

    public IncomeReferences lockActiveReferences(UUID payerId, UUID categoryId, UUID fundingId) {
        return new IncomeReferences(lock("payer", payerId).orElse(null),
                lock("income_category", categoryId).orElse(null), lock("funding_channel", fundingId).orElse(null));
    }

    private Optional<NamedReference> lock(String table, UUID id) {
        return jdbc.sql("SELECT id,display_name FROM " + table + " WHERE id=:id AND status='ACTIVE' FOR SHARE")
                .param("id", id).query((rs, row) -> new NamedReference(rs.getObject(1, UUID.class), rs.getString(2))).optional();
    }

    public record NamedReference(UUID id, String name) { }
    public record IncomeReferences(NamedReference payer, NamedReference category, NamedReference fundingChannel) { }
}
