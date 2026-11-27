#!/usr/bin/env bash

resolve_node() {
  local required_version
  required_version="$(tr -d '[:space:]' < "${PROJECT_ROOT}/.nvmrc")"
  if command -v node >/dev/null 2>&1 && [[ "$(node --version)" == "v${required_version}" ]]; then
    return
  fi
  local nvm_node="${HOME}/.nvm/versions/node/v${required_version}/bin"
  if [[ -x "${nvm_node}/node" ]]; then
    export PATH="${nvm_node}:${PATH}"
    return
  fi
  echo "需要 Node.js ${required_version}；请先执行 nvm install && nvm use。" >&2
  exit 1
}
