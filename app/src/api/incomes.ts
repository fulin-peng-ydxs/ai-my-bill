import type { components } from './generated/schema'
import { entries, mutateEntry } from './localEntries'
import { localOperation } from '../data/localOperation'

export type CreateIncomeRequest = components['schemas']['CreateIncomeRequest']
export type IncomeResponse = components['schemas']['IncomeResponse']
export type UpdateIncomeRequest = components['schemas']['UpdateIncomeRequest']

export function listRecentIncomeNames(query: string, signal?: AbortSignal): Promise<{ items: string[] }> {
  return localOperation(() => entries.recentIncomeNames(query, signal))
}

export function createIncome(request: CreateIncomeRequest, key: string): Promise<IncomeResponse> {
  return mutateEntry(() => entries.createIncome(request, key))
}

export function getIncome(id: string, signal?: AbortSignal): Promise<IncomeResponse> {
  return localOperation(() => entries.getIncome(id, signal))
}

export function updateIncome(id: string, request: UpdateIncomeRequest, key: string): Promise<IncomeResponse> {
  return mutateEntry(() => entries.updateIncome(id, request, key))
}

export function undoCreatedIncome(id: string, key: string): Promise<void> {
  return mutateEntry(() => entries.undo('INCOME', id, key))
}
