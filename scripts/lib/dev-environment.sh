#!/usr/bin/env bash

# 调用方提供 PROJECT_ROOT 和 resolve_node；在读取配置、启动消费者前调用。
load_dev_environment() {
  resolve_node
  local dev_env_key dev_env_value dev_env_loaded=false
  while IFS= read -r -d '' dev_env_key; do
    if [[ -z "${dev_env_key}" ]]; then
      dev_env_loaded=true
      break
    fi
    IFS= read -r -d '' dev_env_value || break
    export "${dev_env_key}=${dev_env_value}"
  done < <(node "${PROJECT_ROOT}/scripts/lib/dev-environment.mjs" "${PROJECT_ROOT}")
  [[ "${dev_env_loaded}" == true ]]
}
