export const MONEY_MAX = '999999999.99'
export const UNIT_PRICE_MAX = '99999999.9999'
export const QUANTITY_MAX = '999999.999'

export const SQLITE_INTEGER_MAX = 9_223_372_036_854_775_807n
export const SQLITE_INTEGER_MIN = -9_223_372_036_854_775_808n

const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d+))?$/

function powerOfTen(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0) throw new RangeError('小数位数必须是非负整数。')
  return 10n ** BigInt(scale)
}

/** 将非负十进制字符串精确转换为定点整数，拒绝截断和二进制浮点输入。 */
export function decimalToScaledInteger(value: string, scale: number): bigint {
  if (typeof value !== 'string') throw new TypeError('必须提供规范的非负十进制字符串。')
  const match = DECIMAL_PATTERN.exec(value)
  if (!match) throw new TypeError('必须提供规范的非负十进制字符串。')
  const fraction = match[2] ?? ''
  if (fraction.length > scale) throw new RangeError(`最多允许 ${scale} 位小数。`)
  return BigInt(match[1]) * powerOfTen(scale) + BigInt(fraction.padEnd(scale, '0') || '0')
}

export function scaledIntegerToDecimal(value: bigint, scale: number): string {
  const divisor = powerOfTen(scale)
  const sign = value < 0n ? '-' : ''
  const absolute = value < 0n ? -value : value
  const integer = absolute / divisor
  if (scale === 0) return `${sign}${integer}`
  return `${sign}${integer}.${(absolute % divisor).toString().padStart(scale, '0')}`
}

/** 精确相乘并按 ROUND_HALF_UP 返回指定小数位，供金额计算统一复用。 */
export function multiplyDecimalHalfUp(
  left: string,
  leftScale: number,
  right: string,
  rightScale: number,
  resultScale: number,
): string {
  const product = decimalToScaledInteger(left, leftScale) * decimalToScaledInteger(right, rightScale)
  const productScale = leftScale + rightScale
  if (resultScale > productScale) {
    return scaledIntegerToDecimal(product * powerOfTen(resultScale - productScale), resultScale)
  }
  const divisor = powerOfTen(productScale - resultScale)
  const rounded = product / divisor + (product % divisor * 2n >= divisor ? 1n : 0n)
  return scaledIntegerToDecimal(rounded, resultScale)
}

export function isDecimalInRange(value: string, scale: number, maximum: string, positive = false): boolean {
  try {
    const scaled = decimalToScaledInteger(value, scale)
    return (!positive || scaled > 0n) && scaled <= decimalToScaledInteger(maximum, scale)
  } catch {
    return false
  }
}

/** 支出金额的共享领域口径；各写入边界均须调用并校验，不依赖表单计算结果。 */
export function calculateExpenseTotal(unitPrice: string, quantity: string): string {
  if (!isDecimalInRange(unitPrice, 4, UNIT_PRICE_MAX)) throw new RangeError('单价超出允许范围。')
  if (!isDecimalInRange(quantity, 3, QUANTITY_MAX, true)) throw new RangeError('数量超出允许范围。')
  const total = multiplyDecimalHalfUp(unitPrice, 4, quantity, 3, 2)
  if (!isDecimalInRange(total, 2, MONEY_MAX)) throw new RangeError('计算金额超出允许范围。')
  return total
}

/** 整数展示省略全零小数；有小数时保留原有精度，不参与金额计算。 */
export function formatDecimalDisplay(value: string): string {
  return value.replace(/\.0+$/, '')
}

export function formatCny(value: string, scale = 2): string {
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const scaled = decimalToScaledInteger(unsigned, scale)
  // 金额沿用分精度；单价保留传入的小数位，避免展示额外补零。
  const decimal = formatDecimalDisplay(scale === 2 ? scaledIntegerToDecimal(scaled, scale) : unsigned)
  const [integer, fraction] = decimal.split('.')
  return `${negative ? '-' : ''}¥${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`
}

/** 金额差值保持分为单位精确计算；负值说明业务上限已被越过。 */
export function subtractMoney(left: string, right: string): string {
  return scaledIntegerToDecimal(decimalToScaledInteger(left, 2) - decimalToScaledInteger(right, 2), 2)
}

/** SQLite 有符号 64 位整数统一通过字符串桥接，包含金额聚合；溢出明确拒绝。 */
export function toSqliteInteger(value: bigint): string {
  if (typeof value !== 'bigint') throw new TypeError('本地定点整数必须由 BigInt 提供。')
  if (value < SQLITE_INTEGER_MIN || value > SQLITE_INTEGER_MAX) throw new RangeError('本地整数超出 64 位范围。')
  return value.toString()
}

/** 金额/数量的查询必须 CAST AS TEXT；拒绝数字结果，防止先丢精度再转为字符串。 */
export function fromSqliteInteger(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(?:0|-?[1-9]\d*)$/.test(value)) {
    throw new TypeError('本地定点整数必须是规范的十进制字符串。')
  }
  if (value.length > 20) throw new RangeError('本地整数超出 64 位范围。')
  const integer = BigInt(value)
  toSqliteInteger(integer)
  return integer
}
