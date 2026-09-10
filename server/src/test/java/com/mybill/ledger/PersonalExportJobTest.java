package com.mybill.ledger;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.job.JobExecutionContext;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PersonalExportJobTest {
    @Test
    void cancellationCompensationRemovesCommittedFileAndConvergesExportState() {
        Instant now = Instant.parse("2026-09-08T00:00:00Z");
        UUID tenantId = UUID.randomUUID();
        UUID exportId = UUID.randomUUID();
        ExportRepository repository = mock(ExportRepository.class);
        ExportFileStore files = mock(ExportFileStore.class);
        when(repository.findForJob(exportId)).thenReturn(Optional.of(new ExportRepository.JobRow(
                UUID.randomUUID(), "{}", now.plusSeconds(3600), "SUCCEEDED", "/exports/result.csv")));
        PersonalExportJob job = new PersonalExportJob(repository, mock(ExportCsvWriter.class), files,
                new ObjectMapper(), Clock.fixed(now, ZoneOffset.UTC));

        job.onCancellationWon(new JobExecutionContext(UUID.randomUUID(), tenantId, exportId.toString(),
                () -> true, () -> { }));

        verify(repository).markCancelled(exportId, now);
        verify(files).delete("/exports/result.csv");
        verify(repository).clearCancelledFileLocation(exportId, now);
    }
}
