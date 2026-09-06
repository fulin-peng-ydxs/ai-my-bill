import type { components } from './generated/schema'
import { apiRequest } from './http'

export type CreateExpenseRequest = components['schemas']['CreateExpenseRequest']
export type ExpenseResponse = components['schemas']['ExpenseResponse']
export type ProductSuggestion = components['schemas']['ProductSuggestion']
export type ProductSuggestions = components['schemas']['ProductSuggestions']

export function listExpenseProducts(query: string, signal?: AbortSignal): Promise<ProductSuggestions> {
  const params = new URLSearchParams({ query })
  return apiRequest(`/expenses/products?${params}`, { signal })
}

export function createExpense(
  request: CreateExpenseRequest,
  idempotencyKey: string,
): Promise<ExpenseResponse> {
  return apiRequest('/expenses', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(request),
  })
}

export function undoCreatedExpense(expenseId: string, idempotencyKey: string): Promise<void> {
  return apiRequest(`/expenses/${encodeURIComponent(expenseId)}/undo`, {
    method: 'DELETE', headers: { 'Idempotency-Key': idempotencyKey },
  })
}
