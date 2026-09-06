import type { components } from './generated/schema'
import { apiRequest } from './http'

export type AdminUser = components['schemas']['AdminUser']
export type AdminUserPage = components['schemas']['AdminUserPage']
export type AdminUserStatus = components['schemas']['AdminUserStatus']
export type TemporaryCredential = components['schemas']['TemporaryCredentialResponse']

export function listAdminUsers(
  query: string,
  status: AdminUserStatus | '',
  signal?: AbortSignal,
): Promise<AdminUserPage> {
  const params = new URLSearchParams({ query, page: '0', size: '50' })
  if (status) params.set('status', status)
  return apiRequest<AdminUserPage>(`/admin/users?${params}`, { signal })
}

export function createAdminUser(username: string): Promise<TemporaryCredential> {
  return apiRequest<TemporaryCredential>('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username }),
  })
}

export function mutateAdminUser(
  user: AdminUser,
  action: 'disable' | 'restore' | 'reset-password',
): Promise<AdminUser | TemporaryCredential> {
  return apiRequest(`/admin/users/${encodeURIComponent(user.accountId)}/${action}`, {
    method: 'POST',
    body: JSON.stringify({ version: user.version }),
  })
}
