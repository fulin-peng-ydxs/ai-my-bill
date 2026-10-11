import { createSSRApp, effectScope, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { ApiClientError } from '../api/http'
import { normalizeRequestError } from '../api/errors'
import { useLatestRequest } from '../composables/useLatestRequest'
import AppCandidateRegion from './AppCandidateRegion.vue'
import AppRequestError from './AppRequestError.vue'

async function renderCandidates(request: ReturnType<typeof useLatestRequest<string[]>>, preload: string[] = []): Promise<string> {
  const items = request.data.value ?? preload
  return renderToString(createSSRApp({ render: () => h(AppCandidateRegion, {
    status: request.status.value, error: request.error.value, hasCandidates: items.length > 0,
    loadingMessage: '正在查询', emptyMessage: '暂无候选',
  }, { default: () => h('ul', items.map((item) => h('li', item))) }) }))
}

describe('candidate region recovery', () => {
  it('does not misrepresent unrequested or pending candidates as empty', async () => {
    const scope = effectScope()
    const request = scope.run(() => useLatestRequest<string[]>())!
    expect(await renderCandidates(request)).not.toContain('暂无候选')
    expect(await renderCandidates(request, ['预载候选'])).toContain('预载候选')
    let complete!: (items: string[]) => void
    const pending = request.execute(() => new Promise((resolve) => { complete = resolve }), { isEmpty: (items) => !items.length })
    const loading = await renderCandidates(request, ['预载候选'])
    expect(loading).toContain('aria-busy="true"')
    expect(loading).not.toContain('暂无候选')
    expect(loading).not.toContain('预载候选')
    complete([])
    await pending
    expect(await renderCandidates(request)).toContain('暂无候选')
    scope.stop()
  })

  it.each([401, 403])('withdraws fallback candidates and empty feedback after access failure %i', async (status) => {
    const scope = effectScope()
    const request = scope.run(() => useLatestRequest<string[]>())!
    await request.execute(async () => { throw new ApiClientError(status, { code: 'DENIED', message: '无权查询', fieldErrors: {}, traceId: 'fixture', retryable: true }) })
    const result = await renderCandidates(request, ['受保护候选'])
    expect(result).toContain('data-error-kind="permission"')
    expect(result).not.toContain('受保护候选')
    expect(result).not.toContain('暂无候选')
    expect(result).not.toContain('重试')
    scope.stop()
  })

  it.each([false, true])('honors retryable=%s and replaces an error with recovered candidates', async (retryable) => {
    const scope = effectScope()
    const request = scope.run(() => useLatestRequest<string[]>())!
    await request.execute(async () => { throw new ApiClientError(503, { code: 'UNAVAILABLE', message: '查询失败', fieldErrors: {}, traceId: 'fixture', retryable }) })
    const error = await renderCandidates(request)
    expect(error).toContain('查询失败')
    expect(error).not.toContain('暂无候选')
    expect(error.includes('重试')).toBe(retryable)
    await request.execute(async () => ['成功候选'])
    const recovered = await renderCandidates(request)
    expect(recovered).toContain('成功候选')
    expect(recovered).not.toContain('查询失败')
    scope.stop()
  })

  it('lets a confirmation flow own its retry action without duplicating a button', async () => {
    const error = normalizeRequestError(new TypeError('offline'))
    const result = await renderToString(createSSRApp({ render: () => h(AppRequestError, {
      title: '恢复未完成', error, showRetry: false,
    }) }))
    expect(result).toContain('恢复未完成')
    expect(result).not.toContain('<button')
  })
})
