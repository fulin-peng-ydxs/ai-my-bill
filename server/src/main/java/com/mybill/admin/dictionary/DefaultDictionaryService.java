package com.mybill.admin.dictionary;

import com.mybill.admin.audit.AdminAuditService;
import com.mybill.admin.audit.AuditEvent;
import com.mybill.admin.audit.AuditPolicy;
import com.mybill.admin.audit.AuditResult;
import com.mybill.auth.CurrentPrincipal;
import com.mybill.dictionary.DictionaryNameNormalizer;
import com.mybill.shared.api.ApiException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static com.mybill.admin.dictionary.DefaultDictionaryContracts.DefaultDictionaryItem;
import static com.mybill.admin.dictionary.DefaultDictionaryContracts.DefaultDictionaryPage;
import static com.mybill.admin.dictionary.DefaultDictionaryContracts.DefaultDictionarySummaries;
import static com.mybill.admin.dictionary.DefaultDictionaryContracts.DefaultDictionarySummary;
import static com.mybill.admin.dictionary.DefaultDictionaryContracts.MoveDirection;

/** 管理员默认字典事务；变更只作用于之后创建用户所复制的快照。 */
@Service
class DefaultDictionaryService {
    private static final AuditPolicy CREATE_POLICY = new AuditPolicy("CREATE_DEFAULT_DICTIONARY", "DEFAULT_DICTIONARY",
            Set.of("dictionaryType", "status"));
    private static final AuditPolicy STATUS_POLICY = new AuditPolicy("CHANGE_DEFAULT_DICTIONARY_STATUS", "DEFAULT_DICTIONARY",
            Set.of("dictionaryType", "status"));
    private static final AuditPolicy MOVE_POLICY = new AuditPolicy("MOVE_DEFAULT_DICTIONARY", "DEFAULT_DICTIONARY",
            Set.of("dictionaryType", "direction"));

    private final DefaultDictionaryRepository repository;
    private final AdminAuditService auditService;
    private final Clock clock;

    DefaultDictionaryService(DefaultDictionaryRepository repository, AdminAuditService auditService, Clock clock) {
        this.repository = repository;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    DefaultDictionarySummaries summaries() {
        return new DefaultDictionarySummaries(repository.countAll().stream()
                .map(row -> new DefaultDictionarySummary(row.type().slug(), row.total(), row.active())).toList());
    }

    @Transactional(readOnly = true)
    DefaultDictionaryPage list(DefaultDictionaryType type, String query, DefaultDictionaryStatus status,
                               int page, int size) {
        String normalizedQuery = escapeLike(query == null ? "" : query.strip());
        List<DefaultDictionaryItem> items = repository.list(type, normalizedQuery, status, size, page * size)
                .stream().map(row -> response(type, row)).toList();
        return new DefaultDictionaryPage(items, repository.count(type, normalizedQuery, status), page, size);
    }

    @Transactional
    DefaultDictionaryItem create(CurrentPrincipal administrator, DefaultDictionaryType type,
                                 String requestedName, UUID parentId) {
        repository.lockCatalog();
        Name name = validateName(requestedName);
        validateParent(type, parentId);
        Instant now = clock.instant();
        UUID id = UUID.randomUUID();
        int maxSortOrder = repository.maxSortOrder(type, parentId);
        if (maxSortOrder > Integer.MAX_VALUE - 10) {
            writeSortOrders(type, repository.lockSiblingIds(type, parentId), now);
            maxSortOrder = repository.maxSortOrder(type, parentId);
        }
        try {
            repository.insert(type, id, "admin-" + id, name.display(), name.normalized(), maxSortOrder + 10, parentId, now);
        } catch (DuplicateKeyException exception) {
            throw duplicateName();
        }
        DefaultDictionaryItem item = response(type, requireItem(type, id));
        auditService.append(administrator, CREATE_POLICY, new AuditEvent(id.toString(), AuditResult.SUCCEEDED,
                Map.of(), Map.of("dictionaryType", type.name(), "status", item.status().name())));
        return item;
    }

    @Transactional
    DefaultDictionaryItem changeStatus(CurrentPrincipal administrator, DefaultDictionaryType type, UUID id,
                                       DefaultDictionaryStatus status) {
        repository.lockCatalog();
        DefaultDictionaryRepository.DefaultRow before = requireItem(type, id);
        if (before.status() == status) return response(type, before);
        if (type.hierarchical()) validateCategoryStatus(before, status);
        requireSingleRow(repository.updateStatus(type, id, status, clock.instant()));
        DefaultDictionaryItem item = response(type, requireItem(type, id));
        auditService.append(administrator, STATUS_POLICY, new AuditEvent(id.toString(), AuditResult.SUCCEEDED,
                Map.of("dictionaryType", type.name(), "status", before.status().name()),
                Map.of("dictionaryType", type.name(), "status", status.name())));
        return item;
    }

    @Transactional
    DefaultDictionaryItem move(CurrentPrincipal administrator, DefaultDictionaryType type, UUID id,
                               MoveDirection direction) {
        repository.lockCatalog();
        DefaultDictionaryRepository.DefaultRow target = repository.find(type, id, false)
                .orElseThrow(DefaultDictionaryService::itemNotFound);
        List<UUID> ordered = new ArrayList<>(repository.lockSiblingIds(type, target.parentId()));
        int current = ordered.indexOf(id);
        int destination = direction == MoveDirection.UP ? current - 1 : current + 1;
        if (current < 0 || destination < 0 || destination >= ordered.size()) return response(type, target);
        UUID displaced = ordered.get(destination);
        ordered.set(destination, id);
        ordered.set(current, displaced);
        writeSortOrders(type, ordered, clock.instant());
        DefaultDictionaryItem item = response(type, requireItem(type, id));
        auditService.append(administrator, MOVE_POLICY, new AuditEvent(id.toString(), AuditResult.SUCCEEDED,
                Map.of(), Map.of("dictionaryType", type.name(), "direction", direction.name())));
        return item;
    }

    private void validateParent(DefaultDictionaryType type, UUID parentId) {
        if (!type.hierarchical() && parentId != null) throw fieldError("parentId", "该默认字典不支持父级。");
        if (parentId == null) return;
        DefaultDictionaryRepository.DefaultRow parent = repository.find(DefaultDictionaryType.EXPENSE_CATEGORY,
                        parentId, true)
                .orElseThrow(() -> fieldError("parentId", "父分类不存在。"));
        if (parent.parentId() != null) throw fieldError("parentId", "默认支出分类最多两级。");
        if (parent.status() != DefaultDictionaryStatus.ACTIVE) throw fieldError("parentId", "不能在已停用分类下新增。");
    }

    private void validateCategoryStatus(DefaultDictionaryRepository.DefaultRow item, DefaultDictionaryStatus status) {
        if (status == DefaultDictionaryStatus.INACTIVE && item.parentId() == null
                && repository.activeChildren(item.id()) > 0) {
            throw new ApiException(HttpStatus.CONFLICT, "ACTIVE_CHILDREN_EXIST", "请先停用启用中的子分类。", false);
        }
        if (status == DefaultDictionaryStatus.ACTIVE && item.parentId() != null) {
            DefaultDictionaryRepository.DefaultRow parent = repository.find(DefaultDictionaryType.EXPENSE_CATEGORY,
                            item.parentId(), true)
                    .orElseThrow(() -> fieldError("parentId", "父分类不存在。"));
            if (parent.status() != DefaultDictionaryStatus.ACTIVE) {
                throw new ApiException(HttpStatus.CONFLICT, "PARENT_CATEGORY_INACTIVE", "请先恢复父分类。", false);
            }
        }
    }

    private Name validateName(String requestedName) {
        String display = DictionaryNameNormalizer.displayName(requestedName);
        String normalized = DictionaryNameNormalizer.normalizedName(display);
        int length = display.codePointCount(0, display.length());
        if (length == 0 || length > 100 || normalized.isEmpty()) {
            throw fieldError("name", "名称长度必须为 1-100 个字符。");
        }
        return new Name(display, normalized);
    }

    private DefaultDictionaryRepository.DefaultRow requireItem(DefaultDictionaryType type, UUID id) {
        return repository.find(type, id, true).orElseThrow(DefaultDictionaryService::itemNotFound);
    }

    private DefaultDictionaryItem response(DefaultDictionaryType type, DefaultDictionaryRepository.DefaultRow row) {
        return new DefaultDictionaryItem(row.id(), type.slug(), row.displayName(), row.status(), row.sortOrder(),
                row.parentId(), row.parentName());
    }

    private void writeSortOrders(DefaultDictionaryType type, List<UUID> ids, Instant now) {
        for (int index = 0; index < ids.size(); index++) repository.updateSortOrder(type, ids.get(index), index * 10, now);
    }

    private static ApiException duplicateName() {
        String message = "同类默认字典中已存在等价名称。";
        return new ApiException(HttpStatus.CONFLICT, "DEFAULT_DICTIONARY_NAME_CONFLICT", message, false,
                Map.of("name", List.of(message)));
    }

    private static ApiException itemNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "DEFAULT_DICTIONARY_ITEM_NOT_FOUND", "默认字典项不存在。", false);
    }

    private static ApiException fieldError(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, false,
                Map.of(field, List.of(message)));
    }

    private static void requireSingleRow(int affected) {
        if (affected != 1) throw new IllegalStateException("默认字典写入未命中唯一记录");
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private record Name(String display, String normalized) { }
}
