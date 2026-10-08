import { dictionaryDefinitions } from './dictionaries'

const ACTION_LABELS: Record<string, string> = {
  BOOTSTRAP_ADMIN: '初始化管理员',
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

export const adminActionOptions = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))

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

const FIELD_LABELS: Record<string, string> = {
  username: '用户名', status: '状态', dictionaryType: '字典类型', direction: '排序方向',
}
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '正常', INACTIVE: '已停用', DISABLED: '已停用', PENDING_FIRST_LOGIN: '待首次登录',
  DELETION_PENDING: '注销处理中', DELETED: '已注销',
}

export function adminUserStatusLabel(value: string): string {
  return STATUS_LABELS[value] ?? value
}

export function auditChanges(summary: Record<string, unknown>, objectType?: string): { field: string, before: string, after: string }[] {
  const changes = summary.changes
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return []
  return Object.entries(changes).flatMap(([field, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const change = raw as Record<string, unknown>
    const format = (value: unknown) => {
      if (field === 'status' && typeof value === 'string') {
        if (value === 'ACTIVE' && objectType === 'DEFAULT_DICTIONARY') return '启用'
        return adminUserStatusLabel(value)
      }
      if (field === 'direction') return value === 'UP' ? '上移' : value === 'DOWN' ? '下移' : displayValue(value)
      if (field === 'dictionaryType' && typeof value === 'string') {
        return dictionaryDefinitions.find(item => item.type.toUpperCase().replaceAll('-', '_') === value || item.type === value)?.label ?? value
      }
      return displayValue(value)
    }
    return [{ field: FIELD_LABELS[field] ?? field, before: format(change.before), after: format(change.after) }]
  })
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '无'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** 运行概况统一消费服务端状态，不以存在历史成功时间掩盖本次失败。 */
export function adminBackupPresentation(status: string): { label: string, tone: string, detail: string } {
  switch (status) {
    case 'SUCCEEDED': return { label: '备份成功', tone: 'success', detail: '加密归档已校验；恢复能力以演练结果为准。' }
    case 'FAILED': return { label: '备份失败', tone: 'warning', detail: '最近一次备份失败，请检查主机备份服务日志。' }
    case 'RUNNING': return { label: '备份中', tone: 'warning', detail: '正在生成并校验归档。' }
    case 'STALE': return { label: '备份已超时', tone: 'warning', detail: '成功记录超过 26 小时或任务运行超过 1 小时，请检查调度。' }
    case 'UNCONFIGURED': return { label: '未配置', tone: 'warning', detail: '尚未接入备份状态。' }
    default: return { label: '状态不可用', tone: 'warning', detail: '无法读取有效状态，请检查主机备份服务。' }
  }
}
