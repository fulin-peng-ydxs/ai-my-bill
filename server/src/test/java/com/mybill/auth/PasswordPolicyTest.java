package com.mybill.auth;

import com.mybill.shared.api.ApiException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PasswordPolicyTest {

    private final PasswordPolicy policy = new PasswordPolicy();

    @Test
    void validatesUnicodeCodePointsAndOfflineDeniedPasswords() {
        assertThatThrownBy(() -> policy.validate("short-password"))
                .isInstanceOf(ApiException.class)
                .extracting("code")
                .isEqualTo("PASSWORD_POLICY_VIOLATION");
        assertThatThrownBy(() -> policy.validate("PasswordPassword"))
                .isInstanceOf(ApiException.class)
                .extracting("code")
                .isEqualTo("PASSWORD_POLICY_VIOLATION");
        assertThatThrownBy(() -> policy.validate("a".repeat(65)))
                .isInstanceOf(ApiException.class);
        assertThatCode(() -> policy.validate("安全密码-For-MyBill-2026"))
                .doesNotThrowAnyException();
    }
}
