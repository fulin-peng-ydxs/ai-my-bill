package com.mybill.ledger;

import com.mybill.job.JobExecutionContext;
import com.mybill.ledger.ExportContracts.ExportSnapshot;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Component;

import java.io.BufferedWriter;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicLong;

@Component
class ExportCsvWriter {
    private static final int FETCH_SIZE = 200;
    private static final String[] COLUMNS = {
            "record_id", "record_type", "adjustment_type", "related_ledger_id", "related_ledger_title", "record_status",
            "business_time", "business_date", "product_name_snapshot", "income_name", "payer_name_snapshot",
            "primary_category_name_snapshot", "secondary_category_name_snapshot", "income_category_name_snapshot",
            "unit_name_snapshot", "unit_price", "quantity", "calculated_amount", "paid_amount", "income_amount",
            "adjustment_amount", "funding_channel_name_snapshot", "purchase_channel_name_snapshot",
            "location_label_name_snapshot", "note", "product_id", "payer_id", "primary_category_id",
            "secondary_category_id", "income_category_id", "unit_id", "funding_channel_reference",
            "purchase_channel_id", "location_label_id", "version", "created_at", "updated_at", "deleted_at", "purge_after"
    };
    private static final String[] HEADERS = {
            "记录ID", "记录类型", "调整类型", "关联账目ID", "关联账目名称", "状态", "业务时间", "业务日期",
            "商品名称", "收入名称", "付款方", "支出一级分类", "支出二级分类", "收入分类", "单位", "单价", "数量",
            "计算金额", "实付金额", "收入金额", "调整金额", "资金渠道", "购买渠道", "地点", "备注", "商品ID", "付款方ID",
            "支出一级分类ID", "支出二级分类ID", "收入分类ID", "单位ID", "资金渠道ID", "购买渠道ID", "地点ID",
            "版本", "创建时间", "更新时间", "删除时间", "清理时间"
    };

    private final MybatisOperations operations;
    private final ExportCsvWriterMapper mapper;

    ExportCsvWriter(MybatisOperations operations, ExportCsvWriterMapper mapper) {
        this.operations = operations;
        this.mapper = mapper;
    }

    long write(ExportSnapshot snapshot, BufferedWriter writer, JobExecutionContext context) throws IOException {
        writer.write('\uFEFF');
        writeRow(writer, HEADERS);
        AtomicLong count = new AtomicLong();
        try {
            operations.cursor(mapper::stream).param("filtered", snapshot.scope() == ExportContracts.ExportScope.CURRENT_FILTERS)
                    .param("startDate", snapshot.startDate()).param("endDate", snapshot.endDate())
                    .param("active", snapshot.lifecycle() == LedgerQueryContracts.LifecycleFilter.ACTIVE)
                    .param("entryType", snapshot.type() == LedgerQueryContracts.EntryTypeFilter.ALL
                            || snapshot.type() == LedgerQueryContracts.EntryTypeFilter.EXPENSE_FLOW ? null : snapshot.type().name())
                    .param("expenseFlow", snapshot.type() == LedgerQueryContracts.EntryTypeFilter.EXPENSE_FLOW)
                    .param("fundingId", snapshot.fundingChannelId())
                    .param("keyword", snapshot.query().isEmpty() ? null : "%" + escapeLike(snapshot.query()) + "%")
                    .forEach(row -> {
                        long number = count.incrementAndGet();
                        if (number % FETCH_SIZE == 0) {
                            context.heartbeat();
                            if (context.shouldCancel()) throw new ExportCancelledException();
                        }
                        String[] values = new String[COLUMNS.length];
                        for (int index = 0; index < COLUMNS.length; index++) values[index] = row.getString(COLUMNS[index]);
                        try { writeRow(writer, values); }
                        catch (IOException failure) { throw new CsvWriteException(failure); }
                    });
        } catch (CsvWriteException failure) {
            throw failure.cause;
        }
        if (context.shouldCancel()) throw new ExportCancelledException();
        writer.flush();
        return count.get();
    }

    static String safeText(String value) {
        if (value == null || value.isEmpty()) return "";
        int firstIndex = 0;
        while (firstIndex < value.length() && Character.isWhitespace(value.charAt(firstIndex))) firstIndex++;
        if (firstIndex == value.length()) return value;
        char first = value.charAt(firstIndex);
        return first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r'
                ? "'" + value : value;
    }

    private static void writeRow(BufferedWriter writer, String[] values) throws IOException {
        for (int index = 0; index < values.length; index++) {
            if (index > 0) writer.write(',');
            writer.write('"');
            writer.write(safeText(values[index]).replace("\"", "\"\""));
            writer.write('"');
        }
        writer.write("\r\n");
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    static final class ExportCancelledException extends RuntimeException { }
    private static final class CsvWriteException extends RuntimeException {
        private final IOException cause;
        CsvWriteException(IOException cause) { super(cause); this.cause = cause; }
    }
}
