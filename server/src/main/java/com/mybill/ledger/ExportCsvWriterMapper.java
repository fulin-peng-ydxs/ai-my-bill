package com.mybill.ledger;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.cursor.Cursor;

import java.util.Map;

/** CSV 流式导出 Mapper；游标避免全量结果驻留内存。 */
@Mapper
public interface ExportCsvWriterMapper {
    @Options(fetchSize = 200)
    Cursor<Map<String, Object>> stream(@Param("p") Map<String, Object> parameters);
}
