#!/usr/bin/env bash
# 推送重试 + 远端核对（token 默认不出现在命令行里）
#
# 为什么需要它：
#   · github.com:443 在部分网络下间歇可达，单次 push 经常失败
#   · 更危险的是"假成功"：git push 有时打印 Everything up-to-date，但远端其实没变
#   → 每次尝试后都用 git ls-remote 核对远端 SHA，而不是相信 push 的输出
#
# 用法：
#   GH_TOKEN=xxx scripts/push-retry.sh <repo-url> <ref> [--check] [--proxy URL]
#   GH_TOKEN=xxx scripts/push-retry.sh https://github.com/owner/repo.git main
#   GH_TOKEN=xxx scripts/push-retry.sh https://github.com/owner/repo.git main --check
#   GH_TOKEN=xxx scripts/push-retry.sh https://github.com/owner/repo.git main --proxy http://127.0.0.1:7899
#
# token 从哪来（按优先级）：
#   1) 环境变量 GH_TOKEN
#   2) 文件 --token-file <path>
#   3) 旧式：URL 里自带 https://user:token@…（兼容，但会打印提醒）
#
# 安全：token 通过 GIT_ASKPASS 传给 git，不出现在进程参数里；临时脚本 0600 且退出即删。
#
# 退出码：0 = 远端与本地一致；1 = 多次重试后仍不一致；2 = 用法/参数错误

set -uo pipefail

URL="${1:-}"
REF="${2:-}"
shift 2 2>/dev/null || true

CHECK_ONLY=0
PROXY=""
TOKEN_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK_ONLY=1 ;;
    --proxy) PROXY="${2:-}"; shift ;;
    --token-file) TOKEN_FILE="${2:-}"; shift ;;
    *) ;;
  esac
  shift
done

if [ -z "$URL" ] || [ -z "$REF" ]; then
  echo "用法: GH_TOKEN=xxx scripts/push-retry.sh <repo-url> <ref> [--check] [--proxy URL] [--token-file PATH]" >&2
  exit 2
fi

# ---- 取 token ----
TOKEN="${GH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -n "$TOKEN_FILE" ] && [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
fi
LEGACY=0
if echo "$URL" | grep -q '@'; then
  LEGACY=1
  TOKEN="$(echo "$URL" | sed -E 's#https://[^:]+:([^@]+)@.*#\1#')"
  URL="$(echo "$URL" | sed -E 's#https://[^@]+@#https://#')"
fi

# ---- 构造 git 的认证方式（token 不进 argv）----
GIT_AUTH=()
ASKPASS=""
if [ -n "$TOKEN" ]; then
  ASKPASS="$(mktemp 2>/dev/null || echo "/tmp/askpass.$$")"
  {
    echo '#!/bin/sh'
    echo 'case "$1" in'
    echo '  *[Uu]sername*) printf "%s\n" "x-access-token" ;;'
    echo '  *) printf "%s\n" "$GH_TOKEN_ASKPASS" ;;'
    echo 'esac'
  } > "$ASKPASS"
  chmod 700 "$ASKPASS" 2>/dev/null || true
  export GH_TOKEN_ASKPASS="$TOKEN"
  export GIT_ASKPASS="$ASKPASS"
  export GIT_TERMINAL_PROMPT=0
  trap 'rm -f "$ASKPASS"' EXIT INT TERM
fi
# 没给 --proxy 时，自动读 Windows 系统代理（很多人日常挂着代理，但 git 默认不读它）
# 注意：在 MSYS/git-bash 里必须关掉路径转换，否则 /v 会被当成路径改写
if [ -z "$PROXY" ] && command -v reg >/dev/null 2>&1; then
  _reg() {
    MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' reg query \
      "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v "$1" 2>/dev/null \
      | awk -v k="$1" '$1 == k {print $NF}' | tr -d '\r'
  }
  SP="$(_reg ProxyServer)"
  EN="$(_reg ProxyEnable)"
  if [ "$EN" = "0x1" ] && [ -n "$SP" ]; then
    case "$SP" in
      *";"*) PROXY="http://$(echo "$SP" | tr ';' '\n' | awk -F= '/https=/{print $2}' | head -1)" ;;
      *)     PROXY="http://$SP" ;;
    esac
    echo "· 自动使用系统代理：$PROXY"
  fi
fi

[ -n "$PROXY" ] && GIT_AUTH+=(-c "http.proxy=$PROXY")

if [ "$LEGACY" = "1" ]; then
  echo "· 提醒：URL 里带 token 会出现在进程列表里；建议改用 GH_TOKEN=… 的形式" >&2
fi

ATTEMPTS=8
LOCAL_SHA="$(git rev-parse "$REF" 2>/dev/null || git rev-parse "refs/tags/$REF" 2>/dev/null || true)"
if [ -z "$LOCAL_SHA" ]; then
  echo "✗ 本地找不到 ref: $REF" >&2
  exit 2
fi

remote_sha() {
  # 同时查分支与 tag：只查 refs/heads 时，推 tag 会永远"远端不可达"（v0.3.9 首发踩过，
  # 白等 8 次重试还报失败，其实 tag 早就推上去了）。
  git "${GIT_AUTH[@]}" ls-remote "$URL" "refs/heads/$REF" "refs/tags/$REF" 2>/dev/null \
    | awk '{print $1}' | head -1
}

i=0
R=""
while [ "$i" -lt "$ATTEMPTS" ]; do
  i=$((i + 1))
  if [ "$CHECK_ONLY" -eq 1 ]; then
    echo "· 第 $i 次核对（--check 模式）"
  else
    echo "· 第 $i 次尝试 push $REF"
    git "${GIT_AUTH[@]}" push "$URL" "$REF" >/dev/null 2>&1
  fi

  R="$(remote_sha)"
  if [ -n "$R" ]; then
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
echo "  下一步：确认网络或起隧道（node scripts/gh-tunnel.mjs &）后重跑" >&2
exit 1
