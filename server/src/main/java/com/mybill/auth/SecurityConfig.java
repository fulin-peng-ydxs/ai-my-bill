package com.mybill.auth;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;

import java.time.Clock;

/** 默认拒绝的同源 Cookie 安全链；公开面仅登录和最小健康探针。 */
@Configuration
@EnableConfigurationProperties(AuthProperties.class)
public class SecurityConfig {

    @Bean
    PasswordEncoder passwordEncoder(AuthProperties properties) {
        return new BCryptPasswordEncoder(properties.bcryptStrength());
    }

    @Bean
    Clock authClock() {
        return Clock.systemUTC();
    }

    @Bean
    RateLimitSubjectHasher rateLimitSubjectHasher(AuthProperties properties) {
        return new RateLimitSubjectHasher(properties);
    }

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            SessionAuthenticationFilter sessionAuthenticationFilter,
            PasswordChangeRequiredFilter passwordChangeRequiredFilter,
            CsrfCookieFilter csrfCookieFilter,
            SecurityErrorWriter errorWriter,
            AuthProperties properties
    ) throws Exception {
        CookieCsrfTokenRepository csrfRepository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrfRepository.setCookiePath("/");
        csrfRepository.setCookieCustomizer(builder -> builder
                .secure(properties.secureCookie())
                .sameSite("Lax"));
        CsrfTokenRequestAttributeHandler csrfRequestHandler = new CsrfTokenRequestAttributeHandler();

        http
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
                        // 身份每次都从不透明 Cookie 恢复，不得把每个请求误判为新登录并清除 CSRF Cookie。
                        .sessionAuthenticationStrategy((authentication, request, response) -> { }))
                .requestCache(cache -> cache.disable())
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable())
                .csrf(csrf -> csrf
                        .csrfTokenRepository(csrfRepository)
                        .csrfTokenRequestHandler(csrfRequestHandler)
                        // 自定义无状态 Cookie 认证不经过登录过滤器，不能在每个已认证请求上清除令牌。
                        .sessionAuthenticationStrategy((authentication, request, response) -> { }))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(HttpMethod.GET, "/api/v1/health").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/login").permitAll()
                        .requestMatchers("/api/v1/auth/**").authenticated()
                        .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
                        .requestMatchers("/api/v1/dictionaries/**").hasRole("USER")
                        .requestMatchers("/api/v1/preferences/**").hasRole("USER")
                        .requestMatchers("/api/v1/expenses/**").hasRole("USER")
                        .requestMatchers("/api/v1/**").denyAll()
                        .anyRequest().permitAll())
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, exception) -> errorWriter.write(
                                response, HttpServletResponseCodes.UNAUTHORIZED,
                                "UNAUTHORIZED", "会话已失效，请重新登录。", false))
                        .accessDeniedHandler((request, response, exception) -> {
                            String code = exception.getClass().getSimpleName().contains("Csrf")
                                    ? "CSRF_INVALID" : "FORBIDDEN";
                            String message = "CSRF_INVALID".equals(code)
                                    ? "请求安全校验失败，请刷新后重试。" : "无权执行该操作。";
                            errorWriter.write(response, HttpServletResponseCodes.FORBIDDEN, code, message, false);
                        }))
                .addFilterBefore(sessionAuthenticationFilter, AnonymousAuthenticationFilter.class)
                .addFilterAfter(csrfCookieFilter, SessionAuthenticationFilter.class)
                .addFilterBefore(passwordChangeRequiredFilter, AuthorizationFilter.class);
        return http.build();
    }

    /** 避免在安全配置中散落 servlet 常量依赖。 */
    private static final class HttpServletResponseCodes {
        private static final int UNAUTHORIZED = 401;
        private static final int FORBIDDEN = 403;

        private HttpServletResponseCodes() { }
    }
}
