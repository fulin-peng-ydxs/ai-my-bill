package com.mybill.shared.logging;

import ch.qos.logback.classic.pattern.ThrowableProxyConverter;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;

/** Bounded diagnostic frames without exception messages, SQL values or suppressed payloads. */
public final class SafeThrowableConverter extends ThrowableProxyConverter {
    @Override
    public String convert(ILoggingEvent event) {
        StringBuilder result = new StringBuilder();
        IThrowableProxy proxy = event.getThrowableProxy();
        for (int depth = 0; proxy != null && depth < 8; depth++, proxy = proxy.getCause()) {
            result.append(depth == 0 ? "" : "Caused by: ").append(proxy.getClassName()).append('\n');
            var frames = proxy.getStackTraceElementProxyArray();
            if (frames != null) {
                for (int index = 0; index < Math.min(frames.length, 24); index++) {
                    result.append("\tat ").append(frames[index].getStackTraceElement()).append('\n');
                }
            }
        }
        return result.toString();
    }
}
