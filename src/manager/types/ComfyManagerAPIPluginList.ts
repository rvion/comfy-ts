import { type } from 'arktype'
import type { KnownComfyPluginTitle } from 'src/manager/generated/KnownComfyPluginTitle.ts'

export type ComfyManagerAPIPluginList = typeof ComfyManagerAPIPluginList_ark.infer
export const ComfyManagerAPIPluginList_ark = type({
   custom_nodes: type({
      title: type.string.as<KnownComfyPluginTitle>(),
      installed: `'False' | 'True' | 'Update'`,
   }).array(),
   chanel: 'string',
})
