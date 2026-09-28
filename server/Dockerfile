# syntax=docker/dockerfile:1.7
FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY pom.xml mvnw ./
COPY .mvn .mvn
COPY server/pom.xml server/pom.xml
COPY server/src server/src
RUN ./mvnw -B -pl server -am package -DskipTests

FROM eclipse-temurin:21-jre AS app
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /workspace/server/target/my-bill-server-*.jar /app/my-bill-server.jar
COPY deploy/scripts/run-app.sh /usr/local/bin/run-app
RUN chmod 0555 /usr/local/bin/run-app && chmod 0444 /app/my-bill-server.jar
RUN mkdir -p /var/lib/my-bill/exports && chown 10001:10001 /var/lib/my-bill/exports
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/run-app"]

# 独立迁移目标不复制业务 jar、Spring Web 入口或应用启动脚本。
FROM flyway/flyway:11.7.2 AS migrate
COPY server/src/main/resources/db/migration /flyway/sql
COPY deploy/scripts/run-flyway.sh /usr/local/bin/run-flyway
USER root
# 一次性迁移镜像也必须安装发行版安全更新，不豁免系统包扫描。
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
RUN chmod 0555 /usr/local/bin/run-flyway && chmod -R a-w /flyway/sql
WORKDIR /tmp
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/run-flyway"]
