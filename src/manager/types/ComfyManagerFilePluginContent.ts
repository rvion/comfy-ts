import { type } from 'arktype'
import { ComfyManagerPluginContentMetadata_ark } from './ComfyManagerPluginContentMetadata'
import { ComfyManagerPluginContentNodeName_ark } from './ComfyManagerPluginEnums'

export type ComfyManagerFilePluginContent = typeof ComfyManagerFilePluginContent_ark.infer
export const ComfyManagerFilePluginContent_ark = type.Record(
   'string',
   type([
      //
      ComfyManagerPluginContentNodeName_ark.array(),
      ComfyManagerPluginContentMetadata_ark,
   ]),
)
