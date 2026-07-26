import { type } from 'arktype'
import { ComfyManagerModelInfo_ark } from 'src/manager/types/ComfyManagerModelInfo.ts'

export type ComfyManagerFileModelInfo = typeof ComfyManagerFileModelInfo_ark.infer
export const ComfyManagerFileModelInfo_ark = type({ models: ComfyManagerModelInfo_ark.array() })
