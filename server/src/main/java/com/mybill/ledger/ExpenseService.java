package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.dictionary.ExpenseDictionaryService;
import com.mybill.dictionary.ExpenseDictionaryService.ExpenseReferences;
import com.mybill.dictionary.DictionaryNameNormalizer;
import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.mybill.ledger.ExpenseContracts.CreationResult;
import static com.mybill.ledger.ExpenseContracts.CreateExpenseRequest;
import static com.mybill.ledger.ExpenseContracts.ProductSuggestion;
import static com.mybill.ledger.ExpenseContracts.ProductSuggestions;

/** 支出填报应用服务；引用校验、幂等、账目和商品最近值在一个租户事务内提交。 */
@Service
class ExpenseService {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    private static final Duration FUTURE_TOLERANCE = Duration.ofMinutes(5);
    private static final Duration IDEMPOTENCY_TTL = Duration.ofHours(24);
    private final ExpenseRepository repository;
    private final ExpenseDictionaryService dictionaries;
    private final TenantTransactionExecutor tenantTransactions;
    private final Clock clock;

    ExpenseService(ExpenseRepository repository, ExpenseDictionaryService dictionaries,
                   TenantTransactionExecutor tenantTransactions, Clock clock) {
        this.repository = repository;
        this.dictionaries = dictionaries;
        this.tenantTransactions = tenantTransactions;
        this.clock = clock;
    }

    ProductSuggestions products(CurrentPrincipal principal, String query) {
        String normalized = escapeLike(DictionaryNameNormalizer.normalizedName(query));
        return tenantTransactions.execute(principal, () -> new ProductSuggestions(
                dictionaries.listActiveProducts(normalized, 20).stream().map(value -> new ProductSuggestion(
                        value.id(), value.name(), value.primaryCategoryId(), value.primaryCategoryName(),
                        value.secondaryCategoryId(), value.secondaryCategoryName(), value.unitId(), value.unitName(),
                        value.lastUnitPrice() == null ? null : decimal(value.lastUnitPrice()),
                        value.fundingChannelId(), value.fundingChannelName(),
                        value.purchaseChannelId(), value.purchaseChannelName())).toList()));
    }

    CreationResult create(CurrentPrincipal principal, String requestedKey, CreateExpenseRequest request) {
        String key = validateIdempotencyKey(requestedKey);
        Instant now = clock.instant();
        validateOccurredAt(request.occurredAt(), now);
        String note = normalizeNote(request.note());
        BigDecimal unitPrice = decimalField("unitPrice", request.unitPrice(), 4,
                new BigDecimal("99999999.9999"), false);
        BigDecimal quantity = decimalField("quantity", request.quantity(), 3,
                new BigDecimal("999999.999"), true);
        BigDecimal paidAmount = decimalField("paidAmount", request.paidAmount(), 2,
                new BigDecimal("999999999.99"), false);
        BigDecimal calculated = unitPrice.multiply(quantity).setScale(2, RoundingMode.HALF_UP);
        if (calculated.compareTo(new BigDecimal("999999999.99")) > 0) {
            throw fieldError("calculatedAmount", "计算金额超出允许范围。");
        }
        String digest = requestDigest(request, unitPrice, quantity, paidAmount, note);
        return tenantTransactions.execute(principal, () -> {
            repository.deleteExpiredIdempotency(key, now);
            if (!repository.insertIdempotency(key, digest, now, now.plus(IDEMPOTENCY_TTL))) {
                ExpenseRepository.IdempotencyRow existing = repository.lockIdempotency(key)
                        .orElseThrow(() -> new IllegalStateException("幂等键冲突后记录不存在"));
                if (!existing.digest().equals(digest)) {
                    throw new ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED",
                            "该幂等标识已用于不同内容。", false,
                            Map.of("idempotencyKey", List.of("请为新的填报生成新的幂等标识。")));
                }
                if ("SUCCEEDED".equals(existing.status()) && existing.resultReference() != null) {
                    UUID resultId = UUID.fromString(existing.resultReference());
                    return new CreationResult(repository.findExpense(resultId)
                            .orElseThrow(() -> new IllegalStateException("幂等结果账目不存在")), true);
                }
                throw new ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_IN_PROGRESS",
                        "相同填报正在处理中，请稍后重试。", true);
            }

            ExpenseReferences references = dictionaries.lockActiveReferences(request.productId(),
                    request.primaryCategoryId(), request.secondaryCategoryId(), request.unitId(),
                    request.fundingChannelId(), request.purchaseChannelId(), request.locationLabelId());
            validateReferences(request, references);
            UUID id = UUID.randomUUID();
            repository.insertExpense(id, request, references, unitPrice, quantity, paidAmount, calculated,
                    request.occurredAt().atZone(BUSINESS_ZONE).toLocalDate(), note, now);
            dictionaries.updateProductRecentValues(request.productId(), request.primaryCategoryId(),
                    request.secondaryCategoryId(), request.unitId(), unitPrice, quantity,
                    request.fundingChannelId(), request.purchaseChannelId(), now);
            repository.completeIdempotency(key, id, now);
            return new CreationResult(repository.findExpense(id).orElseThrow(), false);
        });
    }

    void undo(CurrentPrincipal principal, UUID expenseId, String requestedKey) {
        String key = validateIdempotencyKey(requestedKey);
        tenantTransactions.execute(principal, () -> {
            UUID productId = repository.deleteUndoableExpense(expenseId, key)
                    .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "EXPENSE_NOT_UNDOABLE",
                            "该支出不存在或已有后续关联，无法撤销本次保存。", false));
            repository.deleteResultIdempotency(expenseId);
            dictionaries.refreshProductRecentValues(productId, clock.instant());
            return null;
        });
    }

    private void validateReferences(CreateExpenseRequest request, ExpenseReferences references) {
        if (references.product() == null) throw fieldError("productId", "请选择当前可用的商品。");
        if (references.primaryCategory() == null) throw fieldError("primaryCategoryId", "请选择启用的一级分类。");
        if (request.secondaryCategoryId() != null && references.secondaryCategory() == null) {
            throw fieldError("secondaryCategoryId", "请选择属于该一级分类的启用二级分类。");
        }
        if (references.unit() == null) throw fieldError("unitId", "请选择启用的单位。");
        if (references.fundingChannel() == null) throw fieldError("fundingChannelId", "请选择启用的支付方式。");
        if (request.purchaseChannelId() != null && references.purchaseChannel() == null) {
            throw fieldError("purchaseChannelId", "请选择启用的购买渠道。");
        }
        if (request.locationLabelId() != null && references.locationLabel() == null) {
            throw fieldError("locationLabelId", "请选择启用的地点标签。");
        }
    }

    private void validateOccurredAt(Instant occurredAt, Instant now) {
        if (occurredAt != null && occurredAt.isAfter(now.plus(FUTURE_TOLERANCE))) {
            throw fieldError("occurredAt", "消费时间不能超过服务端当前时间 5 分钟。");
        }
    }

    private String normalizeNote(String value) {
        String note = value == null ? null : value.strip();
        if (note == null || note.isEmpty()) return null;
        if (note.codePointCount(0, note.length()) > 500) throw fieldError("note", "备注最多 500 个字符。");
        return note;
    }

    private String validateIdempotencyKey(String value) {
        String key = value == null ? "" : value.strip();
        if (key.isEmpty() || key.length() > 128) {
            throw fieldError("idempotencyKey", "幂等标识长度必须为 1-128 个字符。");
        }
        return key;
    }

    private String requestDigest(CreateExpenseRequest request, BigDecimal unitPrice, BigDecimal quantity,
                                 BigDecimal paidAmount, String note) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            Arrays.asList(request.productId(), request.primaryCategoryId(), request.secondaryCategoryId(), request.unitId(),
                    decimal(unitPrice), decimal(quantity), decimal(paidAmount),
                    request.fundingChannelId(), request.purchaseChannelId(), request.locationLabelId(),
                    request.occurredAt(), note).forEach(value -> appendDigest(digest, value));
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("运行环境缺少 SHA-256", exception);
        }
    }

    private void appendDigest(MessageDigest digest, Object value) {
        byte[] bytes = String.valueOf(value == null ? "<null>" : value).getBytes(StandardCharsets.UTF_8);
        digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
        digest.update(bytes);
    }

    private String decimal(BigDecimal value) {
        return value.stripTrailingZeros().toPlainString();
    }

    private BigDecimal decimalField(String field, String value, int scale, BigDecimal maximum, boolean positive) {
        if (value == null || !value.matches("^(0|[1-9]\\d*)(?:\\.\\d+)?$")) {
            throw fieldError(field, "请输入规范的非负十进制数。");
        }
        try {
            BigDecimal decimal = new BigDecimal(value);
            if (decimal.scale() > scale || decimal.compareTo(maximum) > 0
                    || (positive ? decimal.signum() <= 0 : decimal.signum() < 0)) {
                throw fieldError(field, "数值精度或范围无效。");
            }
            return decimal;
        } catch (NumberFormatException exception) {
            throw fieldError(field, "请输入规范的非负十进制数。");
        }
    }

    private ApiException fieldError(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, false,
                Map.of(field, List.of(message)));
    }

    private String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
