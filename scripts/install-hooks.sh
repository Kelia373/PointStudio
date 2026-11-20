#!/bin/sh
# 安装 git 钩子到本仓库（每个 clone 只需跑一次）。
# 钩子放在 scripts/hooks/ 并入库，通过 core.hooksPath 生效——
# 这样换机器、上 CI 都不会像 .git/hooks 那样凭空消失。
set -e

cd "$(git rev-parse --show-toplevel)"

git config --local core.hooksPath scripts/hooks

# 让 Unix 上检出的钩子带可执行位（Windows 下忽略即可）
git update-index --chmod=+x \
  scripts/hooks/pre-commit \
  scripts/hooks/commit-msg \
  scripts/hooks/pre-push \
  scripts/hooks/_run.sh 2>/dev/null || true

echo "已安装：core.hooksPath = $(git config --local core.hooksPath)"
echo "  pre-commit  内容检查（改断言 / 跳过标记 / 吞异常）"
echo "  commit-msg  新增测试必须带 TDD-Red 说明"
echo "  pre-push    跑全部测试"
echo
echo "绕过钩子：git commit --no-verify（不推荐，CI 会拦）"
