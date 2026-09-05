package com.mybill.admin.user;

import org.springframework.stereotype.Component;

import java.security.SecureRandom;

/** 生成仅在创建或重置成功响应中出现一次的高熵 16 位临时密码。 */
@Component
final class TemporaryPasswordGenerator {
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    private static final int LENGTH = 16;
    private final SecureRandom random = new SecureRandom();

    String generate() {
        StringBuilder password = new StringBuilder(LENGTH);
        for (int index = 0; index < LENGTH; index++) {
            password.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return password.toString();
    }
}
