package com.mybill.persistence.model;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;

import java.util.UUID;

/** 租户表通用映射；复合主键与隔离边界由数据库约束及 RLS 强制执行。 */
abstract class TenantScopedEntity {
    @TableField("tenant_id") protected UUID tenantId;
    @TableId("id") protected UUID id;
}
