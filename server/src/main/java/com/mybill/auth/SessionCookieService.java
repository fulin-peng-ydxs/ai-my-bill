package com.mybill.auth;

import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/** 统一生成会话 Cookie，避免认证端点各自漂移安全属性。 */
@Component
final class SessionCookieService {

    private final AuthProperties properties;

    SessionCookieService(AuthProperties properties) {
        this.properties = properties;
    }

    ResponseCookie create(String rawToken) {
        return base(rawToken)
                .maxAge(properties.sessionDuration())
                .build();
    }

    ResponseCookie clear() {
        return base("")
                .maxAge(0)
                .build();
    }

    String cookieName() {
        return properties.sessionCookieName();
    }

    private ResponseCookie.ResponseCookieBuilder base(String value) {
        return ResponseCookie.from(properties.sessionCookieName(), value)
                .httpOnly(true)
                .secure(properties.secureCookie())
                .sameSite("Lax")
                .path("/");
    }
}
