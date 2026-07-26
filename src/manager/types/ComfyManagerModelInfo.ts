import { type } from 'arktype'
import type { KnownModel_Base } from 'src/manager/generated/KnownModel_Base.ts'
import type { KnownModel_Name } from 'src/manager/generated/KnownModel_Name.ts'
import type { KnownModel_SavePath } from 'src/manager/generated/KnownModel_SavePath.ts'
import type { KnownModel_Type } from 'src/manager/generated/KnownModel_Type.ts'

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
