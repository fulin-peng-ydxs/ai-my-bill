package com.mybill;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration",
        "spring.flyway.enabled=false"
})
class MyBillApplicationTest {

    @Test
    void contextLoads() {
    }
}
