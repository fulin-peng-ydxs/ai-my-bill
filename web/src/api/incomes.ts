import type { components } from './generated/schema'
import { apiRequest } from './http'

export type CreateIncomeRequest = components['schemas']['CreateIncomeRequest']
export type IncomeResponse = components['schemas']['IncomeResponse']

export function listRecentIncomeNames(query: string, signal?: AbortSignal): Promise<{ items: string[] }> {
  return apiRequest(`/incomes/names?${new URLSearchParams({ query })}`, { signal })
}

export function createIncome(request: CreateIncomeRequest, key: string): Promise<IncomeResponse> {
  return apiRequest('/incomes', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(request) })
}

export function undoCreatedIncome(id: string, key: string): Promise<void> {
  return apiRequest(`/incomes/${encodeURIComponent(id)}/undo`, { method: 'DELETE', headers: { 'Idempotency-Key': key } })
}
