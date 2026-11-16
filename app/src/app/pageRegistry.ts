export const pageStates = ['ready', 'loading', 'empty', 'error'] as const
export type PageState = typeof pageStates[number]
export interface PageRegistration {
  readonly pageKey: 'ledger-entry' | 'reports' | 'bill-details' | 'profile-settings' | 'personal-dictionaries' | 'personal-dictionary-detail'
  readonly title: string
  readonly path: string
  readonly navigation: 'primary' | 'none'
  readonly archetype: 'quick-entry' | 'dashboard' | 'list' | 'settings'
  readonly prototype: string
  readonly states: readonly PageState[]
}
export const pageRegistry = [
  {
    pageKey: 'ledger-entry',
    title: '记一笔',
    path: '/entry',
    navigation: 'primary',
    archetype: 'quick-entry',
    prototype: 'expense-entry.html',
    states: pageStates,
  },
  {
    pageKey: 'reports',
    title: '收支报表',
    path: '/reports',
    navigation: 'primary',
    archetype: 'dashboard',
    prototype: 'reports.html',
    states: pageStates,
  },
  {
    pageKey: 'bill-details',
    title: '收支明细',
    path: '/ledger',
    navigation: 'primary',
    archetype: 'list',
    prototype: 'bill-details.html',
    states: pageStates,
  },
  {
    pageKey: 'profile-settings',
    title: '我的',
    path: '/me',
    navigation: 'primary',
    archetype: 'settings',
    prototype: 'profile-settings.html',
    states: pageStates,
  },
  {
    pageKey: 'personal-dictionaries',
    title: '个人字典',
    path: '/me/dictionaries',
    navigation: 'none',
    archetype: 'settings',
    prototype: 'profile-settings.html',
    states: pageStates,
  },
  {
    pageKey: 'personal-dictionary-detail',
    title: '字典维护',
    path: '/me/dictionaries/:type',
    navigation: 'none',
    archetype: 'settings',
    prototype: 'profile-settings.html',
    states: pageStates,
  },
] as const satisfies readonly PageRegistration[]

export const primaryNavigationPages = pageRegistry.filter(page => page.navigation === 'primary')
