// utils/uuid —— UUID 形状校验。
//
// 放在 utils 而不是 ipc：服务层（如附件落盘）也要用它挡目录穿越，而
// services 只允许依赖 core / data / ai / utils（见 services/README.md）。
// ipc/validators 从这里 re-export，保持边界层原有的 import 路径不变。

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}
