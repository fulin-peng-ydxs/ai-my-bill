import { describe, expect, it } from 'vitest'

import { calculateExpenseTotal, decimalToScaledInteger, formatCny, formatDecimalDisplay, multiplyDecimalHalfUp, subtractMoney } from './money'

describe('exact decimal money helpers', () => {
  it('never accepts binary floating point or silently truncates decimals', () => {
    expect(decimalToScaledInteger('999999999.99', 2)).toBe(99_999_999_999n)
    expect(() => decimalToScaledInteger('1.001', 2)).toThrow('最多允许 2 位小数')
    expect(() => decimalToScaledInteger('-1', 2)).toThrow('非负十进制字符串')
    expect(() => decimalToScaledInteger(0.1 as unknown as string, 2)).toThrow('十进制字符串')
  })

  it('multiplies price and quantity with ROUND_HALF_UP', () => {
    expect(multiplyDecimalHalfUp('0.0050', 4, '1.000', 3, 2)).toBe('0.01')
    expect(multiplyDecimalHalfUp('12.3456', 4, '2.500', 3, 2)).toBe('30.86')
    expect(multiplyDecimalHalfUp('99999999.9999', 4, '1.000', 3, 2)).toBe('100000000.00')
  })

  it('formats CNY without converting through Number', () => {
    expect(formatCny('0')).toBe('¥0')
    expect(formatCny('18.00')).toBe('¥18')
    expect(formatCny('-1200.00')).toBe('-¥1,200')
    expect(formatCny('0.01')).toBe('¥0.01')
    expect(formatCny('12.3', 4)).toBe('¥12.3')
    expect(formatCny('12.3456', 4)).toBe('¥12.3456')
    expect(formatCny('18.0000', 4)).toBe('¥18')
    expect(formatCny('999999999.99')).toBe('¥999,999,999.99')
    expect(formatCny('-1234567890.50')).toBe('-¥1,234,567,890.50')
  })

  it('hides only all-zero fractional parts without losing precision or rewriting partial input', () => {
    expect(formatDecimalDisplay('9007199254740993.000')).toBe('9007199254740993')
    expect(formatDecimalDisplay('-1.000')).toBe('-1')
    expect(formatDecimalDisplay('0.00')).toBe('0')
    expect(formatDecimalDisplay('1.250')).toBe('1.250')
    expect(formatDecimalDisplay('1.')).toBe('1.')
    expect(formatDecimalDisplay('')).toBe('')
  })

  it('subtracts adjustment amounts without binary floating point drift', () => {
    expect(subtractMoney('100.00', '30.10')).toBe('69.90')
    expect(subtractMoney('30.00', '30.01')).toBe('-0.01')
  })

  it('enforces the confirmed price, quantity and total boundaries', () => {
    expect(calculateExpenseTotal('99999999.9999', '1.000')).toBe('100000000.00')
    expect(() => calculateExpenseTotal('100000000.0000', '1')).toThrow('单价超出允许范围')
    expect(() => calculateExpenseTotal('1', '0')).toThrow('数量超出允许范围')
    expect(() => calculateExpenseTotal('99999999.9999', '999999.999')).toThrow('计算金额超出允许范围')
  })
})
