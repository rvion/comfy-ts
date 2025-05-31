import { type } from 'arktype'
import { ComfyManagerModelInfo_ark } from './ComfyManagerModelInfo'

export type ComfyManagerFileModelInfo = typeof ComfyManagerFileModelInfo_ark.infer
export const ComfyManagerFileModelInfo_ark = type({ models: ComfyManagerModelInfo_ark.array() })
