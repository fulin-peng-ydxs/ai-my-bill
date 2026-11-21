import type { LedgerFilters } from './ledgerEntries'
import type { components } from './generated/schema'
import { dataManagement } from '../data/management/dataManagement'
import { appDatabase } from '../data/appDatabase'
import { ledgerTransfers } from '../platform/ledgerTransfers'
import { LocalError, throwIfCancelled } from '../domain/localError'
import { localOperation } from '../data/localOperation'

export type ExportStatus = components['schemas']['ExportStatus']
export type ExportResponse = components['schemas']['ExportResponse']
export type ExportRequest = ({ scope: 'CURRENT_FILTERS' } & LedgerFilters) | { scope: 'ALL_DATA' }
type Job = { response: ExportResponse; input: string; dataset: string; controller: AbortController; transfer?: string; done: Promise<void> }
const jobs = new Map<string, Job>()

async function dataset() {
  return String((await appDatabase.read(sql => sql.query('SELECT dataset_id FROM ledger_meta')))[0].dataset_id)
}

/** 保留原组件的任务/取消协议，执行与文件均在本机；不建立后台服务器或下载 URL。 */
export function createExport(request: ExportRequest, idempotencyKey: string): Promise<ExportResponse> {
  return localOperation(async () => {
    if (!['CURRENT_FILTERS','ALL_DATA'].includes(request.scope)) throw new LocalError('EXPORT_INVALID','请选择有效导出范围。')
    const current = await dataset(), old = jobs.get(idempotencyKey), input = JSON.stringify(request)
    if (old) {
      if (old.input !== input || old.dataset !== current) throw new LocalError('IDEMPOTENCY_CONFLICT','导出范围已改变，请重新导出。')
      return { ...old.response }
    }
    if (jobs.size >= 8) throw new LocalError('EXPORT_BUSY','请先完成当前导出。',{ retryable: true })
    const response: ExportResponse = { id: idempotencyKey,scope: request.scope,status: 'RUNNING',rowCount: 0,
      createdAt: new Date().toISOString(),expiresAt: new Date(Date.now()+3600_000).toISOString() }
    const job: Job = { response,input,dataset: current,controller: new AbortController(),done: Promise.resolve() }
    jobs.set(idempotencyKey,job)
    job.done = (async () => {
      try {
        const result = await dataManagement.exportCsv(request,job.controller.signal)
        job.transfer = result.id
        response.rowCount = result.rows
        response.downloadUrl = 'native-export:' + result.id
        response.status = 'SUCCEEDED'
      } catch (cause) {
        response.status = job.controller.signal.aborted ? 'CANCELLED' : 'FAILED'
        response.errorMessage = cause instanceof LocalError ? cause.message : '导出未完成，请重试；账本未改变。'
      }
    })()
    return { ...response }
  })
}

export async function getExport(id: string, signal?: AbortSignal): Promise<ExportResponse> {
  throwIfCancelled(signal)
  const job = jobs.get(id)
  if (!job) throw new LocalError('EXPORT_EXPIRED','导出任务已过期，请重新导出。',{ retryable: true })
  if (job.dataset !== await dataset()) {
    await cancelExport(id)
    return { ...job.response,status: 'EXPIRED',downloadUrl: undefined }
  }
  throwIfCancelled(signal)
  const result = { ...job.response }
  if (['FAILED','CANCELLED'].includes(result.status) || result.status === 'SUCCEEDED' && result.rowCount === 0) {
    if (job.transfer) await ledgerTransfers.discardTransfer({ id: job.transfer })
    jobs.delete(id)
  }
  return result
}

export async function cancelExport(id: string): Promise<ExportResponse> {
  const job = jobs.get(id)
  if (!job) throw new LocalError('EXPORT_EXPIRED','导出任务已过期。')
  job.controller.abort()
  await job.done
  job.response.status = 'CANCELLED'
  job.response.downloadUrl = undefined
  jobs.delete(id)
  if (job.transfer) await ledgerTransfers.discardTransfer({ id: job.transfer })
  return { ...job.response }
}

export async function downloadExport(url: string, filename: string): Promise<boolean> {
  const job = [...jobs.values()].find(value => value.response.downloadUrl === url)
  if (!job?.transfer || job.dataset !== await dataset()) throw new LocalError('EXPORT_EXPIRED','导出范围已失效，请重新导出。')
  let failure: unknown
  try {
    const result = await ledgerTransfers.saveTransfer({ id: job.transfer,filename })
    return result.saved
  } catch (cause) { failure = cause; throw cause }
  finally {
    jobs.delete(job.response.id)
    try { await ledgerTransfers.discardTransfer({ id: job.transfer }) }
    catch (cleanup) {
      if (failure) throw new AggregateError([failure,cleanup],'文件保存失败且临时文件清理未完成。')
      throw cleanup
    }
  }
}
