import { type } from 'arktype'
import type { KnownModel_Name } from '../generated/KnownModel_Name'

export type ComfyManagerAPIModelList = typeof ComfyManagerAPIModelList_ark.infer
export const ComfyManagerAPIModelList_ark = type({
   models: type({
      name: type.string.as<KnownModel_Name>(),
      installed: `'False' | 'True' | 'Update'`,
   }).array(),
})
