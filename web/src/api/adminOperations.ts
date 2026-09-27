import type { components } from './generated/schema'
import { apiRequest } from './http'

export type AdminOverview = components['schemas']['AdminOverview']
export type AdminAuditLogItem = components['schemas']['AdminAuditLogItem']
export type AdminAuditLogPage = components['schemas']['AdminAuditLogPage']
export type AdminAuditResult = components['schemas']['AdminAuditResult']
export type AdminAuditPeriod = components['schemas']['AdminAuditPeriod']

export interface AdminAuditFilters {
  administrator: string
  action: string
  object: string
  result: AdminAuditResult | ''
  period: AdminAuditPeriod
  page: number
}

export function getAdminOverview(signal?: AbortSignal): Promise<AdminOverview> {
  return apiRequest('/admin/overview', { signal })
}

export function listAdminAuditLogs(filters: AdminAuditFilters, signal?: AbortSignal): Promise<AdminAuditLogPage> {
  const params = new URLSearchParams({
    administrator: filters.administrator,
    action: filters.action,
    object: filters.object,
    period: filters.period,
    page: String(filters.page),
    size: '50',
  })
  if (filters.result) params.set('result', filters.result)
  return apiRequest(`/admin/audit-logs?${params}`, { signal })
}
