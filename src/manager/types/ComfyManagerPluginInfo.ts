import { type } from 'arktype'
import type { KnownComfyPluginTitle } from 'src/manager/generated/KnownComfyPluginTitle.ts'
import type { KnownComfyPluginURL } from 'src/manager/generated/KnownComfyPluginURL.ts'
import type { ComfyManagerPluginID } from 'src/manager/types/ComfyManagerPluginEnums.ts'

/**
 * loose INPUT schema: what Comfy-Org/ComfyUI-Manager custom-node-list.json
 * actually ships (surveyed 2026-07-30, 5882 rows)
 */
export type ComfyManagerRawPluginInfo = typeof ComfyManagerRawPluginInfo_ark.infer
export const ComfyManagerRawPluginInfo_ark = type({
   // always present upstream
   author: 'string',
   title: type.string.as<KnownComfyPluginTitle>(),
   reference: 'string',
   files: type.string.as<KnownComfyPluginURL>().array(),
   install_type: 'string', // 'git-clone' | 'copy' | 'unzip' | stray casings
   description: 'string',

   // absent on 4471/5882 rows (2026-07-30): recovered at normalization
   'id?': type.string.as<ComfyManagerPluginID>(),

   // sparse optional tail
   'preemptions?': 'string[]',
   'pip?': 'string[]',
   'nodename_pattern?': 'string',
   'apt_dependency?': 'string[]',
   'js_path?': 'string',
   'version?': 'string',
   'tags?': 'string[]',

   // 2025/2026 additions, unconsumed but declared so drift stays visible
   'reference2?': 'string',
   'category?': 'string',
   'name?': 'string',
   'license?': 'string',
   'nickname?': 'string',
   'stars?': 'number',
   'last_update?': 'string',
   'badges?': 'string[]',
   'dependencies?': 'string[]',
})

/**
 * canonical plugin row: `id` ALWAYS present (normalization recovers it).
 * The optional tail stays optional ON PURPOSE: this object is also the
 * Manager v2 install POST body, where absent and null differ python-side.
 */
export type ComfyManagerPluginInfo = {
   id: ComfyManagerPluginID
   author: string
   title: KnownComfyPluginTitle
   reference: string
   files: KnownComfyPluginURL[]
   install_type: string
   description: string
   preemptions?: string[]
   pip?: string[]
   nodename_pattern?: string
   apt_dependency?: string[]
   js_path?: string
   version?: string
   tags?: string[]
}
