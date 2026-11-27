import type { LedgerContracts } from '../domain/ledgerContracts'
import { entries, mutateEntry } from './localEntries'
import { appDatabase } from '../data/appDatabase'
import { ProductService } from '../data/dictionaries/productService'
import { localOperation } from '../data/localOperation'

const products = new ProductService(appDatabase)

export type CreateExpenseRequest = LedgerContracts['CreateExpenseRequest']
export type ExpenseResponse = LedgerContracts['ExpenseResponse']
export type UpdateExpenseRequest = LedgerContracts['UpdateExpenseRequest']
export type ProductSuggestion = LedgerContracts['ProductSuggestion']
export type ProductSuggestions = LedgerContracts['ProductSuggestions']

export function listExpenseProducts(query: string, signal?: AbortSignal): Promise<ProductSuggestions> {
  return localOperation(() => products.suggestions(query, signal))
}

export function createExpense(
  request: CreateExpenseRequest,
  idempotencyKey: string,
): Promise<ExpenseResponse> {
  return mutateEntry(() => entries.createExpense(request, idempotencyKey))
}

export function getExpense(expenseId: string, signal?: AbortSignal): Promise<ExpenseResponse> {
  return localOperation(() => entries.getExpense(expenseId, signal))
}

export function updateExpense(
  expenseId: string,
  request: UpdateExpenseRequest,
  idempotencyKey: string,
): Promise<ExpenseResponse> {
  return mutateEntry(() => entries.updateExpense(expenseId, request, idempotencyKey))
}

export function undoCreatedExpense(expenseId: string, idempotencyKey: string): Promise<void> {
  return mutateEntry(() => entries.undo('EXPENSE', expenseId, idempotencyKey))
}
