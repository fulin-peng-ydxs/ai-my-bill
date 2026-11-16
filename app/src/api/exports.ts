import type { LedgerFilters } from './ledgerEntries'
import type { components } from './generated/schema'
import { apiRequest } from './http'

export type ExportStatus = components['schemas']['ExportStatus']
export type ExportResponse = components['schemas']['ExportResponse']

export type ExportRequest = ({ scope: 'CURRENT_FILTERS' } & LedgerFilters) | { scope: 'ALL_DATA' }

export function createExport(request: ExportRequest, idempotencyKey: string): Promise<ExportResponse> {
  return apiRequest('/exports', {
    method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(request),
  })
}

export function getExport(id: string, signal?: AbortSignal): Promise<ExportResponse> {
  return apiRequest(`/exports/${id}`, { signal })
}

export function cancelExport(id: string): Promise<ExportResponse> {
  return apiRequest(`/exports/${id}/cancel`, { method: 'POST' })
}

export function downloadExport(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}
