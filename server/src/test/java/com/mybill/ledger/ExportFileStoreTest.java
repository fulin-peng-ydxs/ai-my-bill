package com.mybill.ledger;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class ExportFileStoreTest {
    @TempDir Path root;

    @Test
    void stagedDeletionCanRollbackWithoutLosingTheExport() throws Exception {
        ExportFileStore store = new ExportFileStore(new ExportProperties(root, Duration.ofHours(24)));
        Path export = root.resolve("tenant/export.csv");
        Files.createDirectories(export.getParent());
        Files.writeString(export, "private export");

        ExportFileStore.StagedDeletion staged = store.stageDeletion(
                List.of(export.toString()), UUID.fromString("19900000-0000-4000-8000-000000000001"));

        assertThat(export).doesNotExist();
        assertThat(staged.files()).singleElement().satisfies(file -> assertThat(file.quarantine()).exists());
        store.restoreDeletion(staged);
        assertThat(export).hasContent("private export");
    }

    @Test
    void stagedDeletionPhysicallyRemovesTheExportAfterCommit() throws Exception {
        ExportFileStore store = new ExportFileStore(new ExportProperties(root, Duration.ofHours(24)));
        Path export = root.resolve("tenant/export.csv");
        Files.createDirectories(export.getParent());
        Files.writeString(export, "private export");

        ExportFileStore.StagedDeletion staged = store.stageDeletion(
                List.of(export.toString()), UUID.fromString("19900000-0000-4000-8000-000000000002"));
        store.completeDeletion(staged);

        assertThat(export).doesNotExist();
        assertThat(staged.files()).singleElement().satisfies(file -> assertThat(file.quarantine()).doesNotExist());
    }

    @Test
    void startupRecoveryRestoresAStillRegisteredExport() throws Exception {
        PersonalExportDeletionService service = serviceWithInterruptedFile(
                "19900000-0000-4000-8000-000000000003");

        assertThat(service.recoverInterruptedDeletions((tenantId, location) -> {
            assertThat(tenantId).isEqualTo(UUID.fromString("19900000-0000-4000-8000-000000000003"));
            return true;
        })).isOne();
        assertThat(root.resolve("19900000-0000-4000-8000-000000000003/export.csv"))
                .hasContent("private export");
    }

    @Test
    void startupRecoveryDeletesAnExportWhoseDatabaseRecordIsGone() throws Exception {
        PersonalExportDeletionService service = serviceWithInterruptedFile(
                "19900000-0000-4000-8000-000000000004");

        assertThat(service.recoverInterruptedDeletions((tenantId, location) -> false)).isOne();
        try (var paths = Files.walk(root)) {
            assertThat(paths.filter(Files::isRegularFile)).isEmpty();
        }
    }

    private PersonalExportDeletionService serviceWithInterruptedFile(String tenantId) throws Exception {
        ExportFileStore store = new ExportFileStore(new ExportProperties(root, Duration.ofHours(24)));
        Path export = root.resolve(tenantId).resolve("export.csv");
        Files.createDirectories(export.getParent());
        Files.writeString(export, "private export");
        store.stageDeletion(List.of(export.toString()), UUID.randomUUID());
        return new PersonalExportDeletionService(store);
    }
}
