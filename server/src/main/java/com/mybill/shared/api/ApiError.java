package com.mybill.shared.api;

import java.util.List;
import java.util.Map;

/**
 * 所有业务 API 失败响应的稳定外部合同。
 *
 * @param code        可供客户端分支处理的稳定错误码
 * @param message     可安全展示给当前用户的错误说明
 * @param fieldErrors 按字段聚合的校验信息，不包含提交值
 * @param traceId     用于服务端日志定位的安全追踪标识
 * @param retryable   当前请求在不修改输入时是否适合重试
 */
public record ApiError(
        String code,
        String message,
        Map<String, List<String>> fieldErrors,
        String traceId,
        boolean retryable
) {
}
