package com.mybill.shared.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 将未分类异常收敛为安全、稳定的 API 错误，避免向客户端泄漏堆栈或内部数据。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiError> handleApiException(ApiException exception) {
        ApiError error = new ApiError(
                exception.code(),
                exception.getMessage(),
                exception.fieldErrors(),
                traceId(),
                exception.retryable()
        );
        return ResponseEntity.status(exception.status()).body(error);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiError> handleNotFound(NoResourceFoundException exception) {
        ApiError error = new ApiError(
                "NOT_FOUND",
                "请求的资源不存在。",
                Map.of(),
                traceId(),
                false
        );
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException exception) {
        Map<String, List<String>> fieldErrors = new LinkedHashMap<>();
        exception.getBindingResult().getFieldErrors().forEach(fieldError ->
                fieldErrors.computeIfAbsent(fieldError.getField(), ignored -> new java.util.ArrayList<>())
                        .add(fieldError.getDefaultMessage() == null ? "字段无效" : fieldError.getDefaultMessage())
        );
        ApiError error = new ApiError(
                "VALIDATION_FAILED",
                "请检查输入内容。",
                fieldErrors,
                traceId(),
                false
        );
        return ResponseEntity.badRequest().body(error);
    }

    @ExceptionHandler({ConstraintViolationException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<ApiError> handleRequestParameterValidation(Exception exception) {
        String field = exception instanceof MethodArgumentTypeMismatchException mismatch
                ? mismatch.getName() : "query";
        ApiError error = new ApiError(
                "VALIDATION_FAILED",
                "请检查查询参数。",
                Map.of(field, List.of("参数无效")),
                traceId(),
                false
        );
        return ResponseEntity.badRequest().body(error);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> handleUnreadableRequest(HttpMessageNotReadableException exception) {
        ApiError error = new ApiError(
                "INVALID_REQUEST",
                "请求内容格式无效。",
                Map.of(),
                traceId(),
                false
        );
        return ResponseEntity.badRequest().body(error);
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<ApiError> handleDatabaseUnavailable(DataAccessException exception, HttpServletRequest request) {
        String traceId = traceId();
        log.error("Database unavailable traceId={} method={} path={}",
                traceId, request.getMethod(), request.getRequestURI(), exception);
        boolean authenticationPath = request.getRequestURI().startsWith("/api/v1/auth/");
        ApiError error = new ApiError(
                authenticationPath ? "AUTH_STORAGE_UNAVAILABLE" : "STORAGE_UNAVAILABLE",
                authenticationPath ? "认证服务暂时不可用，请稍后重试。" : "数据服务暂时不可用，请稍后重试。",
                Map.of(),
                traceId,
                true
        );
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(error);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception exception, HttpServletRequest request) {
        String traceId = traceId();
        log.error("Unhandled API error traceId={} method={} path={}",
                traceId, request.getMethod(), request.getRequestURI(), exception);

        ApiError error = new ApiError(
                "INTERNAL_ERROR",
                "服务暂时不可用，请稍后重试。",
                Map.of(),
                traceId,
                true
        );
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }

    private String traceId() {
        String mdcTraceId = MDC.get("traceId");
        return mdcTraceId == null || mdcTraceId.isBlank() ? UUID.randomUUID().toString() : mdcTraceId;
    }
}
