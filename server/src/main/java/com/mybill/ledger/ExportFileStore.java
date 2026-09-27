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
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
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

    void validateLocation(String location) {
        if (location != null) contained(Path.of(location).toAbsolutePath().normalize());
    }

    StagedDeletion stageDeletion(Collection<String> locations, UUID deletionReference) {
        List<StagedFile> staged = new ArrayList<>();
        try {
            for (String location : locations.stream().filter(java.util.Objects::nonNull).distinct().toList()) {
                Path original = contained(Path.of(location).toAbsolutePath().normalize());
                if (!Files.exists(original)) continue;
                if (!Files.isRegularFile(original)) throw new IllegalStateException("export location is not a regular file");
                Path quarantine = contained(original.resolveSibling(
                        original.getFileName() + ".deleting-" + deletionReference));
                move(original, quarantine, false);
                staged.add(new StagedFile(original, quarantine));
            }
            return new StagedDeletion(List.copyOf(staged));
        } catch (RuntimeException failure) {
            try { restoreDeletion(new StagedDeletion(List.copyOf(staged))); }
            catch (RuntimeException restorationFailure) { failure.addSuppressed(restorationFailure); }
            throw failure;
        }
    }

    void completeDeletion(StagedDeletion deletion) {
        RuntimeException failure = null;
        for (StagedFile file : deletion.files()) {
            try { Files.deleteIfExists(file.quarantine()); }
            catch (IOException error) {
                if (failure == null) failure = new IllegalStateException("staged export deletion failed", error);
                else failure.addSuppressed(error);
            }
        }
        if (failure != null) throw failure;
    }

    void restoreDeletion(StagedDeletion deletion) {
        RuntimeException failure = null;
        for (StagedFile file : deletion.files().stream()
                .sorted(Comparator.comparing(StagedFile::quarantine).reversed()).toList()) {
            if (!Files.exists(file.quarantine())) continue;
            try { move(file.quarantine(), file.original(), false); }
            catch (RuntimeException error) {
                if (failure == null) failure = new IllegalStateException("staged export restoration failed", error);
                else failure.addSuppressed(error);
            }
        }
        if (failure != null) throw failure;
    }

    List<StagedFile> interruptedDeletions() {
        if (!Files.isDirectory(root)) return List.of();
        try (var paths = Files.walk(root)) {
            return paths.filter(Files::isRegularFile)
                    .map(this::asInterruptedDeletion)
                    .filter(java.util.Objects::nonNull)
                    .toList();
        } catch (IOException failure) {
            throw new IllegalStateException("staged export scan failed", failure);
        }
    }

    UUID tenantId(StagedFile file) {
        Path parent = file.original().getParent();
        if (parent == null || !root.equals(parent.getParent())) {
            throw new IllegalStateException("staged export is outside a tenant directory");
        }
        try { return UUID.fromString(parent.getFileName().toString()); }
        catch (IllegalArgumentException failure) {
            throw new IllegalStateException("staged export tenant directory is invalid", failure);
        }
    }

    void recoverInterruptedDeletion(StagedFile file, boolean exportStillRegistered) {
        if (!Files.exists(file.quarantine())) return;
        if (!exportStillRegistered || Files.exists(file.original())) {
            completeDeletion(new StagedDeletion(List.of(file)));
            return;
        }
        restoreDeletion(new StagedDeletion(List.of(file)));
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

    private StagedFile asInterruptedDeletion(Path candidate) {
        String filename = candidate.getFileName().toString();
        int marker = filename.lastIndexOf(".deleting-");
        if (marker <= 0) return null;
        try { UUID.fromString(filename.substring(marker + ".deleting-".length())); }
        catch (IllegalArgumentException ignored) { return null; }
        Path original = contained(candidate.resolveSibling(filename.substring(0, marker)));
        return new StagedFile(original, contained(candidate));
    }

    private static void move(Path source, Path target, boolean replace) {
        try {
            if (replace) Files.move(source, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            else Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException ignored) {
            try {
                if (replace) Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
                else Files.move(source, target);
            } catch (IOException failure) {
                throw new IllegalStateException("export file move failed", failure);
            }
        } catch (IOException failure) {
            throw new IllegalStateException("export file move failed", failure);
        }
    }

    private static void setPermissions(Path path, Set<PosixFilePermission> permissions) {
        try { Files.setPosixFilePermissions(path, permissions); }
        catch (UnsupportedOperationException | IOException ignored) { /* 非 POSIX 文件系统仍依赖应用目录 ACL。 */ }
    }

    record PendingFile(Path temporary, Path target, BufferedWriter writer) { }
    record StagedDeletion(List<StagedFile> files) { }
    record StagedFile(Path original, Path quarantine) { }
}
