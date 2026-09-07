package com.mybill.ledger;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** 账本分页查询 Mapper；动态条件维护在 XML。 */
@Mapper
public interface LedgerQueryRepositoryMapper {
    List<Map<String, Object>> findPage(@Param("p") Map<String, Object> parameters);
    List<Map<String, Object>> findTrashPage(@Param("p") Map<String, Object> parameters);
}
