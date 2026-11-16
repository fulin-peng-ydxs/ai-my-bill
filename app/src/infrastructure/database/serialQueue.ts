import { LocalError, throwIfCancelled } from '../../domain/localError'

type Job = {
  start: () => Promise<void>
  cancel: () => void
}

/** 同一 SQLite 连接的读写/生命周期共用有界队列，避免异步回调混入其他事务。 */
export class SerialQueue {
  private readonly pending: Job[] = []
  private active = false

  constructor(private readonly capacity = 32) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('队列容量必须是正整数。')
    }
  }

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      throwIfCancelled(signal)
    } catch (error) {
      return Promise.reject(error)
    }
    if (this.pending.length + Number(this.active) >= this.capacity) {
      return Promise.reject(new LocalError('DATABASE_BUSY', '本地操作较多，请稍后重试。', { retryable: true }))
    }

    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        start: async () => {
          signal?.removeEventListener('abort', job.cancel)
          try {
            throwIfCancelled(signal)
            // 运行后的取消由事务/文件操作在其安全边界处理；队列不抢先报告取消。
            resolve(await task())
          } catch (error) {
            reject(error)
          } finally {
            this.active = false
            this.startNext()
          }
        },
        cancel: () => {
          const index = this.pending.indexOf(job)
          if (index < 0) {
            return
          }
          this.pending.splice(index, 1)
          signal?.removeEventListener('abort', job.cancel)
          reject(new LocalError('OPERATION_CANCELLED', '操作已取消。'))
        },
      }
      this.pending.push(job)
      signal?.addEventListener('abort', job.cancel, { once: true })
      this.startNext()
    })
  }

  private startNext(): void {
    if (this.active) {
      return
    }
    const job = this.pending.shift()
    if (!job) {
      return
    }
    this.active = true
    void job.start()
  }
}
