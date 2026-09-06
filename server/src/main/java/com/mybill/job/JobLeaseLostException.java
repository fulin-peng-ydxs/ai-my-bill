package com.mybill.job;

final class JobLeaseLostException extends IllegalStateException {
    JobLeaseLostException() {
        super("任务租约已失效");
    }
}
