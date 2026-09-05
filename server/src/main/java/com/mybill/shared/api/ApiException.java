package com.mybill.shared.api;

import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;

/** 可安全映射到稳定外部错误合同的业务异常，不携带用户输入或内部异常细节。 */
public final class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final boolean retryable;
    private final Map<String, List<String>> fieldErrors;

    public ApiException(HttpStatus status, String code, String message, boolean retryable) {
        this(status, code, message, retryable, Map.of());
    }

    public ApiException(HttpStatus status, String code, String message, boolean retryable,
                        Map<String, List<String>> fieldErrors) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryable = retryable;
        this.fieldErrors = fieldErrors == null ? Map.of() : Map.copyOf(fieldErrors);
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public boolean retryable() {
        return retryable;
    }

    public Map<String, List<String>> fieldErrors() {
        return fieldErrors;
    }
}
