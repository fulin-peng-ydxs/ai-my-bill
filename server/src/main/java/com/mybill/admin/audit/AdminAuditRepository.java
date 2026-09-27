package com.mybill.admin.audit;

public interface AdminAuditRepository {
    void append(AdminAuditRecord record);

    java.util.List<AdminAuditQueryRow> find(AdminAuditQuery query);

    long count(AdminAuditQuery query);
}
