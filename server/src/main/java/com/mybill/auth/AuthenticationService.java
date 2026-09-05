package com.mybill.auth;

import com.mybill.auth.AuthRepository.AuthUser;
import com.mybill.auth.AuthRepository.SessionIdentity;
import com.mybill.shared.api.ApiException;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 认证、会话、限流和密码轮换的事务边界。 */
@Service
public class AuthenticationService {

    private static final String DUMMY_PASSWORD = "not-a-real-user-password";

    private final AuthRepository repository;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy passwordPolicy;
    private final SessionTokenService tokenService;
    private final AuthProperties properties;
    private final LoginRateLimiter loginRateLimiter;
    private final Clock clock;
    private final String dummyPasswordDigest;

    public AuthenticationService(AuthRepository repository, PasswordEncoder passwordEncoder,
                                 PasswordPolicy passwordPolicy, SessionTokenService tokenService,
                                 AuthProperties properties, LoginRateLimiter loginRateLimiter, Clock clock) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
        this.passwordPolicy = passwordPolicy;
        this.tokenService = tokenService;
        this.properties = properties;
        this.loginRateLimiter = loginRateLimiter;
        this.clock = clock;
        this.dummyPasswordDigest = passwordEncoder.encode(DUMMY_PASSWORD);
    }

    public AuthenticatedSession login(String username, String password) {
        Instant now = clock.instant();
        loginRateLimiter.assertAllowed(username);

        Optional<AuthUser> candidate = repository.findUserByUsername(username);
        String storedDigest = candidate.map(AuthUser::passwordDigest).orElse(dummyPasswordDigest);
        boolean passwordMatches = passwordEncoder.matches(password, storedDigest);
        if (candidate.isEmpty() || !passwordMatches) {
            loginRateLimiter.recordFailure(username);
            throw invalidCredentials();
        }

        AuthUser user = candidate.orElseThrow();
        if (!"ACTIVE".equals(user.status()) || (user.role() == CurrentPrincipal.Role.USER
                && (user.tenantId() == null || !"ACTIVE".equals(user.tenantStatus())))) {
            loginRateLimiter.recordFailure(username);
            throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_UNAVAILABLE",
                    "账号当前不可用，请联系管理员。", false);
        }
        if (user.temporaryPasswordExpiresAt() != null && !user.temporaryPasswordExpiresAt().isAfter(now)) {
            loginRateLimiter.recordFailure(username);
            throw new ApiException(HttpStatus.UNAUTHORIZED, "TEMPORARY_PASSWORD_EXPIRED",
                    "临时密码已过期，请联系管理员重置。", false);
        }

        loginRateLimiter.clear(username);
        return createSession(user, now);
    }

    @Transactional
    public Optional<CurrentPrincipal> authenticate(String rawToken) {
        if (rawToken == null || rawToken.isBlank() || rawToken.length() > 128) {
            return Optional.empty();
        }
        Instant now = clock.instant();
        Optional<SessionIdentity> result = repository.findSession(tokenService.digest(rawToken));
        if (result.isEmpty() || !isUsable(result.orElseThrow(), now)) {
            return Optional.empty();
        }
        SessionIdentity identity = result.orElseThrow();
        repository.touchSession(identity.sessionId(), identity.userId(), now);
        return Optional.of(toPrincipal(identity));
    }

    @Transactional
    public void logout(CurrentPrincipal principal) {
        repository.revokeSession(principal.sessionId(), clock.instant(), "LOGOUT");
    }

    @Transactional
    public AuthenticatedSession setFirstPassword(CurrentPrincipal principal, String newPassword) {
        AuthUser user = requireCurrentUser(principal);
        if (user.temporaryPasswordExpiresAt() == null) {
            throw new ApiException(HttpStatus.CONFLICT, "FIRST_PASSWORD_NOT_REQUIRED",
                    "当前账号不需要设置首次正式密码。", false);
        }
        if (!user.temporaryPasswordExpiresAt().isAfter(clock.instant())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "TEMPORARY_PASSWORD_EXPIRED",
                    "临时密码已过期，请联系管理员重置。", false);
        }
        return replacePasswordAndSession(user, newPassword, "FIRST_PASSWORD_CHANGED");
    }

    @Transactional
    public AuthenticatedSession changePassword(CurrentPrincipal principal, String currentPassword, String newPassword) {
        AuthUser user = requireCurrentUser(principal);
        if (user.temporaryPasswordExpiresAt() != null) {
            throw new ApiException(HttpStatus.CONFLICT, "PASSWORD_CHANGE_REQUIRED",
                    "请先设置首次正式密码。", false);
        }
        if (!passwordEncoder.matches(currentPassword, user.passwordDigest())) {
            throw invalidCredentials();
        }
        return replacePasswordAndSession(user, newPassword, "PASSWORD_CHANGED");
    }

    private AuthenticatedSession replacePasswordAndSession(AuthUser user, String newPassword, String reason) {
        passwordPolicy.validate(newPassword);
        if (passwordEncoder.matches(newPassword, user.passwordDigest())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_REUSE_NOT_ALLOWED",
                    "新密码不能与当前密码相同。", false);
        }
        Instant now = clock.instant();
        long newCredentialVersion = repository.replacePassword(
                user.id(), user.credentialVersion(), passwordEncoder.encode(newPassword), now);
        if (newCredentialVersion == 0) {
            throw new ApiException(HttpStatus.CONFLICT, "CREDENTIAL_VERSION_CONFLICT",
                    "账号凭据已发生变化，请重新登录。", false);
        }
        repository.revokeAllSessions(user.id(), now, reason);
        AuthUser updated = new AuthUser(user.id(), user.username(), "", null, user.role(), user.status(),
                user.tenantId(), newCredentialVersion, user.tenantStatus());
        return createSession(updated, now);
    }

    private AuthenticatedSession createSession(AuthUser user, Instant now) {
        SessionTokenService.IssuedToken token = tokenService.issue();
        UUID sessionId = UUID.randomUUID();
        repository.createSession(sessionId, user.id(), token.digest(), user.credentialVersion(),
                now.plus(properties.sessionDuration()), now);
        CurrentPrincipal principal = new CurrentPrincipal(sessionId, user.id(), user.tenantId(), user.credentialVersion(),
                user.username(), user.role(), user.temporaryPasswordExpiresAt() != null);
        return new AuthenticatedSession(token.rawToken(), principal);
    }

    private AuthUser requireCurrentUser(CurrentPrincipal principal) {
        return repository.findUserById(principal.userId())
                .filter(user -> user.credentialVersion() == principal.credentialVersion())
                .filter(user -> "ACTIVE".equals(user.status()))
                .filter(user -> user.role() == CurrentPrincipal.Role.ADMIN
                        || (user.tenantId() != null && "ACTIVE".equals(user.tenantStatus())))
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED",
                        "会话已失效，请重新登录。", false));
    }

    private boolean isUsable(SessionIdentity identity, Instant now) {
        return identity.revokedAt() == null
                && identity.expiresAt().isAfter(now)
                && identity.sessionCredentialVersion() == identity.userCredentialVersion()
                && "ACTIVE".equals(identity.userStatus())
                && (identity.role() == CurrentPrincipal.Role.ADMIN
                    || (identity.tenantId() != null && "ACTIVE".equals(identity.tenantStatus())));
    }

    private CurrentPrincipal toPrincipal(SessionIdentity identity) {
        return new CurrentPrincipal(identity.sessionId(), identity.userId(), identity.tenantId(),
                identity.userCredentialVersion(), identity.username(), identity.role(),
                identity.temporaryPasswordExpiresAt() != null);
    }

    private ApiException invalidCredentials() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS",
                "用户名或密码错误。", false);
    }

    public record AuthenticatedSession(String rawToken, CurrentPrincipal principal) { }
}
