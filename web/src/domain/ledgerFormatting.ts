const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
})
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short',
})

/** 明细与后续报表共用上海业务时间展示，避免各组件重复创建 Intl formatter。 */
export function formatLedgerTime(value: string): string {
  return timeFormatter.format(new Date(value))
}

export function formatLedgerDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00+08:00`))
}
