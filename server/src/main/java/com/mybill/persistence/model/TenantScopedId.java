package com.mybill.persistence.model;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/**
 * 租户业务表统一复合身份；tenant_id 必须作为主键和跨表外键的前导列。
 */
@Embeddable
public class TenantScopedId implements Serializable {

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "id", nullable = false)
    private UUID id;

    protected TenantScopedId() {
    }

    public TenantScopedId(UUID tenantId, UUID id) {
        this.tenantId = tenantId;
        this.id = id;
    }

    public UUID tenantId() {
        return tenantId;
    }

    public UUID id() {
        return id;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof TenantScopedId that)) {
            return false;
        }
        return Objects.equals(tenantId, that.tenantId) && Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(tenantId, id);
    }
}
