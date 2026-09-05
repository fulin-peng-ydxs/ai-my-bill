package com.mybill;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;

/**
 * 我的账单模块化单体服务入口。
 */
@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
public class MyBillApplication {

    public static void main(String[] args) {
        SpringApplication.run(MyBillApplication.class, args);
    }
}
