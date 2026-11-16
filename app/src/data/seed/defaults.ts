import { normalizedDictionaryName } from '../../domain/text'

export type SeedItem = Readonly<{ id: string; kind: string; name: string; key: string; order: number }>
export type Seed = Readonly<{ version: number; items: readonly SeedItem[]; preferences: Readonly<Record<string, unknown>> }>

/** 来源：旧 V006 已确认的八项收入分类；其他字典由原有管理入口维护。 */
export const defaultSeed: Seed = {
  version: 1,
  items: [
    ['salary', '工资'], ['bonus', '奖金'], ['part_time', '兼职'], ['business_income', '经营所得'],
    ['investment_income', '投资收益'], ['interest', '利息'], ['gift_and_red_packet', '礼金与红包'], ['other_income', '其他收入'],
  ].map(([key, name], index) => ({
    id: `61000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    kind: 'INCOME_CATEGORY', key, name, order: (index + 1) * 10,
  })),
  preferences: { defaultFundingChannelId: null, ledgerRange: 'TODAY', reportRange: 'THIS_MONTH', theme: 'SYSTEM', recentEntryType: 'EXPENSE' },
}

export function seedValues(item: SeedItem, version: number) {
  return [item.id, item.kind, item.name, normalizedDictionaryName(item.name), item.order, item.key, version]
}
