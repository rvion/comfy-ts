import { type } from 'arktype'
import type { KnownModel_Base } from '../generated/KnownModel_Base'
import type { KnownModel_Name } from '../generated/KnownModel_Name'
import type { KnownModel_SavePath } from '../generated/KnownModel_SavePath'
import type { KnownModel_Type } from '../generated/KnownModel_Type'

export type ComfyManagerModelInfo = typeof ComfyManagerModelInfo_ark.infer
export const ComfyManagerModelInfo_ark = type({
   name: type.string.as<KnownModel_Name>(), // e.g. "ip-adapter_sd15_light.safetensors",
   type: type.string.as<KnownModel_Type>(), // e.g. "IP-Adapter",
   base: type.string.as<KnownModel_Base>(), // e.g. "SD1.5",
   save_path: type.string.as<KnownModel_SavePath>(), // e.g. "ipadapter",
   description: 'string', // e.g. "You can use this model in the [a/ComfyUI IPAdapter plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) extension.",
   reference: 'string', // e.g. "https://huggingface.co/h94/IP-Adapter",
   filename: 'string', // e.g. "ip-adapter_sd15_light.safetensors",
   url: 'string', // e.g. "https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter_sd15_light.safetensors"
   'size?': 'string', // e.g.  "698.4MB"
})
