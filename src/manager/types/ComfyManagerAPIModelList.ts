import { type } from 'arktype'
import type { KnownModel_Name } from 'src/manager/generated/KnownModel_Name.ts'

export type ComfyManagerAPIModelList = typeof ComfyManagerAPIModelList_ark.infer
export const ComfyManagerAPIModelList_ark = type({
   models: type({
      name: type.string.as<KnownModel_Name>(),
      installed: `'False' | 'True' | 'Update'`,
   }).array(),
})
