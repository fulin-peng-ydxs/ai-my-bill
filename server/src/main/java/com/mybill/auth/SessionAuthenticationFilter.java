package com.mybill.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.Optional;

/** 从 HttpOnly Cookie 恢复服务端会话；存储异常时默认拒绝，不降级为匿名身份。 */
@Component
final class SessionAuthenticationFilter extends OncePerRequestFilter {

    private final AuthenticationService authenticationService;
    private final SessionCookieService cookieService;
    private final SecurityErrorWriter errorWriter;

    SessionAuthenticationFilter(AuthenticationService authenticationService, SessionCookieService cookieService,
                                SecurityErrorWriter errorWriter) {
        this.authenticationService = authenticationService;
        this.cookieService = cookieService;
        this.errorWriter = errorWriter;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        Optional<String> rawToken = sessionCookie(request);
        if (rawToken.isEmpty()) {
            filterChain.doFilter(request, response);
            return;
        }
        try {
            Optional<CurrentPrincipal> principal = authenticationService.authenticate(rawToken.orElseThrow());
            if (principal.isEmpty()) {
                response.addHeader(HttpHeaders.SET_COOKIE, cookieService.clear().toString());
                filterChain.doFilter(request, response);
                return;
            }
            CurrentPrincipal current = principal.orElseThrow();
            UsernamePasswordAuthenticationToken authentication = UsernamePasswordAuthenticationToken.authenticated(
                    current,
                    null,
                    java.util.List.of(new SimpleGrantedAuthority("ROLE_" + current.role().name()))
            );
            SecurityContextHolder.getContext().setAuthentication(authentication);
            filterChain.doFilter(request, response);
        } catch (DataAccessException exception) {
            errorWriter.write(response, HttpServletResponse.SC_SERVICE_UNAVAILABLE,
                    "AUTH_STORAGE_UNAVAILABLE", "认证服务暂时不可用，请稍后重试。", true);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    private Optional<String> sessionCookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return Optional.empty();
        }
        return Arrays.stream(cookies)
                .filter(cookie -> cookieService.cookieName().equals(cookie.getName()))
                .map(Cookie::getValue)
                .filter(value -> value != null && !value.isBlank())
                .findFirst();
    }
}
