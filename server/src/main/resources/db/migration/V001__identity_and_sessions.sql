-- T2 身份与会话基线。由迁移所有者在空库或上一 Flyway 版本上执行；影响租户、账号、会话与认证限流。
-- 生产环境只允许前向修复；仅空环境首次部署失败时可人工执行 db/rollback/U001__identity_and_sessions.sql。

CREATE TABLE tenant (
    id uuid PRIMARY KEY,
    status varchar(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tenant_status ON tenant (status, id);

CREATE TABLE app_user (
    id uuid PRIMARY KEY,
    username varchar(64) NOT NULL,
    password_digest varchar(255) NOT NULL,
    temporary_password_expires_at timestamptz,
    role varchar(16) NOT NULL CHECK (role IN ('ADMIN', 'USER')),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'DISABLED', 'DELETION_PENDING', 'DELETED')),
    tenant_id uuid REFERENCES tenant (id),
    credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version > 0),
    last_active_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_app_user_username UNIQUE (username),
    CONSTRAINT uq_app_user_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT ck_app_user_username_visible_ascii
        CHECK (username COLLATE "C" ~ '^[!-~]{3,64}$'),
    CONSTRAINT ck_app_user_role_tenant
        CHECK ((role = 'ADMIN' AND tenant_id IS NULL) OR (role = 'USER' AND tenant_id IS NOT NULL))
);

CREATE UNIQUE INDEX uq_app_user_one_user_per_tenant
    ON app_user (tenant_id) WHERE role = 'USER' AND status <> 'DELETED';
CREATE INDEX idx_app_user_status ON app_user (status, id);

CREATE TABLE user_session (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_user (id),
    token_digest varchar(128) NOT NULL UNIQUE,
    credential_version bigint NOT NULL CHECK (credential_version > 0),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoked_reason varchar(64),
    last_used_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_user_session_revocation
        CHECK ((revoked_at IS NULL AND revoked_reason IS NULL)
            OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))
);

CREATE INDEX idx_user_session_active
    ON user_session (user_id, expires_at, id) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_session_expiry ON user_session (expires_at, id);

CREATE TABLE auth_rate_limit (
    id uuid PRIMARY KEY,
    entry_point varchar(32) NOT NULL CHECK (entry_point IN ('LOGIN', 'PASSWORD_RESET')),
    subject_digest varchar(128) NOT NULL,
    window_started_at timestamptz NOT NULL,
    failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    locked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_auth_rate_limit_window UNIQUE (entry_point, subject_digest, window_started_at)
);

CREATE INDEX idx_auth_rate_limit_locked ON auth_rate_limit (locked_until)
    WHERE locked_until IS NOT NULL;
