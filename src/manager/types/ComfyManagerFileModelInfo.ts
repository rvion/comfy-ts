import { type } from 'arktype'
import type { ComfyManagerModelInfo } from 'src/manager/types/ComfyManagerModelInfo.ts'

/** root shape only: rows are validated ONE BY ONE against ComfyManagerModelInfo_ark */
export type ComfyManagerFileModelInfoRoot = typeof ComfyManagerFileModelInfoRoot_ark.infer
export const ComfyManagerFileModelInfoRoot_ark = type({ models: 'unknown[]' })

/** hand-maintained extras (model-list.extra.ts) still declare the full canonical shape */
export type ComfyManagerFileModelInfo = { models: ComfyManagerModelInfo[] }
