#!/usr/bin/env bash
set -euo pipefail
# 一次性容器：只使用应用数据库角色，初始化 secret 不挂载到常驻 app。
: "${MY_BILL_BOOTSTRAP_USERNAME:?set initial username}"
: "${MY_BILL_BOOTSTRAP_PASSWORD_FILE:?set initial password secret}"
: "${MY_BILL_APP_DB_URL:?set app database URL}"
: "${MY_BILL_APP_DB_USERNAME:?set app database username}"
export SPRING_DATASOURCE_URL="$MY_BILL_APP_DB_URL"
export SPRING_DATASOURCE_USERNAME="$MY_BILL_APP_DB_USERNAME"
export SPRING_DATASOURCE_PASSWORD="$(<"${MY_BILL_APP_DB_PASSWORD_FILE:?set app password file}")"
exec java -Xmx512m -jar /app/my-bill-server.jar --bootstrap-admin --server.address=127.0.0.1 --server.port=0
