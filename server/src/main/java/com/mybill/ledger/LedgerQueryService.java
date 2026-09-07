package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.ledger.LedgerQueryContracts.*;
import com.mybill.ledger.LedgerQueryRepository.Cursor;
import com.mybill.ledger.LedgerQueryRepository.Query;
import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.TemporalAdjusters;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import static com.mybill.ledger.LedgerWritePolicy.BUSINESS_ZONE;

@Service
class LedgerQueryService {
    static final int PAGE_SIZE = 20;
    private final LedgerQueryRepository repository;
    private final TenantTransactionExecutor tenantTransactions;
    private final Clock clock;

    LedgerQueryService(LedgerQueryRepository repository, TenantTransactionExecutor tenantTransactions, Clock clock) {
        this.repository = repository; this.tenantTransactions = tenantTransactions; this.clock = clock;
    }

    LedgerPage query(CurrentPrincipal principal, EntryTypeFilter type, UUID fundingChannelId, DateRange range,
                     LocalDate startDate, LocalDate endDate, String keyword, String encodedCursor) {
        DateBounds bounds = bounds(range, startDate, endDate);
        String normalizedKeyword = keyword == null ? "" : keyword.strip();
        Cursor cursor = decodeCursor(encodedCursor);
        return tenantTransactions.execute(principal, () -> {
            List<LedgerItem> rows = repository.findPage(new Query(bounds.start(), bounds.end(), type,
                    fundingChannelId, normalizedKeyword, cursor), PAGE_SIZE + 1);
            boolean hasMore = rows.size() > PAGE_SIZE;
            List<LedgerItem> items = hasMore ? List.copyOf(rows.subList(0, PAGE_SIZE)) : List.copyOf(rows);
            String next = hasMore ? encodeCursor(items.get(items.size() - 1)) : null;
            return new LedgerPage(items, next, hasMore);
        });
    }

    private DateBounds bounds(DateRange range, LocalDate customStart, LocalDate customEnd) {
        LocalDate today = LocalDate.now(clock.withZone(BUSINESS_ZONE));
        return switch (range) {
            case TODAY -> new DateBounds(today, today);
            case THIS_WEEK -> new DateBounds(today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)), today);
            case THIS_MONTH -> new DateBounds(today.withDayOfMonth(1), today);
            case LAST_MONTH -> { YearMonth month = YearMonth.from(today).minusMonths(1); yield new DateBounds(month.atDay(1), month.atEndOfMonth()); }
            case THIS_YEAR -> new DateBounds(today.withDayOfYear(1), today);
            case CUSTOM -> {
                if (customStart == null || customEnd == null || customEnd.isBefore(customStart)) {
                    throw fieldError("startDate", "指定日期必须完整，且结束日期不能早于开始日期。");
                }
                yield new DateBounds(customStart, customEnd);
            }
        };
    }

    private static String encodeCursor(LedgerItem item) {
        String raw = String.join("|", item.businessDate().toString(), item.occurredAt().toString(),
                item.createdAt().toString(), item.id().toString());
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    private static Cursor decodeCursor(String encoded) {
        if (encoded == null || encoded.isBlank()) return null;
        try {
            String[] parts = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8).split("\\|", -1);
            if (parts.length != 4) throw new IllegalArgumentException();
            return new Cursor(LocalDate.parse(parts[0]), java.time.Instant.parse(parts[1]),
                    java.time.Instant.parse(parts[2]), UUID.fromString(parts[3]));
        } catch (RuntimeException exception) {
            throw fieldError("cursor", "分页游标无效，请重新加载首批结果。");
        }
    }

    private static ApiException fieldError(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, false,
                java.util.Map.of(field, List.of(message)));
    }

    private record DateBounds(LocalDate start, LocalDate end) { }
}
