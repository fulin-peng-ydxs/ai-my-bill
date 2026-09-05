export const pageStates = ['ready', 'loading', 'empty', 'error'] as const

export type PageState = (typeof pageStates)[number]
export type PageRole = 'anonymous' | 'user' | 'admin'
export type PageNavigation = 'none' | 'primary' | 'admin'
export type PageArchetype = 'auth' | 'quick-entry' | 'dashboard' | 'list' | 'settings' | 'admin'

export interface PageRegistration {
  readonly pageKey: 'login' | 'ledger-entry' | 'reports' | 'bill-details' | 'profile-settings'
    | 'personal-dictionaries' | 'personal-dictionary-detail' | 'admin-console'
  readonly title: string
  readonly path: string
  readonly role: PageRole
  readonly navigation: PageNavigation
  readonly archetype: PageArchetype
  readonly prototype: string
  readonly states: readonly PageState[]
}

export const pageRegistry = [
  {
    pageKey: 'login',
    title: '登录与安装',
    path: '/login',
    role: 'anonymous',
    navigation: 'none',
    archetype: 'auth',
    prototype: 'login.html',
    states: pageStates,
  },
  {
    pageKey: 'ledger-entry',
    title: '记一笔',
    path: '/entry',
    role: 'user',
    navigation: 'primary',
    archetype: 'quick-entry',
    prototype: 'expense-entry.html',
    states: pageStates,
  },
  {
    pageKey: 'reports',
    title: '收支报表',
    path: '/reports',
    role: 'user',
    navigation: 'primary',
    archetype: 'dashboard',
    prototype: 'reports.html',
    states: pageStates,
  },
  {
    pageKey: 'bill-details',
    title: '收支明细',
    path: '/ledger',
    role: 'user',
    navigation: 'primary',
    archetype: 'list',
    prototype: 'bill-details.html',
    states: pageStates,
  },
  {
    pageKey: 'profile-settings',
    title: '我的',
    path: '/me',
    role: 'user',
    navigation: 'primary',
    archetype: 'settings',
    prototype: 'profile-settings.html',
    states: pageStates,
  },
  {
    pageKey: 'personal-dictionaries',
    title: '个人字典',
    path: '/me/dictionaries',
    role: 'user',
    navigation: 'none',
    archetype: 'settings',
    prototype: 'profile-settings.html',
    states: pageStates,
  },
  {
    pageKey: 'personal-dictionary-detail',
    title: '字典维护',
    path: '/me/dictionaries/:type',
    role: 'user',
    navigation: 'none',
    archetype: 'settings',
    prototype: 'profile-settings.html',
    states: pageStates,
  },
  {
    pageKey: 'admin-console',
    title: '系统管理',
    path: '/admin',
    role: 'admin',
    navigation: 'admin',
    archetype: 'admin',
    prototype: 'admin-console.html',
    states: pageStates,
  },
] as const satisfies readonly PageRegistration[]

export const primaryNavigationPages = pageRegistry.filter((page) => page.navigation === 'primary')
