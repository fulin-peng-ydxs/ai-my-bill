import type { PreferenceRequest } from '../domain/preferences'
import { PreferenceService } from '../data/personal/preferenceService'
import { appDatabase } from '../data/appDatabase'
import { localOperation } from '../data/localOperation'

const service = new PreferenceService(appDatabase)
export const getPreferences = (datasetId: string) => localOperation(() => service.read(datasetId))
export const savePreferences = (datasetId: string, patch: Partial<PreferenceRequest>) => localOperation(() => service.save(datasetId, patch))
export const resetPreferences = (datasetId: string) => localOperation(() => service.reset(datasetId))
