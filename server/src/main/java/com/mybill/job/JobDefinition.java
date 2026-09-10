package com.mybill.job;

/**
 * 有界批次任务契约。实现必须幂等；返回 more 后由执行器重新排队下一小批次。
 */
public interface JobDefinition {
    String jobType();
    JobScope scope();
    boolean cancellable();
    boolean retryable();
    default int maxAttempts() { return 3; }
    JobBatchResult executeBatch(JobExecutionContext context) throws Exception;

    /** 取消在批次完成后赢得竞态时，撤销该批次已产生但尚未对外生效的结果。 */
    default void onCancellationWon(JobExecutionContext context) throws Exception { }
}
