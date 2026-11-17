import { defineStore } from 'pinia'
import { appDatabase } from '../data/appDatabase'
import { normalizeRequestError, type RequestError } from '../api/errors'
import { usePreferencesStore } from './preferences'

let opening: Promise<void> | undefined
/** 单一初始化入口；失败不挂载业务页、不重建库，重试复用正式生命周期。 */
export const useBootstrapStore = defineStore('bootstrap', {
  state: () => ({
    status: 'loading' as 'loading' | 'ready' | 'error',
    datasetId: '',
    error: undefined as RequestError | undefined,
  }),
  actions: {
    initialize(): Promise<void> {
      if (this.status === 'ready') {
        return Promise.resolve()
      }
      if (opening) {
        return opening
      }
      this.status = 'loading'
      this.error = undefined
      opening = (async () => {
        try {
          await appDatabase.open()
          this.datasetId = await appDatabase.read(async sql => (await sql.query('SELECT dataset_id FROM ledger_meta'))[0].dataset_id as string)
          await usePreferencesStore().initialize(this.datasetId)
          this.status = 'ready'
        } catch (error) {
          this.error = normalizeRequestError(error)
          this.status = 'error'
        } finally {
          opening = undefined
        }
      })()
      return opening
    },
  },
})
