package com.mybill.shared.api;

import org.springframework.http.HttpStatus;

/** 可安全映射到稳定外部错误合同的业务异常，不携带用户输入或内部异常细节。 */
public final class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final boolean retryable;

    public ApiException(HttpStatus status, String code, String message, boolean retryable) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryable = retryable;
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
}
