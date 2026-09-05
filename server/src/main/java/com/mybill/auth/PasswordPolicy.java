package com.mybill.auth;

import com.mybill.shared.api.ApiException;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/** 正式密码策略；使用离线拒绝表，避免向外部服务泄露用户候选密码。 */
@Component
public final class PasswordPolicy {

    private final Set<String> deniedPasswords;

    public PasswordPolicy() {
        this.deniedPasswords = loadDeniedPasswords();
    }

    public void validate(String password) {
        int codePoints = password == null ? 0 : password.codePointCount(0, password.length());
        if (codePoints < 15 || codePoints > 64) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_POLICY_VIOLATION",
                    "正式密码长度必须为 15-64 个字符。", false);
        }
        String normalized = Normalizer.normalize(password, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        if (deniedPasswords.contains(normalized)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_POLICY_VIOLATION",
                    "该密码过于常见或已出现在泄露密码库中，请更换。", false);
        }
    }

    private Set<String> loadDeniedPasswords() {
        ClassPathResource resource = new ClassPathResource("auth/common-passwords.txt");
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                resource.getInputStream(), StandardCharsets.UTF_8))) {
            return reader.lines()
                    .map(String::trim)
                    .filter(line -> !line.isEmpty() && !line.startsWith("#"))
                    .map(line -> Normalizer.normalize(line, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT))
                    .collect(Collectors.toUnmodifiableSet());
        } catch (IOException exception) {
            throw new IllegalStateException("无法加载离线弱密码拒绝表", exception);
        }
    }
}
