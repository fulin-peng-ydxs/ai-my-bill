package com.mybill.persistence.model;

import jakarta.persistence.EmbeddedId;
import jakarta.persistence.MappedSuperclass;

/**
 * 仅承载复合主键映射；业务实体不得另建可绕过 tenant_id 的单列身份。
 */
@MappedSuperclass
abstract class TenantScopedEntity {

    @EmbeddedId
    protected TenantScopedId id;

    protected TenantScopedEntity() {
    }
}
