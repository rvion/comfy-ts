import { type } from 'arktype'
import type { Tagged } from '../../types'

export type ComfyManagerPluginContentNodeName = Tagged<string, 'ComfyManagerPluginContentNodeName'>
export const ComfyManagerPluginContentNodeName_ark = type.string.as<ComfyManagerPluginContentNodeName>()

export type ComfyManagerPluginID = string
export const ComfyManagerPluginID_ark = type('string')
