package com.mybill.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Set;

/** 临时密码会话只允许读取会话、退出和设置正式密码，避免绕过首次改密门禁。 */
@Component
final class PasswordChangeRequiredFilter extends OncePerRequestFilter {

    private static final Set<String> ALLOWED_PATHS = Set.of(
            "/api/v1/health",
            "/api/v1/auth/session",
            "/api/v1/auth/logout",
            "/api/v1/auth/first-password"
    );

    private final SecurityErrorWriter errorWriter;

    PasswordChangeRequiredFilter(SecurityErrorWriter errorWriter) {
        this.errorWriter = errorWriter;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof CurrentPrincipal principal
                && principal.passwordChangeRequired() && !ALLOWED_PATHS.contains(request.getRequestURI())) {
            errorWriter.write(response, HttpServletResponse.SC_FORBIDDEN,
                    "PASSWORD_CHANGE_REQUIRED", "请先设置正式密码。", false);
            return;
        }
        filterChain.doFilter(request, response);
    }
}
