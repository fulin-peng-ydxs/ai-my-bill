package com.mybill.auth;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.util.HexFormat;

/** 使用服务端 pepper 隐藏限流主体，数据库泄露时不能直接枚举用户名摘要。 */
final class RateLimitSubjectHasher {

    private final byte[] pepper;

    RateLimitSubjectHasher(AuthProperties properties) {
        String value = properties.rateLimitPepperFile().isBlank()
                ? properties.rateLimitPepper()
                : readPepper(Path.of(properties.rateLimitPepperFile()));
        if (value == null || value.length() < 16) {
            throw new IllegalArgumentException("认证限流 pepper 至少需要 16 个字符");
        }
        this.pepper = value.getBytes(StandardCharsets.UTF_8);
    }

    String digest(String username) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(pepper, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(username.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("运行环境缺少 HMAC-SHA256", exception);
        }
    }

    private String readPepper(Path path) {
        try {
            return Files.readString(path, StandardCharsets.UTF_8).stripTrailing();
        } catch (IOException exception) {
            throw new IllegalStateException("认证限流 pepper secret 不可读", exception);
        }
    }
}
