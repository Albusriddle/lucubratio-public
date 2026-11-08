#!/usr/bin/env bash
# 推送重试 + 远端核对
#
# 为什么需要它：
#   · github.com:443 在本机是间歇可达的（TUN 代理抖动），单次 push 经常失败
#   · 更危险的是"假成功"：git push 有时打印 Everything up-to-date，但远端其实没变
#   → 所以每次尝试后都用 git ls-remote 核对远端 SHA，而不是相信 push 的输出
#
# 用法：
#   scripts/push-retry.sh <repo-url-with-token> <ref> [--check]
#   scripts/push-retry.sh "$URL" main
#   scripts/push-retry.sh "$URL" v0.2.2
#   scripts/push-retry.sh "$URL" main --check     # 只核对，不推送
#   scripts/push-retry.sh "$URL" main --proxy http://127.0.0.1:7899   # 经本地隧道
#
# 退出码：0 = 远端与本地一致；1 = 多次重试后仍不一致

set -uo pipefail

URL="${1:-}"
REF="${2:-}"
MODE="${3:-}"
PROXY="${4:-}"
GIT_PROXY=()
[ -n "$PROXY" ] && GIT_PROXY=(-c "http.proxy=$PROXY")

if [ -z "$URL" ] || [ -z "$REF" ]; then
  echo "用法: scripts/push-retry.sh <repo-url> <ref> [--check]" >&2
  exit 2
fi

ATTEMPTS=8
LOCAL_SHA="$(git rev-parse "$REF" 2>/dev/null || git rev-parse "refs/tags/$REF" 2>/dev/null || true)"
if [ -z "$LOCAL_SHA" ]; then
  echo "✗ 本地找不到 ref: $REF" >&2
  exit 2
fi

remote_sha() {
  git "${GIT_PROXY[@]}" ls-remote "$URL" "refs/heads/$REF" 2>/dev/null | awk '{print $1}' | head -1
}

check_only=0
[ "$MODE" = "--check" ] && check_only=1

i=0
while [ "$i" -lt "$ATTEMPTS" ]; do
  i=$((i + 1))
  if [ "$check_only" -eq 1 ]; then
    echo "· 第 $i 次核对（--check 模式）"
  else
    echo "· 第 $i 次尝试 push $REF"
    git "${GIT_PROXY[@]}" push "$URL" "$REF" >/dev/null 2>&1
  fi

  R="$(remote_sha)"
  if [ -n "$R" ]; then
    # tag 与分支都可能，单独判一次 refs/tags
    [ "$R" = "$LOCAL_SHA" ] || {
      T="$(git "${GIT_PROXY[@]}" ls-remote "$URL" "refs/tags/$REF" 2>/dev/null | awk '{print $1}' | head -1)"
      [ -n "${T:-}" ] && R="$T"
    }
    if [ "$R" = "$LOCAL_SHA" ]; then
      echo "✓ 远端已一致：$REF = ${LOCAL_SHA:0:7}"
      exit 0
    fi
    echo "  远端 ${R:0:7} ≠ 本地 ${LOCAL_SHA:0:7}，继续重试"
  else
    echo "  远端不可达（ls-remote 空），继续重试"
  fi

  sleep $((i * 4 < 24 ? i * 4 : 24))
done

echo "✗ $ATTEMPTS 次后仍未一致：本地 ${LOCAL_SHA:0:7} / 远端 ${R:-不可达}" >&2
echo "  下一步：确认代理可用后重跑本脚本；或用 --check 只核对" >&2
exit 1
