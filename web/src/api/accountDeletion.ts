import type { components } from './generated/schema'
import { apiRequest } from './http'

export type AccountDeletionResult = components['schemas']['AccountDeletionResult']

export function deleteCurrentAccount(confirmation: string): Promise<AccountDeletionResult> {
  return apiRequest<AccountDeletionResult>('/me/deletion', {
    method: 'POST',
    body: JSON.stringify({ confirmation }),
    timeoutMs: 60_000,
  })
}

export function deleteAdminAccount(accountId: string, version: number): Promise<AccountDeletionResult> {
  return apiRequest<AccountDeletionResult>(`/admin/users/${encodeURIComponent(accountId)}/deletion`, {
    method: 'POST',
    body: JSON.stringify({ version }),
    timeoutMs: 60_000,
  })
}
