import type { components } from './generated/schema'
import { AdjustmentService } from '../data/entries/adjustmentService'
import { appDatabase } from '../data/appDatabase'
import { useBootstrapStore } from '../stores/bootstrap'
import { localOperation } from '../data/localOperation'
import { mutateEntry } from './localEntries'
const service = new AdjustmentService(appDatabase)

export type CreateExpenseAdjustmentRequest = components['schemas']['CreateExpenseAdjustmentRequest']
export type ExpenseAdjustmentResponse = components['schemas']['ExpenseAdjustmentResponse']
export type ExpenseAdjustmentType = components['schemas']['ExpenseAdjustmentType']

export function createExpenseAdjustment(
  expenseId: string,
  request: CreateExpenseAdjustmentRequest,
  idempotencyKey: string,
): Promise<ExpenseAdjustmentResponse> {
  const dataset = useBootstrapStore().datasetId
  return mutateEntry(() => service.create(dataset, expenseId, request, idempotencyKey))
}

export function getExpenseAdjustment(adjustmentId: string, signal?: AbortSignal): Promise<ExpenseAdjustmentResponse> {
  const dataset = useBootstrapStore().datasetId
  return localOperation(() => service.get(dataset, adjustmentId, signal))
}

export function revokeExpenseAdjustment(
  adjustmentId: string,
  version: number,
  idempotencyKey: string,
): Promise<ExpenseAdjustmentResponse> {
  const dataset = useBootstrapStore().datasetId
  return mutateEntry(() => service.revoke(dataset, adjustmentId, version, idempotencyKey))
}
