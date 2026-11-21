/** 正有理数只用于量价统计；阈值比较不经过浮点或展示舍入。 */
export type Fraction = { n: bigint; d: bigint }
function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b]
  return a
}
export function fraction(n: bigint, d = 1n): Fraction {
  if (d <= 0n || n < 0n) throw new RangeError('报表比例必须为非负有理数。')
  const divisor = gcd(n, d)
  return { n: n / divisor, d: d / divisor }
}
export function compare(a: Fraction, b: Fraction): number {
  const difference = a.n * b.d - b.n * a.d
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}
export function plus(a: Fraction, b: Fraction): Fraction {
  const common = gcd(a.d, b.d)
  return fraction(a.n * (b.d / common) + b.n * (a.d / common), a.d * (b.d / common))
}
export function halfUp(n: bigint, d: bigint): bigint {
  return n / d + (n % d * 2n >= d ? 1n : 0n)
}
/** 平衡合并不同分母，避免顺序累加使大分母参与每一笔后续计算。 */
export class ExactMean {
  private readonly levels: (Fraction | undefined)[] = []
  count = 0
  add(value: Fraction): void {
    this.count++
    let level = 0
    while (this.levels[level]) {
      value = plus(this.levels[level]!, value)
      this.levels[level++] = undefined
    }
    this.levels[level] = value
  }
  cents(): bigint {
    const sum = this.levels.reduce<Fraction>((total, value) => value ? plus(total, value) : total, fraction(0n))
    return this.count ? halfUp(sum.n * 100n, sum.d * BigInt(this.count)) : 0n
  }
}

/** 压缩坐标 + Fenwick 计数：180 天滑窗的中位数更新/查询均为 O(log n)。 */
export class CostMedian {
  private readonly values: Fraction[]
  private readonly tree: number[]
  count = 0
  constructor(values: Fraction[]) {
    this.values = values.sort(compare).filter((value, index, all) => index === 0 || compare(value, all[index - 1]!) !== 0)
    this.tree = Array(this.values.length + 1).fill(0)
  }
  update(value: Fraction, delta: 1 | -1): void {
    let low = 0, high = this.values.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (compare(this.values[middle]!, value) < 0) low = middle + 1
      else high = middle
    }
    if (!this.values[low] || compare(this.values[low]!, value) !== 0) throw new Error('价格坐标不匹配。')
    for (let index = low + 1; index < this.tree.length; index += index & -index) this.tree[index]! += delta
    this.count += delta
  }
  private at(position: number): Fraction {
    let index = 0
    for (let step = 2 ** Math.floor(Math.log2(Math.max(1, this.values.length))); step; step >>>= 1) {
      const next = index + step
      if (next < this.tree.length && this.tree[next]! < position) {
        position -= this.tree[next]!
        index = next
      }
    }
    return this.values[index]!
  }
  median(): Fraction {
    if (!this.count) throw new Error('中位数缺少样本。')
    const pair = plus(this.at(Math.floor((this.count + 1) / 2)), this.at(Math.floor((this.count + 2) / 2)))
    return fraction(pair.n, pair.d * 2n)
  }
}
