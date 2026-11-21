import { reactive } from 'vue'
import { flushDrafts } from './draftLifecycle'
import { dataManagement } from '../data/management/dataManagement'
import { normalizeRequestError, type RequestError } from '../api/errors'

export const backupStatus = reactive({ error: undefined as RequestError | undefined })

/** 复用清理入口已经确认的 DOM/原生活跃资格，不再建立第二组前后台状态。 */
export async function snapshotForeground(signal: AbortSignal) {
  try {
    await flushDrafts(true)
    if (signal.aborted) return
    if (await dataManagement.daily(signal)) backupStatus.error = undefined
  } catch (cause) {
    if (!signal.aborted) backupStatus.error = normalizeRequestError(cause)
  }
}
