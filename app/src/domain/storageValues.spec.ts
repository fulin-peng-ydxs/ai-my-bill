import { describe, expect, it } from 'vitest'
import {
  SQLITE_INTEGER_MAX, SQLITE_INTEGER_MIN, calculateExpenseTotal,
  fromSqliteInteger, scaledIntegerToDecimal, toSqliteInteger,
} from './money'
import { dictionaryDisplayName, normalizedDictionaryName, unicodeCodePointLength } from './text'
import { LocalError } from './localError'

describe('本地数据边界', () => {
  it('在桥两端保护大整数和 64 位上下限，拒绝数字及非规范格式', () => {
    for (const value of [SQLITE_INTEGER_MIN, -1n, 0n, 9007199254740993n, SQLITE_INTEGER_MAX]) {
      expect(fromSqliteInteger(toSqliteInteger(value))).toBe(value)
    }
    expect(() => toSqliteInteger(SQLITE_INTEGER_MAX + 1n)).toThrow('64 位')
    expect(() => toSqliteInteger(SQLITE_INTEGER_MIN - 1n)).toThrow('64 位')
    expect(() => toSqliteInteger(9007199254740993 as unknown as bigint)).toThrow('BigInt')
    expect(() => fromSqliteInteger('9'.repeat(1000))).toThrow('64 位')
    for (const value of [9007199254740993, null, '01', '-0', '+1', '1.0', '1e3', ' 1']) {
      expect(() => fromSqliteInteger(value)).toThrow()
    }
  })

  it('聚合跨过 JS 安全整数仍保持精确，支出计算沿用确认口径', () => {
    const sum = fromSqliteInteger('9007199254740993') + 1543n
    expect(toSqliteInteger(sum)).toBe('9007199254742536')
    expect(scaledIntegerToDecimal(sum, 2)).toBe('90071992547425.36')
    expect(calculateExpenseTotal('12.3456', '1.250')).toBe('15.43')
    expect(calculateExpenseTotal('0.0050', '1.000')).toBe('0.01')
  })

  it('名称规范化保持原有 Unicode、大小写与标点语义', () => {
    expect(dictionaryDisplayName('\u00a0现金\u3000')).toBe('现金')
    expect(normalizedDictionaryName(' Ａ　 B\tC ')).toBe('a b c')
    expect(normalizedDictionaryName('A-B')).not.toBe(normalizedDictionaryName('A B'))
    expect(normalizedDictionaryName('零钱')).not.toBe(normalizedDictionaryName('现金'))
    expect(unicodeCodePointLength('😀现𠮷')).toBe(3)
    expect(normalizedDictionaryName('\u200b现金')).toBe('\u200b现金')
  })

  it('错误序列化不暴露底层原因或堆栈，仍保留内部原因链', () => {
    const cause = new Error('sensitive storage details')
    const error = new LocalError('STORAGE_FAILED', '本地操作失败。', { cause, fieldErrors: [{ field: 'amount', message: '金额无效。' }] })
    expect(error.cause).toBe(cause)
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      traceId: error.traceId, code: 'STORAGE_FAILED', message: '本地操作失败。', retryable: false,
      fieldErrors: [{ field: 'amount', message: '金额无效。' }],
    })
  })
})
