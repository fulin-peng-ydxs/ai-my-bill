package com.mybill.account;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** 在后台任务开始轮询前收敛上一次进程中断的导出文件隔离状态。 */
@Component
@Order(110)
final class AccountDeletionFileStartupRecovery implements ApplicationRunner {
    private final AccountDeletionFileRecovery recovery;

    AccountDeletionFileStartupRecovery(AccountDeletionFileRecovery recovery) { this.recovery = recovery; }

    @Override public void run(ApplicationArguments args) { recovery.recover(); }
}
