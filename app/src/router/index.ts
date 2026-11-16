import { createRouter, createMemoryHistory } from 'vue-router'
import { pageRegistry } from '../app/pageRegistry'
import Entry from '../views/LedgerEntryPreferenceView.vue'
import Profile from '../views/ProfileView.vue'
import Ledger from '../views/LedgerView.vue'

import Index from '../views/me/dictionaries/DictionaryIndexView.vue'
import Detail from '../views/me/dictionaries/DictionaryDetailView.vue'
const pages = { 'ledger-entry': Entry, reports: () => import('../views/ReportView.vue'), 'bill-details': Ledger, 'profile-settings': Profile,
 'personal-dictionaries': Index, 'personal-dictionary-detail': Detail }
export const routes = [{ path: '/', redirect: '/entry' }, ...pageRegistry.map(page => ({ path: page.path, name: page.pageKey, component: pages[page.pageKey], props: { page }, meta: { pageKey: page.pageKey } })), { path: '/:pathMatch(.*)*', redirect: '/entry' }]
export default createRouter({ history: createMemoryHistory(), routes })
