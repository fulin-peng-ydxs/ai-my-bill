import { createSSRApp, effectScope, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { ApiClientError } from '../api/http'
import { useLatestRequest } from '../composables/useLatestRequest'
import AppAsyncRegion from './AppAsyncRegion.vue'
import AppRequestError from './AppRequestError.vue'
import DictionaryToolbar from './DictionaryToolbar.vue'
import { normalizeRequestError } from '../api/errors'

async function renderRegion(request: ReturnType<typeof useLatestRequest<string[]>>): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(AppAsyncRegion, {
    status: request.status.value, error: request.error.value, staleWarning: request.staleWarning.value,
    refreshing: request.refreshing.value, emptyTitle: '没有记录', emptyActionLabel: '记一笔',
  }, { default: () => h('div', request.data.value?.join('、')) }) }))
}

describe('async region recovery', () => {
  it('renders one blocking state and keeps usable results during a failed background refresh', async () => {
    const scope = effectScope()
    const request = scope.run(() => useLatestRequest<string[]>())!
    let finish!: (items: string[]) => void
    const first = request.execute(() => new Promise((resolve) => { finish = resolve }))
    const loading = await renderRegion(request)
    expect(loading).toContain('aria-busy="true"')
    expect(loading).not.toContain('没有记录')
    finish(['已有记录'])
    await first
    expect(await renderRegion(request)).toContain('已有记录')
    await request.execute(async () => { throw new TypeError('offline') }, { intent: 'silent' })
    const degraded = await renderRegion(request)
    expect(degraded).toContain('已有记录')
    expect(degraded).toContain('status-notice')
    expect(degraded).not.toContain('state-block-error')
    await request.execute(async () => ['更新后的记录'], { intent: 'silent' })
    const recovered = await renderRegion(request)
    expect(recovered).toContain('更新后的记录')
    expect(recovered).not.toContain('status-notice')
    scope.stop()
  })

  it.each([401, 403])('withdraws cached data and suppresses retry after access failure %i', async (status) => {
    const scope = effectScope()
    const request = scope.run(() => useLatestRequest<string[]>())!
    await request.execute(async () => ['受保护的记录'])
    await request.execute(async () => { throw new ApiClientError(status, { code: 'DENIED', message: '无法访问', fieldErrors: {}, traceId: 'fixture', retryable: true }) }, { intent: 'silent' })
    const result = await renderRegion(request)
    expect(result).toContain('state-block-permission')
    expect(result).not.toContain('受保护的记录')
    expect(result).not.toContain('<button')
    expect(result).not.toContain('没有记录')
    scope.stop()
  })

  it('shows empty only after success, and replaces old results after failed new criteria', async () => {
    const scope = effectScope()
    const request = scope.run(() => useLatestRequest<string[]>())!
    expect(await renderRegion(request)).not.toContain('没有记录')
    await request.execute(async () => [], { isEmpty: (items) => !items.length })
    expect(await renderRegion(request)).toContain('没有记录')
    expect(await renderRegion(request)).toContain('记一笔')
    await request.execute(async () => ['旧条件结果'])
    await request.execute(async () => { throw new TypeError('offline') })
    const error = await renderRegion(request)
    expect(error).toContain('state-block-error')
    expect(error).toContain('重试')
    expect(error).not.toContain('旧条件结果')
    scope.stop()
  })

  it.each([true, false])('respects retryable=%s for an ordinary service failure', async (retryable) => {
    const error = normalizeRequestError(new ApiClientError(503, { code: 'UNAVAILABLE', message: '服务暂不可用', fieldErrors: {}, traceId: 'fixture', retryable }))
    const result = await renderToString(createSSRApp({ render: () => h(AppRequestError, { error, title: '加载失败' }) }))
    expect(result.includes('<button')).toBe(retryable)
  })

  it('does not represent an unknown count as zero', async () => {
    const render = (total?: number) => renderToString(createSSRApp({ render: () => h(DictionaryToolbar, { label: '分类', total, refreshing: false, query: '', status: '' }) }))
    expect(await render()).not.toContain('共 0 项')
    expect(await render(0)).toContain('共 0 项')
    expect(await render(12)).toContain('共 12 项')
  })
})
