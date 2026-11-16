import { describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ query: vi.fn(), run: vi.fn() }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => bridge }))
import { NativeDatabase } from './nativeAdapter'

describe('SQLite 原生返回协议', () => {
  it('按 ios_columns 恢复列序，移除描述行且不转换精确整数或空值', async () => {
    bridge.query.mockResolvedValue({ values: [
      { ios_columns: ['id', 'cents', 'note'] },
      { note: null, cents: '9007199254740993', id: 'controlled' },
    ] })
    const result = await new NativeDatabase('controlled').query('SELECT id,cents,note FROM sample')
    expect(result.values).toEqual([{ id: 'controlled', cents: '9007199254740993', note: null }])
    expect(Object.keys(result.values![0])).toEqual(['id', 'cents', 'note'])
  })

  it('无描述行和空结果仍保留查询语义，原生失败继续拒绝', async () => {
    bridge.query.mockResolvedValueOnce({ values: [{ value: '0' }] })
      .mockResolvedValueOnce({ values: [{ ios_columns: ['value'] }] })
      .mockRejectedValueOnce(new Error('controlled-native-failure'))
    const database = new NativeDatabase('controlled')
    expect((await database.query('SELECT value')).values).toEqual([{ value: '0' }])
    expect((await database.query('SELECT value WHERE 0')).values).toEqual([])
    await expect(database.query('controlled failure')).rejects.toThrow('controlled-native-failure')
  })
})
