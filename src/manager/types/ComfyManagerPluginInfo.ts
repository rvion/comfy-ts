import { type } from 'arktype'
import type { KnownComfyPluginTitle } from '../generated/KnownComfyPluginTitle'
import type { KnownComfyPluginURL } from '../generated/KnownComfyPluginURL'
import type { ComfyManagerPluginID } from './ComfyManagerPluginEnums'

// #region valibot
export type ComfyManagerPluginInfo = typeof ComfyManagerPluginInfo_ark.infer
export const ComfyManagerPluginInfo_ark = type({
   // required
   author: 'string', // "Dr.Lt.Data",
   title: type.string.as<KnownComfyPluginTitle>(), // "ComfyUI-Manager",
   reference: 'string', // "https://github.com/ltdrdata/ComfyUI-Manager",
   files: type.string.as<KnownComfyPluginURL>().array(), // ["https://github.com/ltdrdata/ComfyUI-Manager"],
   install_type: 'string', // "git-clone",
   description: 'string', // "ComfyUI-Manager itself is also a custom node."

   // optional, but shouldn't, so they'll pre-emptively auto-fixed before validation
   id: type.string.as<ComfyManagerPluginID>(), // on 2024-11-09, 579 fields are missing this

   // optional
   'preemptions?': 'string[]',
   'pip?': 'string[]',
   'nodename_pattern?': 'string',
   'apt_dependency?': 'string[]',
   'js_path?': 'string',
   'version?': 'string',

   // optional ?
   // (probably not really well specified, sicne some of those only appear one or two times)
   'tags?': 'string[]', // 🔶 as of 2024-11-09, this shows only one time
})

// export type ComfyManagerPluginInfo = {
//    // required
//    author: string // "Dr.Lt.Data",
//    title: KnownComfyPluginTitle // "ComfyUI-Manager",
//    reference: string // "https://github.com/ltdrdata/ComfyUI-Manager",
//    files: KnownComfyPluginURL[] // ["https://github.com/ltdrdata/ComfyUI-Manager"],
//    install_type: string // "git-clone",
//    description: string // "ComfyUI-Manager itself is also a custom node."

//    // optional, but shouldn't
//    // optional
//    id?: ComfyManagerPluginID // Added in 2024-??
//    preemptions?: string[] // ❓
//    pip?: string[] // [ "ultralytics" ],
//    nodename_pattern?: string // "Inspire$",
//    apt_dependency?: string[] // [ "rustc", "cargo" ],
//    js_path?: string // "strimmlarn",
//    version?: string
// }
