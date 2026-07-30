import { type } from 'arktype'
import { ComfyManagerPluginContentMetadata_ark } from 'src/manager/types/ComfyManagerPluginContentMetadata.ts'
import { ComfyManagerPluginContentNodeName_ark } from 'src/manager/types/ComfyManagerPluginEnums.ts'

/** ONE extension-node-map entry value: [nodeNames, meta]; the file root is a Record of these, validated row by row */
export type ComfyManagerExtensionNodeMapEntry = typeof ComfyManagerExtensionNodeMapEntry_ark.infer
export const ComfyManagerExtensionNodeMapEntry_ark = type([
   ComfyManagerPluginContentNodeName_ark.array(),
   ComfyManagerPluginContentMetadata_ark,
])
