#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_toolchain
cd "${PROJECT_ROOT}"

source_commit="${1:-$(git rev-parse HEAD)}"
if [[ "${source_commit}" != "$(git rev-parse HEAD)" ]]; then
  echo "发布候选提交必须等于当前 HEAD。" >&2
  exit 1
fi
unexpected_status="$(git status --porcelain --untracked-files=all | grep -vE '^ M [.](gitignore)$' || true)"
if [[ -n "${unexpected_status}" ]]; then
  echo "发布候选构建前除用户的 .gitignore 外必须无未提交改动：" >&2
  echo "${unexpected_status}" >&2
  exit 1
fi

./mvnw -B -pl server -DskipTests package
MY_BILL_BUILD_ID="${source_commit}" npm --prefix web run build
# Release diagnostics use a private umask; Caddy still needs to read these public assets.
find web/dist -type d -exec chmod 0755 {} +
find web/dist -type f -exec chmod 0644 {} +

server_jar="$(find server/target -maxdepth 1 -type f -name '*.jar' ! -name '*.original' | head -1)"
if [[ -z "${server_jar}" ]]; then
  echo "没有找到服务端发布 jar。" >&2
  exit 1
fi
output_directory="${PROJECT_ROOT}/.local/web/release-candidate/${source_commit}"
mkdir -p "${output_directory}"
node scripts/release-manifest.mjs "${source_commit}" "${server_jar}" web/dist "${output_directory}/manifest.txt"
