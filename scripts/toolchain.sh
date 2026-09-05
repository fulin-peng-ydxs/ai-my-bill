#!/usr/bin/env bash

resolve_node() {
  local required_version
  required_version="$(tr -d '[:space:]' < "${PROJECT_ROOT}/.nvmrc")"
  if command -v node >/dev/null 2>&1 && [[ "$(node -p 'process.versions.node.split(`.`)[0]')" -ge 24 ]]; then
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

is_java_21_jdk() {
  local java_home_candidate="$1"
  [[ -n "${java_home_candidate}" ]] \
    && [[ -x "${java_home_candidate}/bin/java" ]] \
    && [[ -x "${java_home_candidate}/bin/javac" ]] \
    && "${java_home_candidate}/bin/java" -version 2>&1 | head -1 | grep -Eq 'version "21([.]|\")' \
    && "${java_home_candidate}/bin/java" --list-modules 2>/dev/null | grep -q '^java[.]instrument@'
}

resolve_java() {
  local java_candidate
  for java_candidate in \
    "${JAVA_HOME:-}" \
    "$(/usr/libexec/java_home -v 21 2>/dev/null || true)" \
    "/opt/homebrew/opt/openjdk@21"; do
    if is_java_21_jdk "${java_candidate}"; then
      export JAVA_HOME="${java_candidate}"
      export PATH="${JAVA_HOME}/bin:${PATH}"
      return
    fi
  done
  if [[ -d /Applications ]]; then
    while IFS= read -r java_binary; do
      java_candidate="${java_binary%/bin/java}"
      if is_java_21_jdk "${java_candidate}"; then
        export JAVA_HOME="${java_candidate}"
        export PATH="${JAVA_HOME}/bin:${PATH}"
        return
      fi
    done < <(find /Applications -maxdepth 8 -path '*/Contents/Home/bin/java' -type f 2>/dev/null)
  fi
  echo "需要完整的 Java 21 JDK（含 javac 与 java.instrument）；请设置 JAVA_HOME 后重试。" >&2
  exit 1
}

resolve_toolchain() {
  resolve_node
  resolve_java
}
