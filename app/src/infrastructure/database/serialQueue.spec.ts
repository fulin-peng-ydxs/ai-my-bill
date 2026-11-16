import { describe, expect, it } from 'vitest'
import { SerialQueue } from './serialQueue'

function deferred() {
  let finish!: () => void
  const promise = new Promise<void>((resolve) => { finish = resolve })
  return { promise, finish }
}

describe('有界串行数据库操作', () => {
  it('前一个事务完全结束后才运行后一个，失败不阻塞队列', async () => {
    const queue = new SerialQueue()
    const gate = deferred()
    const events: string[] = []
    const first = queue.run(async () => { events.push('first'); await gate.promise; events.push('finished') })
    const second = queue.run(async () => { events.push('second'); throw new Error('expected failure') })
    const rejected = expect(second).rejects.toThrow('expected failure')
    const third = queue.run(async () => { events.push('third'); return 'saved' })
    expect(events).toEqual(['first'])
    gate.finish()
    await first
    await rejected
    expect(await third).toBe('saved')
    expect(events).toEqual(['first', 'finished', 'second', 'third'])
  })

  it('队列过载明确拒绝，取消排队项立即释放容量且不取消其他操作', async () => {
    const queue = new SerialQueue(2)
    const gate = deferred()
    const controller = new AbortController()
    const first = queue.run(() => gate.promise)
    let cancelledRan = false
    const second = queue.run(async () => { cancelledRan = true }, controller.signal)
    const rejected = expect(second).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    await expect(queue.run(async () => 'overflow')).rejects.toMatchObject({ code: 'DATABASE_BUSY', retryable: true })
    controller.abort()
    await rejected
    const third = queue.run(async () => 'next')
    gate.finish()
    await first
    expect(await third).toBe('next')
    expect(cancelledRan).toBe(false)
  })

  it('开始前已取消不运行任务，正在运行的操作在自身提交边界决定结果', async () => {
    const queue = new SerialQueue()
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(queue.run(async () => { throw new Error('should not run') }, cancelled.signal))
      .rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    const gate = deferred()
    const running = new AbortController()
    const result = queue.run(async () => { await gate.promise; return 'committed' }, running.signal)
    running.abort()
    gate.finish()
    expect(await result).toBe('committed')
  })
})
