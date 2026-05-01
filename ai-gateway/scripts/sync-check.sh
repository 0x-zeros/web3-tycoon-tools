#!/usr/bin/env bash
# 用法: ./scripts/sync-check.sh
#
# 自动从 docs/UPSTREAM-SYNC.md 读上次同步的 CLIProxyAPI commit sha，
# 对比上游在我们关心文件里的所有 commit 与 diff。
#
# 上游缓存默认放在 .cache/CLIProxyAPI（gitignored），脚本第一次跑会自动 clone，
# 后续每次跑会 fetch 最新；可用环境变量 UPSTREAM_DIR 指向已存在的本地 clone。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_REPO_URL="${UPSTREAM_REPO_URL:-https://github.com/router-for-me/CLIProxyAPI}"
UPSTREAM_DIR="${UPSTREAM_DIR:-${REPO_ROOT}/.cache/CLIProxyAPI}"
SYNC_DOC="${REPO_ROOT}/docs/UPSTREAM-SYNC.md"

WATCHED=(
  "internal/auth/codex/openai_auth.go"
  "internal/runtime/executor/codex_executor.go"
  "internal/auth/codex/jwt_parser.go"
  "internal/auth/codex/token.go"
  "sdk/auth/codex_device.go"
)

if [[ ! -f "${SYNC_DOC}" ]]; then
  echo "✗ 找不到同步台账：${SYNC_DOC}" >&2
  exit 1
fi

if [[ ! -d "${UPSTREAM_DIR}/.git" ]]; then
  echo "首次运行，clone 上游到 ${UPSTREAM_DIR}"
  mkdir -p "$(dirname "${UPSTREAM_DIR}")"
  git clone "${UPSTREAM_REPO_URL}" "${UPSTREAM_DIR}"
else
  echo "更新上游缓存：${UPSTREAM_DIR}"
  git -C "${UPSTREAM_DIR}" fetch --quiet --tags origin
  DEFAULT_BRANCH=$(git -C "${UPSTREAM_DIR}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || echo main)
  git -C "${UPSTREAM_DIR}" checkout --quiet "${DEFAULT_BRANCH}"
  git -C "${UPSTREAM_DIR}" pull --quiet --ff-only origin "${DEFAULT_BRANCH}"
fi

# 读最新一条 "CLIProxyAPI commit:" 后跟的 sha（最上面那条 = 最新）
LAST_SYNC=$(grep -m 1 -oE '\*\*CLIProxyAPI commit\*\*: `[a-f0-9]+`' "${SYNC_DOC}" | head -1 | grep -oE '[a-f0-9]{7,}' || true)

if [[ -z "${LAST_SYNC}" ]]; then
  echo "✗ 未能从 ${SYNC_DOC} 解出上次同步的 commit sha" >&2
  echo "  请确认台账里有形如：**CLIProxyAPI commit**: \`<sha>\`" >&2
  exit 1
fi

echo "上次同步的 CLIProxyAPI commit: ${LAST_SYNC}"
echo

cd "${UPSTREAM_DIR}"

# 验证 sha 存在
if ! git cat-file -e "${LAST_SYNC}^{commit}" 2>/dev/null; then
  echo "✗ 在 ${UPSTREAM_DIR} 里找不到 commit ${LAST_SYNC}" >&2
  echo "  尝试 git fetch 后重跑" >&2
  exit 1
fi

CURRENT_HEAD=$(git rev-parse HEAD)
echo "上游当前 HEAD: ${CURRENT_HEAD}"
echo

if [[ "${LAST_SYNC}" == "${CURRENT_HEAD}"* ]] || [[ "${CURRENT_HEAD}" == "${LAST_SYNC}"* ]]; then
  echo "✓ 已是最新，无需同步"
  exit 0
fi

echo "=== 自 ${LAST_SYNC} 以来在关心文件里的 commits ==="
git log "${LAST_SYNC}..HEAD" --oneline -- "${WATCHED[@]}" || true
echo

echo "=== 完整 diff（前 400 行） ==="
git diff "${LAST_SYNC}..HEAD" -- "${WATCHED[@]}" | head -400
echo

echo
echo "------"
echo "下一步：把上面的 diff 与 commit 列表贴给 Claude 决定 take/skip/partial。"
echo "完成同步后在 docs/UPSTREAM-SYNC.md 顶部新加一条记录。"
