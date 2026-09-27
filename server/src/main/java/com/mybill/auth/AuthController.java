package com.mybill.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** T3 认证接口；响应只返回当前账号最小身份，不返回租户标识或会话令牌。 */
@RestController
@RequestMapping("/api/v1/auth")
final class AuthController {

    private final AuthenticationService authenticationService;
    private final SessionCookieService cookieService;
    private final CsrfResponseCookieService csrfCookieService;

    AuthController(AuthenticationService authenticationService, SessionCookieService cookieService,
                   CsrfResponseCookieService csrfCookieService) {
        this.authenticationService = authenticationService;
        this.cookieService = cookieService;
        this.csrfCookieService = csrfCookieService;
    }

    @PostMapping("/login")
    ResponseEntity<SessionResponse> login(@Valid @RequestBody LoginRequest request, CsrfToken csrfToken,
                                          HttpServletRequest servletRequest) {
        AuthenticationService.AuthenticatedSession session = authenticationService.login(
                servletRequest.getRemoteAddr(), request.username(), request.password());
        return withSessionCookie(session, csrfToken);
    }

    @GetMapping("/session")
    SessionResponse session(@AuthenticationPrincipal CurrentPrincipal principal) {
        return SessionResponse.from(principal);
    }

    @PostMapping("/logout")
    ResponseEntity<Void> logout(@AuthenticationPrincipal CurrentPrincipal principal) {
        authenticationService.logout(principal);
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, cookieService.clear().toString())
                .build();
    }

    @PostMapping("/first-password")
    ResponseEntity<SessionResponse> firstPassword(@AuthenticationPrincipal CurrentPrincipal principal,
                                                  @Valid @RequestBody FirstPasswordRequest request,
                                                  CsrfToken csrfToken) {
        return withSessionCookie(authenticationService.setFirstPassword(principal, request.newPassword()), csrfToken);
    }

    @PostMapping("/password")
    ResponseEntity<SessionResponse> password(@AuthenticationPrincipal CurrentPrincipal principal,
                                             @Valid @RequestBody PasswordChangeRequest request,
                                             CsrfToken csrfToken) {
        return withSessionCookie(authenticationService.changePassword(
                principal, request.currentPassword(), request.newPassword()), csrfToken);
    }

    private ResponseEntity<SessionResponse> withSessionCookie(AuthenticationService.AuthenticatedSession session,
                                                              CsrfToken csrfToken) {
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE,
                        cookieService.create(session.rawToken()).toString(),
                        csrfCookieService.create(csrfToken).toString())
                .body(SessionResponse.from(session.principal()));
    }
}
