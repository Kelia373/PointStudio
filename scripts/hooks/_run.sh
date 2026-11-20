#!/bin/sh
# 钩子统一入口：三个钩子都转到这里，免得到处复制找 python 的逻辑。
# 找 python 的顺序：PATH 里的 python3/python → DSH 自带运行时 → 找不到就放行并警告。
# 注意：放行只发生在本地钩子；CI 里由 actions/setup-python 保证 python 存在。

PY=""
for c in python3 python py; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -V >/dev/null 2>&1; then
    PY="$c"; break
  fi
done

if [ -z "$PY" ]; then
  for p in \
    "$USERPROFILE/.dsh/dsh-runtimes/dsh-next-primary-runtime/dependencies/python/python.exe" \
    "$HOME/.dsh/dsh-runtimes/dsh-next-primary-runtime/dependencies/python/python.exe"
  do
    if [ -x "$p" ]; then PY="$p"; break; fi
  done
fi

if [ -z "$PY" ]; then
  echo "[tdd-gate] 没找到 python，本地钩子跳过（CI 仍然会跑，别指望绕过去）" >&2
  exit 0
fi

cd "$(git rev-parse --show-toplevel)" || exit 1
"$PY" scripts/tdd_gate.py "$@"
