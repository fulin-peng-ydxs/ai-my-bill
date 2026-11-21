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
    async replaceDataset(operation: () => Promise<unknown>): Promise<void> {
      // 先撤销页面/偏好的数据集归属，再卸载缓存；停用回调不能把旧草稿落到恢复后的账本。
      this.datasetId = ''
      this.status = 'loading'
      const preferences = usePreferencesStore()
      preferences.datasetId = ''
      preferences.generation++
      let failure: unknown
      try { await operation() }
      catch (cause) { failure = cause }
      await this.initialize()
      if ((this.status as 'loading' | 'ready' | 'error') !== 'ready') {
        throw new AggregateError([failure,this.error].filter(Boolean),'账本切换后重新打开未完成，请保留当前数据后重试。')
      }
      if (failure) throw failure
    },
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
