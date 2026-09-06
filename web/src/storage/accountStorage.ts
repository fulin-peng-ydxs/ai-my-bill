const STORAGE_PREFIX = 'my-bill:account:v1:'
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const KNOWN_SCOPES = ['draft:EXPENSE', 'draft:INCOME', 'preferences'] as const

export type AccountStorageScope = (typeof KNOWN_SCOPES)[number]

async function namespace(accountId: string): Promise<string | undefined> {
  if (!ACCOUNT_ID_PATTERN.test(accountId) || !globalThis.crypto?.subtle) return undefined
  const source = new TextEncoder().encode(`my-bill/account/v1/${accountId.toLowerCase()}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function storageKey(accountId: string, scope: AccountStorageScope): Promise<string | undefined> {
  const accountNamespace = await namespace(accountId)
  return accountNamespace ? `${STORAGE_PREFIX}${accountNamespace}:${scope}` : undefined
}

/** 只按服务端当前账号推导不可逆键，不扫描 localStorage，也不把账号标识写入值。 */
export async function readAccountStorage(accountId: string, scope: AccountStorageScope): Promise<string | undefined> {
  const key = await storageKey(accountId, scope)
  if (!key || typeof localStorage === 'undefined') return undefined
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

export async function writeAccountStorage(
  accountId: string,
  scope: AccountStorageScope,
  value: string,
): Promise<boolean> {
  const key = await storageKey(accountId, scope)
  if (!key || typeof localStorage === 'undefined') return false
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export async function removeAccountStorage(accountId: string, scope: AccountStorageScope): Promise<void> {
  const key = await storageKey(accountId, scope)
  if (!key || typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(key)
  } catch {
    // 存储不可用时无需阻断账号退出或注销。
  }
}

/** 账号注销完成后由注销流程调用；仅删除该账号的已知键，不枚举其他账号。 */
export async function clearAccountStorage(accountId: string): Promise<void> {
  await Promise.all(KNOWN_SCOPES.map((scope) => removeAccountStorage(accountId, scope)))
}
