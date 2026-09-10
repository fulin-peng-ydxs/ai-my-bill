package com.mybill.ledger;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.job.JobCoordinator;
import com.mybill.ledger.ExportContracts.CreateExportRequest;
import com.mybill.ledger.ExportContracts.ExportResponse;
import com.mybill.ledger.ExportContracts.ExportScope;
import com.mybill.ledger.ExportContracts.ExportSnapshot;
import com.mybill.shared.api.ApiException;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import static com.mybill.ledger.LedgerWritePolicy.digest;
import static com.mybill.ledger.LedgerWritePolicy.validateIdempotencyKey;

@Service
@EnableConfigurationProperties(ExportProperties.class)
class ExportService {
    private final ExportRepository repository;
    private final ExportFileStore files;
    private final TenantTransactionExecutor tenantTransactions;
    private final LedgerIdempotencyStore idempotency;
    private final LedgerQueryService ledgerQueries;
    private final JobCoordinator jobs;
    private final ExportProperties properties;
    private final ObjectMapper mapper;
    private final Clock clock;

    ExportService(ExportRepository repository, ExportFileStore files, TenantTransactionExecutor tenantTransactions,
                  LedgerIdempotencyStore idempotency, LedgerQueryService ledgerQueries, JobCoordinator jobs,
                  ExportProperties properties, ObjectMapper mapper, Clock clock) {
        this.repository = repository; this.files = files; this.tenantTransactions = tenantTransactions;
        this.idempotency = idempotency; this.ledgerQueries = ledgerQueries; this.jobs = jobs;
        this.properties = properties; this.mapper = mapper; this.clock = clock;
    }

    ExportResponse create(CurrentPrincipal principal, String requestedKey, CreateExportRequest request) {
        String key = validateIdempotencyKey(requestedKey);
        ExportSnapshot snapshot = snapshot(request);
        Instant now = clock.instant();
        String snapshotJson = json(snapshot);
        return tenantTransactions.execute(principal, () -> {
            LedgerIdempotencyStore.Reservation reservation = idempotency.reserve("CREATE_EXPORT", key,
                    digest(snapshotJson), now);
            UUID id = reservation.resultId();
            if (!reservation.replayed()) {
                id = UUID.randomUUID();
                Instant expiresAt = now.plus(properties.retention());
                repository.create(id, principal.userId(), snapshotJson, expiresAt, now);
                jobs.schedule(PersonalExportJob.TYPE, principal.tenantId(), id.toString());
                jobs.scheduleAt(ExpiredExportPurgeJob.TYPE, principal.tenantId(), id.toString(), expiresAt);
                idempotency.complete("CREATE_EXPORT", key, id, now);
            }
            return response(repository.findOwned(id, principal.userId()).orElseThrow(this::notFound), now);
        });
    }

    ExportResponse status(CurrentPrincipal principal, UUID id) {
        Instant now = clock.instant();
        return tenantTransactions.execute(principal, () -> response(
                repository.findOwned(id, principal.userId()).orElseThrow(this::notFound), now));
    }

    ExportResponse cancel(CurrentPrincipal principal, UUID id) {
        Instant now = clock.instant();
        return tenantTransactions.execute(principal, () -> {
            ExportRepository.Row row = repository.findOwned(id, principal.userId()).orElseThrow(this::notFound);
            if ((row.status().equals("PENDING") || row.status().equals("RUNNING")) && row.runId() != null) {
                String result = jobs.requestCancellation(row.runId());
                if (result.equals("CANCELLED")) repository.markCancelled(id, now);
            }
            return response(repository.findOwned(id, principal.userId()).orElseThrow(this::notFound), now);
        });
    }

    Download download(CurrentPrincipal principal, UUID id) {
        Instant now = clock.instant();
        return tenantTransactions.execute(principal, () -> {
            ExportRepository.Row row = repository.findOwned(id, principal.userId()).orElseThrow(this::notFound);
            ExportResponse response = response(row, now);
            if (response.status().equals("EXPIRED")) {
                repository.markExpired(id, now);
                throw new ApiException(HttpStatus.GONE, "EXPORT_EXPIRED", "导出文件已过期，请重新导出。", false);
            }
            if (!response.status().equals("SUCCEEDED") || response.rowCount() == 0 || row.fileLocation() == null) {
                throw new ApiException(HttpStatus.CONFLICT, "EXPORT_NOT_READY", "导出文件尚不可下载。", true);
            }
            Path path = files.readable(row.fileLocation());
            if (path == null) throw new ApiException(HttpStatus.GONE, "EXPORT_FILE_MISSING", "导出文件已清理，请重新导出。", false);
            String filename = "我的账单-" + clock.instant().atZone(LedgerWritePolicy.BUSINESS_ZONE).toLocalDate() + ".csv";
            return new Download(new FileSystemResource(path), filename);
        });
    }

    private ExportResponse response(ExportRepository.Row row, Instant now) {
        return repository.response(row, now);
    }

    private ExportSnapshot snapshot(CreateExportRequest request) {
        if (request.scope() == ExportScope.ALL_DATA) {
            return new ExportSnapshot(ExportScope.ALL_DATA, LedgerQueryContracts.EntryTypeFilter.ALL,
                    null, null, null, null, "");
        }
        LedgerQueryContracts.EntryTypeFilter type = request.type() == null
                ? LedgerQueryContracts.EntryTypeFilter.ALL : request.type();
        LedgerQueryContracts.LifecycleFilter lifecycle = request.lifecycle() == null
                ? LedgerQueryContracts.LifecycleFilter.ACTIVE : request.lifecycle();
        LedgerQueryContracts.DateRange range = request.range() == null
                ? LedgerQueryContracts.DateRange.TODAY : request.range();
        LedgerQueryService.DateBounds bounds = ledgerQueries.bounds(range, request.startDate(), request.endDate());
        return new ExportSnapshot(ExportScope.CURRENT_FILTERS, type, lifecycle, request.fundingChannelId(),
                bounds.start(), bounds.end(), request.query() == null ? "" : request.query().strip());
    }

    private String json(ExportSnapshot snapshot) {
        try { return mapper.writeValueAsString(snapshot); }
        catch (JsonProcessingException failure) { throw new IllegalStateException("export snapshot serialization failed", failure); }
    }

    private ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "EXPORT_NOT_FOUND", "导出任务不存在或不属于当前用户。", false);
    }

    record Download(FileSystemResource resource, String filename) { }
}
