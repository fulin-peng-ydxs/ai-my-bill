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
        if (java.util.Arrays.asList(args).contains("--recovery-tool")) {
            SpringApplication application = new SpringApplication(MyBillApplication.class);
            application.setAdditionalProfiles("prod", "recovery");
            application.addInitializers(context -> context.getEnvironment().getPropertySources().addFirst(
                    new org.springframework.core.env.MapPropertySource("recoveryIsolation",
                            java.util.Map.of("server.address", "127.0.0.1", "server.port", "0"))));
            try (var context = application.run(args)) {
                // 维护任务完成即关闭；不发布外部端口，不启用后台任务。
            }
        } else if (java.util.Arrays.asList(args).contains("--bootstrap-admin")) {
            SpringApplication application = new SpringApplication(MyBillApplication.class);
            application.setAdditionalProfiles("prod", "bootstrap");
            // 初始化不发布对外 HTTP 入口，完成事务后关闭所有资源并退出。
            application.setDefaultProperties(java.util.Map.of("server.address", "127.0.0.1", "server.port", "0"));
            try (var context = application.run(args)) {
                // ApplicationRunner 已完成；不输出初始密码。
            }
        } else {
            SpringApplication.run(MyBillApplication.class, args);
        }
    }
}
