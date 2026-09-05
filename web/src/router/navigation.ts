import type { Session } from '../stores/session'
import { pageRegistry } from '../app/pageRegistry'

export function homePathForRole(role: Session['role']): string {
  return role === 'ADMIN' ? '/admin' : '/entry'
}

/** 只恢复已登记且角色匹配的站内路径，拒绝把 redirect 变成开放跳转。 */
export function postLoginPath(session: Session, requested: unknown): string {
  if (typeof requested !== 'string' || !requested.startsWith('/') || requested.startsWith('//')) {
    return homePathForRole(session.role)
  }
  const path = requested.split(/[?#]/, 1)[0]
  const page = pageRegistry.find((candidate) => candidate.path === path)
  if (!page || page.role.toUpperCase() !== session.role) return homePathForRole(session.role)
  return requested
}
