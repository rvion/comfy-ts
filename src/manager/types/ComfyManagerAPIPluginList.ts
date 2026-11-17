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

/** one pack as `GET customnode/getlist` serves it (Manager V3 and 4.x legacy UI); the install body is this row */
export type ComfyManagerAPIPack = typeof ComfyManagerAPIPack_ark.infer
export const ComfyManagerAPIPack_ark = type({
   title: type.string.as<KnownComfyPluginTitle>(),
   'id?': 'string',
   'files?': 'string[]',
   'repository?': 'string',
   'version?': 'string',
   'state?': 'string',
   'update-state?': 'string',
})

/** the getlist wire shape since Manager V3: packs keyed by their install key */
export type ComfyManagerAPIPackList = typeof ComfyManagerAPIPackList_ark.infer
export const ComfyManagerAPIPackList_ark = type({
   channel: 'string',
   node_packs: type.Record('string', ComfyManagerAPIPack_ark),
})
