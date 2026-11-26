// 契约测试：计划透镜（Plan Lens）的视图模型。
//
// Step 9 原本做成了顶部日期胶囊条，跟左侧会话列表重复；
// 真正要的是「多步计划时，在消息流里就地展开步骤详情」。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatElapsed, planLensView } from '../planLens.ts'
import type { PlanRunState } from '../planRunState.ts'
import type { PlanViewDto } from '../../../../shared/types/ipc.ts'

function plan(overrides: Partial<PlanViewDto> = {}): PlanViewDto {
  return {
    goal: '把导出接进侧栏',
    assumptions: [],
    stopConditions: [],
    steps: [
      { id: 's1', action: '读现有导出接口', tool: 'read_file', expect: '', risk: 'low', status: 'success', requiresConfirmation: false },
      { id: 's2', action: '补按钮', tool: null, expect: '', risk: 'low', status: 'pending', requiresConfirmation: false },
      { id: 's3', action: '跑门禁', tool: 'bash', expect: '', risk: 'low', status: 'pending', requiresConfirmation: false }
    ],
    progress: { total: 3, pending: 2, running: 0, success: 1, failed: 0, skipped: 0 },
    ...overrides
  }
}

function run(overrides: Partial<PlanRunState> = {}): PlanRunState {
  return { id: 'run-1', plan: plan(), status: 'running', ...overrides }
}

test('没有计划时不渲染透镜', () => {
  assert.equal(planLensView(null), null)
  assert.equal(planLensView({ id: 'run-1', plan: null, status: 'running' }), null)
})

test('折叠态只给一条：目标 + 已完成/总数 + 耗时', () => {
  const view = planLensView(run(), { elapsedMs: 1500 })
  assert.ok(view)
  assert.equal(view.goal, '把导出接进侧栏')
  assert.equal(view.done, 1)
  assert.equal(view.total, 3)
  assert.equal(view.elapsed, '1.5s')
})

test('stopped 时要在条上给「确认并继续」，completed 时不给', () => {
  assert.equal(planLensView(run({ status: 'stopped' }))?.needsConfirm, true)
  assert.equal(planLensView(run({ status: 'completed' }))?.needsConfirm, false)
})

test('展开的步骤合并执行详情：工具、耗时、错误码', () => {
  const view = planLensView(
    run({
      status: 'failed',
      details: [
        { id: 's1', status: 'success', tool: 'read_file', durationMs: 320 },
        { id: 's3', status: 'failed', tool: 'bash', durationMs: 1500, code: 'E_TOOL_TIMEOUT' }
      ]
    })
  )
  assert.ok(view)
  assert.deepEqual(
    view.steps.map((step) => [step.id, step.tool, step.duration, step.code]),
    [
      ['s1', 'read_file', '320ms', null],
      ['s2', null, '', null],
      ['s3', 'bash', '1.5s', 'E_TOOL_TIMEOUT']
    ]
  )
  // 步骤状态以执行详情为准（计划里的 s3 还是 pending）
  assert.equal(view.steps[2].status, 'failed')
})

test('耗时格式化：不足 1 秒用毫秒，超了用一位小数，未知留空', () => {
  assert.equal(formatElapsed(320), '320ms')
  assert.equal(formatElapsed(1500), '1.5s')
  assert.equal(formatElapsed(0), '0ms')
  assert.equal(formatElapsed(null), '')
  assert.equal(formatElapsed(undefined), '')
})
