package com.mybill.admin.audit;

import com.mybill.auth.CurrentPrincipal;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/** 高影响管理操作审计入口；成功动作加入业务事务，拒绝/失败动作可在回滚后独立调用。 */
@Service
public class AdminAuditService {
    private final AdminAuditRepository repository;
    private final AuditSummarySanitizer sanitizer;
    private final MeterRegistry meters;
    private final Clock clock;

    @Autowired
    public AdminAuditService(AdminAuditRepository repository, AuditSummarySanitizer sanitizer, MeterRegistry meters) {
        this(repository, sanitizer, meters, Clock.systemUTC());
    }

    AdminAuditService(AdminAuditRepository repository, AuditSummarySanitizer sanitizer,
                      MeterRegistry meters, Clock clock) {
        this.repository = repository;
        this.sanitizer = sanitizer;
        this.meters = meters;
        this.clock = clock;
    }

    @Transactional
    public UUID append(CurrentPrincipal principal, AuditPolicy policy, AuditEvent event) {
        if (principal == null || principal.role() != CurrentPrincipal.Role.ADMIN) {
            throw new SecurityException("仅管理员可写入管理审计");
        }
        UUID id = UUID.randomUUID();
        repository.append(new AdminAuditRecord(id, principal.userId(), policy.action(), policy.objectType(),
                event.objectId(), event.result(), sanitizer.changedFields(policy, event), Instant.now(clock)));
        meters.counter("my_bill.admin.audit.appended", "action", policy.action(),
                "result", event.result().name()).increment();
        return id;
    }
}
