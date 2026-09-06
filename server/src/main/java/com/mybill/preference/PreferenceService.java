package com.mybill.preference;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.mybill.preference.PreferenceContracts.EntryType;
import static com.mybill.preference.PreferenceContracts.LedgerRange;
import static com.mybill.preference.PreferenceContracts.PreferenceRequest;
import static com.mybill.preference.PreferenceContracts.PreferenceResponse;
import static com.mybill.preference.PreferenceContracts.ReportRange;
import static com.mybill.preference.PreferenceContracts.ThemeMode;

@Service
class PreferenceService {
    private static final LedgerRange DEFAULT_LEDGER_RANGE = LedgerRange.TODAY;
    private static final ReportRange DEFAULT_REPORT_RANGE = ReportRange.THIS_MONTH;
    private static final ThemeMode DEFAULT_THEME_MODE = ThemeMode.SYSTEM;
    private static final EntryType DEFAULT_ENTRY_TYPE = EntryType.EXPENSE;

    private final PreferenceRepository repository;
    private final TenantTransactionExecutor tenantTransactions;
    private final Clock clock;

    PreferenceService(PreferenceRepository repository, TenantTransactionExecutor tenantTransactions, Clock clock) {
        this.repository = repository;
        this.tenantTransactions = tenantTransactions;
        this.clock = clock;
    }

    PreferenceResponse get(CurrentPrincipal principal) {
        return tenantTransactions.execute(principal, () -> repository.find(principal.userId())
                .map(this::safeResponse)
                .orElseGet(() -> defaults(clock.instant())));
    }

    PreferenceResponse save(CurrentPrincipal principal, PreferenceRequest request) {
        return tenantTransactions.execute(principal, () -> {
            validateFundingChannel(request.defaultFundingChannelId());
            Instant now = clock.instant();
            int affected = repository.upsert(principal.userId(), request.defaultFundingChannelId(),
                    request.ledgerDefaultRange().name(), request.reportDefaultRange().name(),
                    request.themeMode().name(), request.recentEntryType().name(), now);
            if (affected != 1) throw new IllegalStateException("偏好写入未命中唯一记录");
            PreferenceRepository.PreferenceRow saved = repository.find(principal.userId()).orElseThrow();
            return safeResponse(saved);
        });
    }

    PreferenceResponse reset(CurrentPrincipal principal) {
        return tenantTransactions.execute(principal, () -> {
            int affected = repository.delete(principal.userId());
            if (affected > 1) throw new IllegalStateException("偏好重置命中多条记录");
            return defaults(clock.instant());
        });
    }

    private void validateFundingChannel(UUID id) {
        if (id != null && !repository.isActiveFundingChannel(id)) {
            String message = "默认资金渠道不存在或已停用。";
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, false,
                    Map.of("defaultFundingChannelId", List.of(message)));
        }
    }

    private PreferenceResponse safeResponse(PreferenceRepository.PreferenceRow row) {
        return new PreferenceResponse(
                row.fundingChannelActive() ? row.fundingChannelId() : null,
                row.fundingChannelActive() ? row.fundingChannelName() : null,
                parse(row.ledgerRange(), LedgerRange.class, DEFAULT_LEDGER_RANGE),
                parse(row.reportRange(), ReportRange.class, DEFAULT_REPORT_RANGE),
                parse(row.themeMode(), ThemeMode.class, DEFAULT_THEME_MODE),
                parse(row.entryType(), EntryType.class, DEFAULT_ENTRY_TYPE),
                row.updatedAt()
        );
    }

    private PreferenceResponse defaults(Instant now) {
        return new PreferenceResponse(null, null, DEFAULT_LEDGER_RANGE, DEFAULT_REPORT_RANGE,
                DEFAULT_THEME_MODE, DEFAULT_ENTRY_TYPE, now);
    }

    private <T extends Enum<T>> T parse(String value, Class<T> type, T fallback) {
        try {
            return Enum.valueOf(type, value);
        } catch (IllegalArgumentException | NullPointerException ignored) {
            return fallback;
        }
    }
}
