import type { components } from './generated/schema'
import { apiRequest } from './http'

export type CreateExpenseAdjustmentRequest = components['schemas']['CreateExpenseAdjustmentRequest']
export type ExpenseAdjustmentResponse = components['schemas']['ExpenseAdjustmentResponse']
export type ExpenseAdjustmentType = components['schemas']['ExpenseAdjustmentType']

export function createExpenseAdjustment(
  expenseId: string,
  request: CreateExpenseAdjustmentRequest,
  idempotencyKey: string,
): Promise<ExpenseAdjustmentResponse> {
  return apiRequest(`/ledger-entries/${encodeURIComponent(expenseId)}/adjustments`, {
    method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(request),
  })
}

export function getExpenseAdjustment(adjustmentId: string, signal?: AbortSignal): Promise<ExpenseAdjustmentResponse> {
  return apiRequest(`/adjustments/${encodeURIComponent(adjustmentId)}`, { signal })
}

export function revokeExpenseAdjustment(
  adjustmentId: string,
  version: number,
  idempotencyKey: string,
): Promise<ExpenseAdjustmentResponse> {
  return apiRequest(`/adjustments/${encodeURIComponent(adjustmentId)}/revoke`, {
    method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ version }),
  })
}
