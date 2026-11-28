// shared/i18n/errors —— 错误码 → 人能看懂的说明。
//
// 为什么放在 shared：主进程写日志、渲染进程显示提示都要用同一套说法，
// 各写一份必然漂移（界面说"网络问题"、日志写"E_STREAM"，排查时对不上）。
//
// 约定：文案里**不出现错误码**。码是给程序看的，人只需要知道下一步怎么办。

export const ERROR_MESSAGES: Record<string, string> = {
  // 输入与通用
  E_BAD_INPUT: '请求参数不对，已拦下没有执行',
  E_INTERNAL: '程序内部出错了，可以重试一次',
  E_NOT_FOUND: '找不到对应的内容，可能已被删除',
  E_CANCELLED: '已取消',
  E_BUILTIN_PROTECTED: '这是系统内置的通用助手，不能停用或删除；可以改名、换头像和模型。',
  E_IMAGE_INVALID: '图片数据不可识别，请重新选择文件',
  E_IMAGE_TYPE: '只支持 PNG / JPEG / WebP / GIF 图片（SVG 不可用）',
  E_IMAGE_TOO_LARGE: '单张图片不能超过 10 MB',
  E_IMAGE_UNREADABLE: '读取不到图片文件，可能已被删除，请重新添加',
  E_TOO_MANY_IMAGES: '一条消息最多 6 张图片',
  E_BAD_IMAGE: '图片信息不完整，请重新添加',
  E_VISION_UNSUPPORTED:
    '当前模型不支持识图，请在右侧 Agent 设置中切换支持视觉的模型（如 kimi-k2.5 / GPT-4o / Claude / Gemini / Qwen-VL）',

  // 模型平台
  E_UPSTREAM: '模型平台出错了，稍后重试或换个平台',
  E_MISSING_KEY: '还没有配置 API Key，去设置里填一个',
  E_HTTP: '模型平台返回了错误状态码，检查 Key 与接口地址',
  E_STREAM: '连接模型平台失败，检查网络或本地服务是否启动',
  E_ABORTED: '这次回复已被中断',

  // 工具
  E_TOOL_NOT_FOUND: '找不到这个工具，可能已被移除',
  E_TOOL_BAD_ARGS: '工具参数不合法，这一步没有执行',
  E_TOOL_FAILED: '工具执行失败',
  E_TOOL_TIMEOUT: '工具执行超时，已放弃这一步',

  // 助手与校验
  E_NAME_REQUIRED: '名称不能为空',
  E_NAME_TOO_LONG: '名称太长了',
  E_PARAM_RANGE: '参数超出允许范围',
  E_TITLE_REQUIRED: '标题不能为空',
  E_TITLE_TOO_LONG: '标题太长了',
  E_EMPTY_CONTENT: '内容不能为空',
  E_BAD_ROLE: '消息角色不合法',

  // 设置
  E_KEY_REQUIRED: '这个平台需要 API Key',
  E_BASE_URL_INVALID: '接口地址不合法，需要以 http(s):// 开头',
  E_PROVIDER_UNSUPPORTED: '这个平台还不支持',
  E_PROVIDER_NOT_CONFIGURED: '还没有保存这家服务商的凭据，先在设置里填入并保存',

  // 工作区与文件
  E_PATH_UNSAFE: '路径不合法，只能使用工作区内的相对路径',
  E_FILE_EMPTY: '文件是空的，没有可导入的内容',
  E_FILE_TOO_LARGE: '文件太大了，超过了单文件上限',
  E_FILE_EXISTS: '同名文件已存在，先删掉旧的再导入',
  E_SOURCE_UNREADABLE: '读不到源文件，可能已被移动或没有权限',
  E_WRITE_FAILED: '写入工作区失败，这次导入没有生效',

  // 备份
  E_BACKUP_NOT_JSON: '这不是有效的备份文件',
  E_BACKUP_SHAPE: '备份文件结构不对，可能已损坏',
  E_BACKUP_VERSION: '备份版本与当前程序不匹配',

  // 崩溃记录
  E_CRASH_LOG_WRITE_FAILED: '崩溃记录没能写进本地文件',

  // 计划与执行
  E_STEP_NEEDS_CONFIRMATION: '这一步风险较高，需要你确认后才会执行',
  E_PLAN_JSON_INVALID: '模型返回的计划不是有效 JSON，已重新尝试',
  E_STEP_NOT_FOUND: '找不到对应的步骤'
}

const FALLBACK = '出了点问题，可以重试一次；反复失败请查看本地日志'

export function describeError(code: string): string {
  return ERROR_MESSAGES[code] ?? FALLBACK
}
