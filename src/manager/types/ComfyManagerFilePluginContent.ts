import { type } from 'arktype'
import { ComfyManagerPluginContentMetadata_ark } from 'src/manager/types/ComfyManagerPluginContentMetadata.ts'
import { ComfyManagerPluginContentNodeName_ark } from 'src/manager/types/ComfyManagerPluginEnums.ts'

export type ComfyManagerFilePluginContent = typeof ComfyManagerFilePluginContent_ark.infer
export const ComfyManagerFilePluginContent_ark = type.Record(
   'string',
   type([
      //
      ComfyManagerPluginContentNodeName_ark.array(),
      ComfyManagerPluginContentMetadata_ark,
   ]),
)
