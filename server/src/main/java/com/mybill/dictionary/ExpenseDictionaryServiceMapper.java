package com.mybill.dictionary;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** ExpenseDictionaryService 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface ExpenseDictionaryServiceMapper {
    List<Map<String, Object>> lockNamed(@Param("p") Map<String, Object> parameters);
    List<Map<String, Object>> listActiveProducts(@Param("p") Map<String, Object> parameters);

    int updateProductRecentValues(@Param("p") Map<String, Object> parameters);

    int refreshProductRecentValues(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> lockProduct(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> lockSecondaryCategory(@Param("p") Map<String, Object> parameters);
}
