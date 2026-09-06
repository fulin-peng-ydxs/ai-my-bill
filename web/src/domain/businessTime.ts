const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/

/** datetime-local 始终表达上海墙上时间，不受设备时区影响。 */
export function toShanghaiLocalDateTime(date = new Date()): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 16)
}

export function shanghaiLocalDateTimeToIso(value: string): string {
  if (!LOCAL_DATE_TIME.test(value)) throw new RangeError('无效的上海本地时间')
  const withSeconds = value.length === 16 ? `${value}:00` : value
  const instant = new Date(`${withSeconds}+08:00`)
  if (!Number.isFinite(instant.getTime())) throw new RangeError('无效的上海本地时间')
  const roundTrip = new Date(instant.getTime() + SHANGHAI_OFFSET_MS).toISOString()
    .slice(0, withSeconds.length)
  if (roundTrip !== withSeconds) throw new RangeError('无效的上海本地时间')
  return instant.toISOString()
}

export function isShanghaiLocalDateTime(value: string): boolean {
  try { shanghaiLocalDateTimeToIso(value); return true } catch { return false }
}

export function formatShanghaiDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value))
}
