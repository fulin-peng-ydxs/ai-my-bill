package com.mybill.account;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.UUID;

public final class AccountDeletionContracts {
    private AccountDeletionContracts() { }

    public record SelfDeletionRequest(@NotNull @Size(min = 3, max = 64) String confirmation) { }
    public record AdminDeletionRequest(@Positive long version) { }
    public record DeletionResult(UUID deletionReference, Instant executedAt, Instant auditExpiresAt) { }
}
