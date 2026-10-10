import type { LedgerItem } from '../api/ledgerEntries'
import { formatDecimalDisplay } from './money'

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

/** 数量是服务端拼接摘要的首项；只格式化支出数量，避免改动付款方或单位名称。 */
export function formatLedgerCounterparty(item: Pick<LedgerItem, 'entryType' | 'counterpartyName'>): string {
  return item.entryType === 'EXPENSE'
    ? item.counterpartyName.replace(/^\d+(?:\.\d+)?(?= )/, formatDecimalDisplay)
    : item.counterpartyName
}
