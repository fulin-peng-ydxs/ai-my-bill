import 'vue-router'

import type { PageRegistration } from '../app/pageRegistry'

declare module 'vue-router' {
  interface RouteMeta {
    pageKey?: PageRegistration['pageKey']
    role?: PageRegistration['role']
    requiresAuthentication?: boolean
  }
}

export {}
