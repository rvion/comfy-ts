import { type } from 'arktype'

/** root shape only: rows are validated ONE BY ONE against ComfyManagerRawPluginInfo_ark */
export type ComfyManagerFilePluginListRoot = typeof ComfyManagerFilePluginListRoot_ark.infer
export const ComfyManagerFilePluginListRoot_ark = type({ custom_nodes: 'unknown[]' })
