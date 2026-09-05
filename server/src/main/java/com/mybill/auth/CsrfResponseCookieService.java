package com.mybill.auth;

import org.springframework.http.ResponseCookie;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.stereotype.Component;

/** 会话建立或轮换后显式保留 SPA 下一次变更请求所需的 CSRF Cookie。 */
@Component
final class CsrfResponseCookieService {
    private final AuthProperties properties;

    CsrfResponseCookieService(AuthProperties properties) {
        this.properties = properties;
    }

    ResponseCookie create(CsrfToken token) {
        return ResponseCookie.from("XSRF-TOKEN", token.getToken())
                .httpOnly(false)
                .secure(properties.secureCookie())
                .sameSite("Lax")
                .path("/")
                .build();
    }
}
