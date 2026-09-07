package com.mybill.ledger;

import org.springframework.stereotype.Component;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;
import java.util.UUID;

@Component
class ExportFileStore {
    private static final Set<PosixFilePermission> DIRECTORY_PERMISSIONS = Set.of(
            PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE, PosixFilePermission.OWNER_EXECUTE);
    private static final Set<PosixFilePermission> FILE_PERMISSIONS = Set.of(
            PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE);
    private final Path root;

    ExportFileStore(ExportProperties properties) { this.root = properties.directory(); }

    PendingFile create(UUID tenantId, UUID exportId) throws IOException {
        Path directory = contained(root.resolve(tenantId.toString()));
        Files.createDirectories(directory);
        setPermissions(directory, DIRECTORY_PERMISSIONS);
        Path target = contained(directory.resolve(exportId + ".csv"));
        Path temporary = contained(directory.resolve(exportId + ".csv.part"));
        Files.deleteIfExists(temporary);
        BufferedWriter writer = Files.newBufferedWriter(temporary, StandardCharsets.UTF_8);
        setPermissions(temporary, FILE_PERMISSIONS);
        return new PendingFile(temporary, target, writer);
    }

    String commit(PendingFile file) throws IOException {
        file.writer().close();
        try {
            Files.move(file.temporary(), file.target(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException ignored) {
            Files.move(file.temporary(), file.target(), StandardCopyOption.REPLACE_EXISTING);
        }
        setPermissions(file.target(), FILE_PERMISSIONS);
        return file.target().toString();
    }

    Path readable(String location) {
        Path path = contained(Path.of(location).toAbsolutePath().normalize());
        return Files.isRegularFile(path) ? path : null;
    }

    void delete(String location) {
        if (location == null) return;
        try { Files.deleteIfExists(contained(Path.of(location).toAbsolutePath().normalize())); }
        catch (IOException failure) { throw new IllegalStateException("export file deletion failed", failure); }
    }

    void abort(PendingFile file) {
        if (file == null) return;
        try { file.writer().close(); } catch (IOException ignored) { }
        try { delete(file.temporary().toString()); } catch (RuntimeException ignored) { }
    }

    private Path contained(Path candidate) {
        Path normalized = candidate.toAbsolutePath().normalize();
        if (!normalized.startsWith(root)) throw new IllegalArgumentException("export path escapes configured directory");
        return normalized;
    }

    private static void setPermissions(Path path, Set<PosixFilePermission> permissions) {
        try { Files.setPosixFilePermissions(path, permissions); }
        catch (UnsupportedOperationException | IOException ignored) { /* 非 POSIX 文件系统仍依赖应用目录 ACL。 */ }
    }

    record PendingFile(Path temporary, Path target, BufferedWriter writer) { }
}
