#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TDD 门禁：在提交与 CI 两处拦住「假绿」。

规则来源：Apache SkyWalking 的 agentic vibe coding 实践。
AI 最隐蔽的失败不是写错代码，而是让绿灯变成假象。两种典型手法：
  1. 改期望值迁就实现（回头改答案）
  2. 新建测试时直接把实现的输出写成期望值（一开始就写答案）

用法：
    python scripts/tdd_gate.py --check         # 检查暂存区内容
    python scripts/tdd_gate.py --msg <FILE>    # 检查提交信息（commit-msg 钩子）
    python scripts/tdd_gate.py --test          # 跑全部测试（stdlib unittest，无依赖）
    python scripts/tdd_gate.py --all           # 内容 + 测试

钩子安装：bash scripts/install-hooks.sh
"""
import argparse
import os
import re
import subprocess
import sys

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

TEST_HINT = re.compile(
    r"(^|/)(tests?|__tests__|spec)(/|$)|(_test\.|\.test\.|_spec\.|\.spec\.|^test_)",
    re.IGNORECASE,
)
ASSERT_HINT = re.compile(r"\b(assert|expect|should|toBe|toEqual|assert_equal)\b")
DANGER_HINT = re.compile(
    r"(pytest\.mark\.skip|pytest\.skip\(|pytest\.mark\.xfail|unittest\.skip|"
    r"@unittest\.skip|# type: ignore|pragma: no cover|@ts-ignore|@ts-expect-error)",
    re.IGNORECASE,
)
RED_TRAILER = re.compile(r"^\s*TDD-Red:\s*\S+", re.IGNORECASE | re.MULTILINE)

# 不参与源码扫描：文档、配置、脚本自身
SKIP_EXT = (".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg")
SELF_PATH = "scripts/tdd_gate.py"

# 本门禁自己的测试文件：里面必然含有危险模式的字面量（夹具），
# 扫它会自伤。跳过它，代价是这个文件只能靠人审 + 自身的用例覆盖。
GATE_TEST_PATH = "tests/test_tdd_gate.py"


def _norm(path: str) -> str:
    return path.replace("\\", "/")


def is_test(path: str) -> bool:
    return bool(TEST_HINT.search(_norm(path)))


def is_code(path: str) -> bool:
    p = _norm(path)
    if SELF_PATH in p:
        return False
    if p.startswith("docs/") or "/docs/" in p:
        return False
    return not p.lower().endswith(SKIP_EXT)


# ---------------------------------------------------------------- 纯函数分析
# 这几个函数不碰 git，输入是 diff 行，便于单测（tests/test_tdd_gate.py）。

def analyze_test_diff(lines) -> list:
    """检查已跟踪测试文件的改动：删断言 / 加豁免标记。"""
    problems = []
    removed_asserts = 0
    danger = 0
    for line in lines:
        if line.startswith("-") and not line.startswith("---"):
            if ASSERT_HINT.search(line):
                removed_asserts += 1
            if DANGER_HINT.search(line):
                danger += 1
        elif line.startswith("+") and not line.startswith("+++"):
            if DANGER_HINT.search(line):
                danger += 1
    if removed_asserts:
        problems.append(f"删改了 {removed_asserts} 行断言——检查是否在改期望值迁就实现")
    if danger:
        problems.append("出现跳过/豁免标记——不允许用绕过手段变绿")
    return problems


def analyze_src_diff(lines) -> list:
    """检查源码新增行里的可疑写法。"""
    problems = []
    added = [ln[1:] for ln in lines if ln.startswith("+") and not ln.startswith("+++")]
    block = "\n".join(added)
    for m in DANGER_HINT.finditer(block):
        snippet = block[max(0, m.start() - 20):m.end() + 20].replace("\n", " ⏎ ")
        problems.append(f"新增可疑写法 … {snippet.strip()[:70]}")
    if re.search(r"except\s*:\s*(#.*)?\n\s*pass\b", block):
        problems.append("新增「except: pass」吞异常")
    return problems


def missing_red_proof(commit_msg: str) -> bool:
    """新增测试文件时，提交信息必须有 TDD-Red 说明（表示确实见过它失败）。"""
    return not RED_TRAILER.search(commit_msg or "")


# ---------------------------------------------------------------- git 交互
def git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], capture_output=True, text=True,
            encoding="utf-8", errors="replace",
        ).stdout
    except FileNotFoundError:
        return ""


def staged_changes() -> dict:
    """返回 {path: 'A'|'M'|'D'|'R'}（已重命名的按新增处理）。"""
    out = git("diff", "--cached", "--name-status", "-M")
    changes = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status, path = parts[0].strip()[:1], parts[-1].strip()
        if not path:
            continue
        changes[path] = "A" if status == "R" else status
    return changes


def staged_diff(path: str) -> list:
    return git("diff", "--cached", "--unified=0", "--", path).splitlines()


# ---------------------------------------------------------------- 命令
def check() -> int:
    changes = staged_changes()
    if not changes:
        print("[tdd-gate] 暂存区为空，跳过")
        return 0

    tests = [f for f, s in changes.items() if is_test(f) and s != "D"]
    srcs = [f for f, s in changes.items() if not is_test(f) and s != "D" and is_code(f)]
    new_tests = [f for f, s in changes.items() if is_test(f) and s == "A"]

    problems = []
    for f in tests:
        if _norm(f) == GATE_TEST_PATH:
            print(f"[tdd-gate] {f} 是门禁自身的测试夹具，跳过内容扫描")
            continue
        for p in analyze_test_diff(staged_diff(f)):
            problems.append(f"{f}: {p}")
    for f in srcs:
        for p in analyze_src_diff(staged_diff(f)):
            problems.append(f"{f}: {p}")

    if new_tests:
        print(f"[tdd-gate] 新增测试文件 {len(new_tests)} 个：{', '.join(new_tests)}")
        print("           提交信息必须包含 'TDD-Red: <说明>'，即你确实见过它失败。")
        print("           commit-msg 钩子会校验；未安装钩子时 CI 仍然拦得住。")

    if problems:
        print("\n[tdd-gate] 发现可疑改动，提交已阻止：\n")
        for p in problems:
            print("  - " + p)
        print("\n如果确实要改断言，请单独一次提交，并在提交信息里说明原断言为什么是错的。")
        return 2

    print("[tdd-gate] 暂存区检查通过")
    return 0


def check_message(msg_file: str) -> int:
    """commit-msg 钩子：新增测试却没说清「见过红」，直接拒。"""
    try:
        with open(msg_file, encoding="utf-8", errors="replace") as fh:
            msg = fh.read()
    except OSError as exc:
        print(f"[tdd-gate] 读不到提交信息：{exc}")
        return 1

    if msg.lstrip().startswith("Merge ") or "TDD-Red: n/a" in msg.lower():
        # 合并提交不查；显式声明不适用时放行（留痕，可追溯）
        return 0

    new_tests = [f for f, s in staged_changes().items() if is_test(f) and s == "A"]
    if not new_tests:
        return 0

    if missing_red_proof(msg):
        print("\n[tdd-gate] 新增了测试文件，但提交信息里没有 TDD-Red 说明：\n")
        for f in new_tests:
            print(f"  - {f}")
        print(
            "\n新增测试必须先看到它失败。请在提交信息里加一行，例如：\n"
            "  TDD-Red: tests/test_x.py 在实现前运行，3 个用例全红（NameError: parse）\n"
            "确定不适用（例如补回归测试）时写：\n"
            "  TDD-Red: n/a — 为已存在行为补回归测试，已手工验证实现前不通过\n"
        )
        return 2
    return 0


def run_tests() -> int:
    if not os.path.isdir("tests"):
        print("[tdd-gate] 没有 tests/ 目录，跳过测试")
        return 0
    print("[tdd-gate] 运行测试（stdlib unittest）…")
    code = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-t", ".", "-v"]
    ).returncode
    if code != 0:
        print("[tdd-gate] 测试未通过，禁止提交")
        return 1
    print("[tdd-gate] 测试通过")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="TDD 门禁：拦住假绿")
    ap.add_argument("--check", action="store_true", help="检查暂存区内容")
    ap.add_argument("--msg", metavar="FILE", help="检查提交信息文件")
    ap.add_argument("--test", action="store_true", help="运行测试")
    ap.add_argument("--all", action="store_true", help="内容检查 + 测试")
    args = ap.parse_args()

    if args.msg:
        return check_message(args.msg)
    if args.all:
        return check() or run_tests()
    if args.check:
        return check()
    if args.test:
        return run_tests()
    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
