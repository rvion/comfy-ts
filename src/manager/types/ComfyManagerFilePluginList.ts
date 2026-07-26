import { type } from 'arktype'
import { ComfyManagerPluginInfo_ark } from 'src/manager/types/ComfyManagerPluginInfo.ts'

export type ComfyManagerFilePluginList = typeof ComfyManagerFilePluginList_ark.infer
export const ComfyManagerFilePluginList_ark = type({ custom_nodes: ComfyManagerPluginInfo_ark.array() })
