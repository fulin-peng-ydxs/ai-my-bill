package com.mybill.dictionary;

import com.mybill.shared.SiblingOrder;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.shared.api.ApiException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.mybill.dictionary.DictionaryContracts.DictionaryItem;
import static com.mybill.dictionary.DictionaryContracts.DictionaryPage;
import static com.mybill.dictionary.DictionaryContracts.DictionarySummaries;
import static com.mybill.dictionary.DictionaryContracts.DictionarySummary;
import static com.mybill.dictionary.DictionaryContracts.MoveDirection;

/** 当前用户个人字典应用服务；所有访问都由认证身份建立事务级 RLS 上下文。 */
@Service
class PersonalDictionaryService {
    private final PersonalDictionaryRepository repository;
    private final ProductMergeRepository productMergeRepository;
    private final TenantTransactionExecutor tenantTransactions;
    private final Clock clock;

    PersonalDictionaryService(PersonalDictionaryRepository repository, ProductMergeRepository productMergeRepository,
                              TenantTransactionExecutor tenantTransactions, Clock clock) {
        this.repository = repository;
        this.productMergeRepository = productMergeRepository;
        this.tenantTransactions = tenantTransactions;
        this.clock = clock;
    }

    DictionarySummaries summaries(CurrentPrincipal principal) {
        return tenantTransactions.execute(principal, () -> new DictionarySummaries(repository.countAll().stream()
                .map(row -> new DictionarySummary(row.type().slug(), row.total(), row.active())).toList()));
    }

    DictionaryPage list(CurrentPrincipal principal, DictionaryType type, String query, DictionaryStatus status,
                        int page, int size, boolean candidatesOnly) {
        return list(principal, type, query, status, page, size, candidatesOnly, null, false);
    }

    /** 历史筛选允许停用项，分类层级条件在分页前进入 SQL，不能在前端截断后过滤。 */
    DictionaryPage list(CurrentPrincipal principal, DictionaryType type, String query, DictionaryStatus status,
                        int page, int size, boolean candidatesOnly, UUID parentId, boolean rootsOnly) {
        if ((parentId != null || rootsOnly) && !type.hierarchical() || parentId != null && rootsOnly) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "分类层级筛选不合法。", false);
        }
        return tenantTransactions.execute(principal, () -> {
            String normalizedQuery = escapeLike(query == null ? "" : query.strip());
            List<DictionaryItem> items = repository.list(type, normalizedQuery, status, size, page * size,
                            candidatesOnly, parentId, rootsOnly)
                    .stream().map(row -> response(type, row)).toList();
            long total = repository.count(type, normalizedQuery, status, candidatesOnly, parentId, rootsOnly);
            return new DictionaryPage(items, total, page, size);
        });
    }

    DictionaryItem get(CurrentPrincipal principal, DictionaryType type, UUID id) {
        return tenantTransactions.execute(principal, () -> response(type,
                repository.find(type, id).orElseThrow(PersonalDictionaryService::itemNotFound)));
    }

    DictionaryItem create(CurrentPrincipal principal, DictionaryType type, String requestedName, UUID parentId) {
        return tenantTransactions.execute(principal, () -> {
            Name name = validateName(type, requestedName);
            validateParent(type, parentId);
            Instant now = clock.instant();
            UUID id = UUID.randomUUID();
            int maxSortOrder = repository.maxSortOrder(type, parentId);
            if (maxSortOrder > Integer.MAX_VALUE - 10) {
                normalizeSortOrders(type, parentId, now);
                maxSortOrder = repository.maxSortOrder(type, parentId);
            }
            int sortOrder = maxSortOrder + 10;
            try {
                repository.insert(type, id, name.display(), name.normalized(), sortOrder, parentId, now);
            } catch (DuplicateKeyException exception) {
                throw duplicateName();
            }
            return response(type, repository.findForUpdate(type, id).orElseThrow());
        });
    }

    DictionaryItem rename(CurrentPrincipal principal, DictionaryType type, UUID id, String requestedName) {
        return tenantTransactions.execute(principal, () -> {
            requireItem(type, id);
            Name name = validateName(type, requestedName);
            Instant now = clock.instant();
            try {
                requireSingleRow(repository.rename(type, id, name.display(), name.normalized(), now));
                if (type == DictionaryType.PRODUCT) {
                    productMergeRepository.renameTemplate(id, name.display(), name.normalized(), now);
                }
            } catch (DuplicateKeyException exception) {
                throw duplicateName();
            }
            return response(type, repository.findForUpdate(type, id).orElseThrow());
        });
    }

    DictionaryItem changeStatus(CurrentPrincipal principal, DictionaryType type, UUID id, DictionaryStatus status) {
        return tenantTransactions.execute(principal, () -> {
            PersonalDictionaryRepository.DictionaryRow before = requireItem(type, id);
            if (before.status() == status) return response(type, before);
            if (type.hierarchical()) validateCategoryStatus(before, status);
            requireSingleRow(repository.updateStatus(type, id, status, clock.instant()));
            return response(type, repository.findForUpdate(type, id).orElseThrow());
        });
    }

    DictionaryItem move(CurrentPrincipal principal, DictionaryType type, UUID id, MoveDirection direction, UUID targetId) {
        return tenantTransactions.execute(principal, () -> {
            PersonalDictionaryRepository.DictionaryRow target = repository.find(type, id)
                    .orElseThrow(PersonalDictionaryService::itemNotFound);
            List<UUID> ordered = new ArrayList<>(repository.lockSiblingIds(type, target.parentId()));
            if (!ordered.contains(id)) throw itemNotFound();
            if (targetId != null && !ordered.contains(targetId)) {
                throw fieldError("targetId", "只能移动到当前字典的同级选项旁。");
            }
            if (!SiblingOrder.move(ordered, id, targetId, direction == MoveDirection.UP)) return response(type, target);
            Instant now = clock.instant();
            writeSortOrders(type, ordered, now);
            return response(type, repository.findForUpdate(type, id).orElseThrow());
        });
    }

    private void validateParent(DictionaryType type, UUID parentId) {
        if (!type.hierarchical() && parentId != null) {
            throw fieldError("parentId", "该字典不支持父级。");
        }
        if (parentId == null) return;
        PersonalDictionaryRepository.DictionaryRow parent = repository.findForUpdate(DictionaryType.EXPENSE_CATEGORY, parentId)
                .orElseThrow(() -> fieldError("parentId", "父分类不存在。"));
        if (parent.parentId() != null) throw fieldError("parentId", "支出分类最多两级。");
        if (parent.status() != DictionaryStatus.ACTIVE) throw fieldError("parentId", "不能在已停用分类下新增。");
    }

    private void validateCategoryStatus(PersonalDictionaryRepository.DictionaryRow item, DictionaryStatus status) {
        if (status == DictionaryStatus.INACTIVE && item.parentId() == null && repository.activeChildren(item.id()) > 0) {
            throw new ApiException(HttpStatus.CONFLICT, "ACTIVE_CHILDREN_EXIST",
                    "请先停用该分类下的启用子分类。", false);
        }
        if (status == DictionaryStatus.ACTIVE && item.parentId() != null) {
            PersonalDictionaryRepository.DictionaryRow parent = repository.findForUpdate(
                            DictionaryType.EXPENSE_CATEGORY, item.parentId())
                    .orElseThrow(() -> fieldError("parentId", "父分类不存在。"));
            if (parent.status() != DictionaryStatus.ACTIVE) {
                throw new ApiException(HttpStatus.CONFLICT, "PARENT_CATEGORY_INACTIVE",
                        "请先恢复父分类。", false);
            }
        }
    }

    private Name validateName(DictionaryType type, String requestedName) {
        String display = DictionaryNameNormalizer.displayName(requestedName);
        int length = display.codePointCount(0, display.length());
        String normalized = DictionaryNameNormalizer.normalizedName(display);
        if (length == 0 || length > type.nameLimit() || normalized.isEmpty()) {
            throw fieldError("name", "名称长度必须为 1-" + type.nameLimit() + " 个字符。");
        }
        return new Name(display, normalized);
    }

    private PersonalDictionaryRepository.DictionaryRow requireItem(DictionaryType type, UUID id) {
        return repository.findForUpdate(type, id)
                .orElseThrow(PersonalDictionaryService::itemNotFound);
    }

    private DictionaryItem response(DictionaryType type, PersonalDictionaryRepository.DictionaryRow row) {
        return new DictionaryItem(row.id(), type.slug(), row.displayName(), row.status(), row.sortOrder(),
                row.parentId(), row.parentName(), row.referenced());
    }

    private ApiException duplicateName() {
        String message = "同一字典中已存在等价名称。";
        return new ApiException(HttpStatus.CONFLICT, "DICTIONARY_NAME_CONFLICT", message, false,
                Map.of("name", List.of(message)));
    }

    private ApiException fieldError(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, false,
                Map.of(field, List.of(message)));
    }

    private static ApiException itemNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "DICTIONARY_ITEM_NOT_FOUND", "字典项不存在。", false);
    }

    private void normalizeSortOrders(DictionaryType type, UUID parentId, Instant now) {
        writeSortOrders(type, repository.lockSiblingIds(type, parentId), now);
    }

    private void writeSortOrders(DictionaryType type, List<UUID> ordered, Instant now) {
        for (int index = 0; index < ordered.size(); index++) {
            repository.updateSortOrder(type, ordered.get(index), index * 10, now);
        }
    }

    private void requireSingleRow(int affectedRows) {
        if (affectedRows != 1) throw new IllegalStateException("个人字典写入未命中唯一记录");
    }

    private String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private record Name(String display, String normalized) { }
}
