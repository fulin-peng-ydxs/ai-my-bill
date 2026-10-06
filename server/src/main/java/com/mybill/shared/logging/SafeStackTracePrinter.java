package com.mybill.shared.logging;

import java.io.IOException;
import org.springframework.boot.logging.StackTracePrinter;

/** Equivalent privacy boundary for Boot's single-line structured production logs. */
public final class SafeStackTracePrinter implements StackTracePrinter {
    @Override
    public void printStackTrace(Throwable throwable, Appendable output) throws IOException {
        for (int depth = 0; throwable != null && depth < 8; depth++, throwable = throwable.getCause()) {
            output.append(depth == 0 ? "" : "Caused by: ").append(throwable.getClass().getName()).append('\n');
            StackTraceElement[] frames = throwable.getStackTrace();
            for (int index = 0; index < Math.min(frames.length, 24); index++) {
                output.append("\tat ").append(frames[index].toString()).append('\n');
            }
        }
    }
}
