package com.mybill.dictionary;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** 收入引用锁定查询；SQL 统一维护在同名 XML。 */
@Mapper
public interface IncomeDictionaryServiceMapper {
    List<Map<String, Object>> lock(@Param("p") Map<String, Object> parameters);
}
