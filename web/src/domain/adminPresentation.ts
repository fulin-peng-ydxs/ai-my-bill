const ACTION_LABELS: Record<string, string> = {
  CREATE_USER: '创建用户',
  CHANGE_USER_STATUS: '变更账号状态',
  RESET_USER_PASSWORD: '重置用户密码',
  DELETE_USER_ACCOUNT: '注销用户账号',
  CREATE_DEFAULT_DICTIONARY: '新增默认字典',
  CHANGE_DEFAULT_DICTIONARY_STATUS: '变更默认字典状态',
  MOVE_DEFAULT_DICTIONARY: '调整默认字典排序',
}

const OBJECT_LABELS: Record<string, string> = {
  USER: '用户账号',
  ACCOUNT_DELETION: '账号注销',
  DEFAULT_DICTIONARY: '默认字典',
}

export function formatAdminTime(value?: string | null): string {
  return value
    ? new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai',
      }).format(new Date(value))
    : '尚无记录'
}

export function formatAdminBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '不可用'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`
}

export function adminActionLabel(value: string): string {
  return ACTION_LABELS[value] ?? value
}

export function adminObjectLabel(value: string): string {
  return OBJECT_LABELS[value] ?? value
}

export function auditChanges(summary: Record<string, unknown>): { field: string, before: string, after: string }[] {
  const changes = summary.changes
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return []
  return Object.entries(changes).flatMap(([field, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const change = raw as Record<string, unknown>
    return [{ field, before: displayValue(change.before), after: displayValue(change.after) }]
  })
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '无'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
