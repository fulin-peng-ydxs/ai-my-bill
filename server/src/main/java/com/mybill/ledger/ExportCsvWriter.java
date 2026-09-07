package com.mybill.ledger;

import com.mybill.job.JobExecutionContext;
import com.mybill.ledger.ExportContracts.ExportSnapshot;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;

import java.io.BufferedWriter;
import java.io.IOException;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

@Component
class ExportCsvWriter {
    private static final int FETCH_SIZE = 200;
    private static final String[] HEADERS = {
            "记录ID", "记录类型", "调整类型", "关联账目ID", "关联账目名称", "状态", "业务时间", "业务日期",
            "商品名称", "收入名称", "付款方", "支出一级分类", "支出二级分类", "收入分类", "单位", "单价", "数量",
            "计算金额", "实付金额", "收入金额", "调整金额", "资金渠道", "购买渠道", "地点", "备注", "商品ID", "付款方ID",
            "支出一级分类ID", "支出二级分类ID", "收入分类ID", "单位ID", "资金渠道ID", "购买渠道ID", "地点ID",
            "版本", "创建时间", "更新时间", "删除时间", "清理时间"
    };

    private final ObjectProvider<DataSource> dataSources;

    ExportCsvWriter(ObjectProvider<DataSource> dataSources) { this.dataSources = dataSources; }

    long write(ExportSnapshot snapshot, BufferedWriter writer, JobExecutionContext context) throws IOException {
        writer.write('\uFEFF');
        writeRow(writer, HEADERS);
        SqlQuery query = sql(snapshot);
        AtomicLong count = new AtomicLong();
        try {
            new JdbcTemplate(dataSources.getObject()).query(connection -> {
                PreparedStatement statement = connection.prepareStatement(query.sql());
                statement.setFetchSize(FETCH_SIZE);
                for (int index = 0; index < query.parameters().size(); index++) {
                    statement.setObject(index + 1, query.parameters().get(index));
                }
                return statement;
            }, result -> {
                long row = count.incrementAndGet();
                if (row % FETCH_SIZE == 0) {
                    context.heartbeat();
                    if (context.shouldCancel()) throw new ExportCancelledException();
                }
                String[] values = new String[HEADERS.length];
                for (int column = 0; column < values.length; column++) values[column] = result.getString(column + 1);
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

    private static SqlQuery sql(ExportSnapshot snapshot) {
        StringBuilder sql = new StringBuilder("""
                WITH export_rows AS (
                  SELECT l.id::text AS record_id,l.entry_type AS record_type,NULL::text AS adjustment_type,
                    NULL::text AS related_ledger_id,NULL::text AS related_ledger_title,l.lifecycle_status AS record_status,
                    to_char(l.business_time AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') || '+08:00' AS business_time,
                    l.business_date::text,l.product_name_snapshot,l.income_name,l.payer_name_snapshot,
                    l.primary_category_name_snapshot,l.secondary_category_name_snapshot,l.income_category_name_snapshot,
                    l.unit_name_snapshot,l.unit_price::text,l.quantity::text,l.calculated_amount::text,l.paid_amount::text,
                    l.income_amount::text,NULL::text AS adjustment_amount,l.funding_channel_name_snapshot,
                    l.purchase_channel_name_snapshot,l.location_label_name_snapshot,l.note,l.product_id::text,l.payer_id::text,
                    l.primary_category_id::text,l.secondary_category_id::text,l.income_category_id::text,l.unit_id::text,
                    l.funding_channel_id::text AS funding_channel_reference,l.purchase_channel_id::text,l.location_label_id::text,l.version::text,
                    to_char(l.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') || '+08:00' AS created_at,
                    to_char(l.updated_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') || '+08:00' AS updated_at,
                    to_char(l.deleted_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') || '+08:00' AS deleted_at,
                    to_char(l.purge_after AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') || '+08:00' AS purge_after,
                    l.funding_channel_id AS filter_funding_channel_id,
                    concat_ws(' ',l.product_name_snapshot,l.primary_category_name_snapshot,l.secondary_category_name_snapshot,
                      l.income_name,l.payer_name_snapshot,l.income_category_name_snapshot,l.funding_channel_name_snapshot,
                      l.purchase_channel_name_snapshot,l.location_label_name_snapshot,l.note) AS search_text
                  FROM ledger_entry l
                  WHERE l.tenant_id=current_setting('app.tenant_id')::uuid
                  UNION ALL
                  SELECT a.id::text,'ADJUSTMENT',a.adjustment_type,a.original_expense_id::text,
                    CASE WHEN l.entry_type='EXPENSE' THEN l.product_name_snapshot ELSE l.income_name END,a.status,
                    to_char(a.business_time AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') || '+08:00',
                    a.business_date::text,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
                    a.amount::text,NULL,NULL,NULL,a.note,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,a.version::text,
                    to_char(a.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') || '+08:00',
                    to_char(a.updated_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') || '+08:00',
                    to_char(a.deleted_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') || '+08:00',
                    to_char(a.purge_after AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') || '+08:00',
                    l.funding_channel_id AS filter_funding_channel_id,
                    concat_ws(' ',l.product_name_snapshot,l.primary_category_name_snapshot,l.secondary_category_name_snapshot,
                      l.funding_channel_name_snapshot,a.note,CASE a.adjustment_type WHEN 'REFUND' THEN '退款' ELSE '报销' END) AS search_text
                  FROM expense_adjustment a JOIN ledger_entry l
                    ON l.tenant_id=a.tenant_id AND l.id=a.original_expense_id
                  WHERE a.tenant_id=current_setting('app.tenant_id')::uuid
                )
                SELECT record_id,record_type,adjustment_type,related_ledger_id,related_ledger_title,record_status,
                  business_time,business_date,product_name_snapshot,income_name,payer_name_snapshot,
                  primary_category_name_snapshot,secondary_category_name_snapshot,income_category_name_snapshot,
                  unit_name_snapshot,unit_price,quantity,calculated_amount,paid_amount,income_amount,adjustment_amount,
                  funding_channel_name_snapshot,purchase_channel_name_snapshot,location_label_name_snapshot,note,
                  product_id,payer_id,primary_category_id,secondary_category_id,income_category_id,unit_id,
                  funding_channel_reference,purchase_channel_id,location_label_id,version,created_at,updated_at,deleted_at,purge_after
                FROM export_rows WHERE 1=1
                """);
        List<Object> parameters = new ArrayList<>();
        if (snapshot.scope() == ExportContracts.ExportScope.CURRENT_FILTERS) {
            sql.append(" AND business_date::date BETWEEN ? AND ?");
            parameters.add(snapshot.startDate()); parameters.add(snapshot.endDate());
            if (snapshot.lifecycle() == LedgerQueryContracts.LifecycleFilter.ACTIVE) {
                sql.append(" AND ((record_type IN ('EXPENSE','INCOME') AND record_status='ACTIVE') OR (record_type='ADJUSTMENT' AND record_status='EFFECTIVE'))");
            } else {
                sql.append(" AND ((record_type IN ('EXPENSE','INCOME') AND record_status='TRASHED') OR (record_type='ADJUSTMENT' AND record_status='TRASHED'))");
            }
            if (snapshot.type() != LedgerQueryContracts.EntryTypeFilter.ALL) {
                sql.append(" AND record_type=?"); parameters.add(snapshot.type().name());
            }
            if (snapshot.fundingChannelId() != null) {
                sql.append(" AND filter_funding_channel_id=?"); parameters.add(snapshot.fundingChannelId());
            }
            if (!snapshot.query().isEmpty()) {
                sql.append(" AND search_text ILIKE ? ESCAPE '\\'");
                parameters.add("%" + escapeLike(snapshot.query()) + "%");
            }
        }
        sql.append(" ORDER BY business_date DESC,business_time DESC,created_at DESC,record_id DESC");
        return new SqlQuery(sql.toString(), List.copyOf(parameters));
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
            String value = safeText(values[index]);
            writer.write('"');
            writer.write(value.replace("\"", "\"\""));
            writer.write('"');
        }
        writer.write("\r\n");
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private record SqlQuery(String sql, List<Object> parameters) { }
    static final class ExportCancelledException extends RuntimeException { }
    private static final class CsvWriteException extends RuntimeException {
        private final IOException cause;
        CsvWriteException(IOException cause) { super(cause); this.cause = cause; }
    }
}
