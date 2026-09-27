package com.mybill.admin.audit;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

import static com.mybill.admin.audit.AdminAuditQueryContracts.AuditLogItem;
import static com.mybill.admin.audit.AdminAuditQueryContracts.AuditLogPage;
import static com.mybill.admin.audit.AdminAuditQueryContracts.Period;

@Service
class AdminAuditQueryService {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    private final AdminAuditRepository repository;
    private final Clock clock;

    AdminAuditQueryService(AdminAuditRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    AuditLogPage list(String administrator, String action, String object, AuditResult result,
                      Period period, int page, int size) {
        AdminAuditQuery query = new AdminAuditQuery(strip(administrator), strip(action), strip(object), result,
                startAt(period), size, Math.multiplyExact(page, size));
        var items = repository.find(query).stream().map(row -> new AuditLogItem(row.id(), row.administrator(),
                row.action(), row.objectType(), row.objectId(), row.result(), row.safeSummary(), row.occurredAt()))
                .toList();
        return new AuditLogPage(items, repository.count(query), page, size);
    }

    private Instant startAt(Period period) {
        if (period == Period.ALL) return null;
        LocalDate today = LocalDate.now(clock.withZone(BUSINESS_ZONE));
        LocalDate start = switch (period) {
            case TODAY -> today;
            case LAST_7_DAYS -> today.minusDays(6);
            case LAST_30_DAYS -> today.minusDays(29);
            case ALL -> throw new IllegalStateException("ALL 不应计算起始时间");
        };
        return start.atStartOfDay(BUSINESS_ZONE).toInstant();
    }

    private static String strip(String value) {
        return value == null ? "" : value.strip();
    }
}
