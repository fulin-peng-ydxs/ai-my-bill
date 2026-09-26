package com.mybill.shared.time;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;

/** 上海业务日期范围的共享解析契约，供明细、导出和报表保持同一边界。 */
public enum BusinessDateRange {
    TODAY, THIS_WEEK, THIS_MONTH, LAST_MONTH, THIS_YEAR, CUSTOM;
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");

    public Bounds resolve(Clock clock, LocalDate customStart, LocalDate customEnd) {
        LocalDate today = LocalDate.now(clock.withZone(BUSINESS_ZONE));
        return switch (this) {
            case TODAY -> new Bounds(today, today);
            case THIS_WEEK -> new Bounds(today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)), today);
            case THIS_MONTH -> new Bounds(today.withDayOfMonth(1), today);
            case LAST_MONTH -> {
                YearMonth month = YearMonth.from(today).minusMonths(1);
                yield new Bounds(month.atDay(1), month.atEndOfMonth());
            }
            case THIS_YEAR -> new Bounds(today.withDayOfYear(1), today);
            case CUSTOM -> {
                if (customStart == null || customEnd == null || customEnd.isBefore(customStart)) {
                    throw new IllegalArgumentException("invalid custom business date range");
                }
                yield new Bounds(customStart, customEnd);
            }
        };
    }

    public record Bounds(LocalDate start, LocalDate end) { }
}
