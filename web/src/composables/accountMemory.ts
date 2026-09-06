type AccountCleanup = (accountId: string) => void

const cleanups = new Set<AccountCleanup>()

export function registerAccountMemoryCleanup(cleanup: AccountCleanup): () => void {
  cleanups.add(cleanup)
  return () => cleanups.delete(cleanup)
}

/** 退出或服务端身份变化时仅清内存；同账号下次登录仍可读取未过期草稿。 */
export function clearAccountMemory(accountId: string): void {
  cleanups.forEach((cleanup) => cleanup(accountId))
}
