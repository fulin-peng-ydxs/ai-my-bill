package com.mybill.account;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;

/** 不可逆、带用途域的恢复重放指纹；不保存账号、用户名或租户标识。 */
final class AccountDeletionFingerprint {
    private AccountDeletionFingerprint() { }

    static String of(UUID userId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(("my-bill/account-deletion/v1/" + userId).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }
}
