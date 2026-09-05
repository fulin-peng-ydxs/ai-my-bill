package com.mybill.admin.audit;

public interface AdminAuditRepository {
    void append(AdminAuditRecord record);
}
