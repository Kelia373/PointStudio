"""tdd_gate 的自测。

门禁是规范的地基，地基自己必须被测试守住。

注意一条设计事实：**内容层抓不住「新建测试时直接写错期望」**——
新文件在 diff 里全是 `+` 行，没有删除行可抓。所以那条规则由
提交信息层（TDD-Red）承担，见 test_missing_red_proof_*。
本文件把这个边界写成断言，防止以后有人误以为内容层已经覆盖。
"""
import unittest

import importlib.util
import pathlib

_ROOT = pathlib.Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("tdd_gate", _ROOT / "scripts" / "tdd_gate.py")
tdd_gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tdd_gate)


class TestPathClassification(unittest.TestCase):
    def test_test_paths_are_recognised(self):
        for p in ("tests/test_a.py", "apps/x/__tests__/a.js", "spec/a.spec.ts", "test_a.py"):
            self.assertTrue(tdd_gate.is_test(p), p)

    def test_source_paths_are_not_tests(self):
        for p in ("scripts/tdd_gate.py", "packages/core/a.py", "apps/a/a.js"):
            self.assertFalse(tdd_gate.is_test(p), p)

    def test_docs_are_not_code(self):
        self.assertFalse(tdd_gate.is_code("docs/01-开发工作规则.md"))
        self.assertTrue(tdd_gate.is_code("packages/core/a.py"))


class TestAssertionTampering(unittest.TestCase):
    def test_removed_assertion_is_flagged(self):
        diff = [
            "--- a/tests/test_a.py",
            "+++ b/tests/test_a.py",
            "-    assert compute() == 42",
            "+    assert compute() == 43",
        ]
        problems = tdd_gate.analyze_test_diff(diff)
        self.assertTrue(any("删改了 1 行断言" in p for p in problems), problems)

    def test_clean_test_change_passes(self):
        diff = ["+def test_new():\n", "+    assert 1 == 1\n"]
        self.assertEqual(tdd_gate.analyze_test_diff(diff), [])

    def test_skip_marker_is_flagged(self):
        diff = ["+@unittest.skip('later')\n", "+def test_x(): pass\n"]
        self.assertTrue(tdd_gate.analyze_test_diff(diff))

    def test_brand_new_file_is_invisible_to_content_check(self):
        """已知边界：全新增文件抓不住。这条断言是给未来的人看的。"""
        diff = ["+def test_x():\n", "+    assert compute() == 999\n"]
        self.assertEqual(tdd_gate.analyze_test_diff(diff), [])


class TestSourcePatterns(unittest.TestCase):
    def test_ts_ignore_is_flagged(self):
        self.assertTrue(tdd_gate.analyze_src_diff(["+// @ts-ignore\n", "+const a = 1\n"]))

    def test_bare_except_pass_is_flagged(self):
        diff = ["+try:\n", "+    risky()\n", "+except:\n", "+    pass\n"]
        self.assertTrue(tdd_gate.analyze_src_diff(diff))

    def test_narrow_except_is_allowed(self):
        diff = ["+try:\n", "+    risky()\n", "+except ValueError:\n", "+    log()\n"]
        self.assertEqual(tdd_gate.analyze_src_diff(diff), [])


class TestRedProof(unittest.TestCase):
    def test_missing_trailer_requires_proof(self):
        self.assertTrue(tdd_gate.missing_red_proof("feat: 加个解析器\n"))

    def test_trailer_satisfies_requirement(self):
        msg = "feat: 加解析器\n\nTDD-Red: tests/test_parse.py 实现前 3 个用例全红\n"
        self.assertFalse(tdd_gate.missing_red_proof(msg))

    def test_empty_trailer_does_not_count(self):
        self.assertTrue(tdd_gate.missing_red_proof("feat: x\n\nTDD-Red:   \n"))

    def test_na_escape_hatch_is_allowed(self):
        self.assertFalse(tdd_gate.missing_red_proof("test: 补回归\n\nTDD-Red: n/a 已手工验证\n"))


if __name__ == "__main__":
    unittest.main()
