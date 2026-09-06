import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  listDailyTemplates, removeDailyTemplate, selectDailyTemplate, upsertDailyTemplateFromLedger,
} from './dailyTemplates'

afterEach(() => vi.unstubAllGlobals())

describe('daily template api', () => {
  it('lists the requested entry type', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)

    await listDailyTemplates('EXPENSE')

    expect(fetch.mock.calls[0]?.[0]).toContain('/daily-templates?type=EXPENSE')
  })

  it('encodes identifiers for selection, removal and the reserved T14 upsert contract', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'template', entryType: 'EXPENSE',
        displayName: '咖啡', unavailableFields: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'template' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetch)

    await selectDailyTemplate('template/id')
    await removeDailyTemplate('template/id')
    await upsertDailyTemplateFromLedger('ledger/id')

    expect(fetch.mock.calls[0]?.[0]).toContain('/daily-templates/template%2Fid/select')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(fetch.mock.calls[1]?.[0]).toContain('/daily-templates/template%2Fid')
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' })
    expect(fetch.mock.calls[2]?.[0]).toContain('/ledger-entries/ledger%2Fid/daily-template')
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ method: 'PUT' })
  })
})
