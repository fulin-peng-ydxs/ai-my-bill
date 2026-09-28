package com.mybill.auth;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** 空库首次账号初始化：凭据只读 secret 文件，串行事务避免并发创建多个管理员。 */
@Component
@Profile("bootstrap")
@Order(10)
public final class InitialAdminBootstrap implements ApplicationRunner {
    private final InitialAdminMapper mapper;
    private final TransactionTemplate transaction;
    private final PasswordEncoder encoder;
    private final PasswordPolicy policy;
    private final Environment environment;
    private final Clock clock;

    public InitialAdminBootstrap(InitialAdminMapper mapper, TransactionTemplate transaction,
            PasswordEncoder encoder, PasswordPolicy policy, Environment environment, Clock clock) {
        this.mapper = mapper;
        this.transaction = transaction;
        this.encoder = encoder;
        this.policy = policy;
        this.environment = environment;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        String username = environment.getRequiredProperty("MY_BILL_BOOTSTRAP_USERNAME");
        if (!username.matches("[!-~]{3,64}")) {
            throw new IllegalArgumentException("初始化账号格式无效");
        }
        Path file = Path.of(environment.getRequiredProperty("MY_BILL_BOOTSTRAP_PASSWORD_FILE"));
        if (Files.size(file) > 1024) throw new IllegalArgumentException("初始化凭据文件过大");
        String password = Files.readString(file).stripTrailing();
        policy.validate(password);
        String digest = encoder.encode(password);
        transaction.executeWithoutResult(status -> {
            mapper.lockAccounts();
            if (mapper.countAccounts() != 0) {
                throw new IllegalStateException("数据库已有账号，拒绝再次初始化或覆盖凭据");
            }
            UUID id = UUID.randomUUID();
            if (mapper.insert(id, username, digest, clock.instant().plus(Duration.ofHours(24))) != 1
                    || mapper.audit(UUID.randomUUID(), id) != 1) {
                throw new IllegalStateException("首管理员初始化失败");
            }
        });
    }
}
