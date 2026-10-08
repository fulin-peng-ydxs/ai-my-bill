import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dictionarySourcePath, type DictionaryOrigin } from '../domain/dictionaryNavigation'

export function useDictionaryPanel(origin: DictionaryOrigin) {
  const route = useRoute()
  const router = useRouter()
  const path = dictionarySourcePath(origin)
  return computed({
    get: () => route.path === path && route.query.panel === 'dictionaries',
    set: (open: boolean) => {
      if (router.currentRoute.value.path !== path) return
      const query = { ...route.query }
      if (open) query.panel = 'dictionaries'
      else delete query.panel
      void router.replace({ path, query })
    },
  })
}
