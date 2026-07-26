import type { KnownComfyCustomNodeName } from 'src/manager/generated/KnownComfyCustomNodeName.ts'
import type { KnownComfyPluginTitle } from 'src/manager/generated/KnownComfyPluginTitle.ts'
import type { KnownComfyPluginURL } from 'src/manager/generated/KnownComfyPluginURL.ts'
import type { KnownModel_Base } from 'src/manager/generated/KnownModel_Base.ts'
import type { KnownModel_Name } from 'src/manager/generated/KnownModel_Name.ts'
import type { ComfyManagerModelInfo } from 'src/manager/types/ComfyManagerModelInfo.ts'
import type { ComfyManagerPluginInfo } from 'src/manager/types/ComfyManagerPluginInfo.ts'

/**
 * comfyts-specific types to allow
 * 2024-03-13 rvion: TODO: split outside of this file, add a new type-level config for
 * project-specific FormNode metadata
 */
export type Requirements =
   // models
   | {
        type: 'modelInCivitai'
        civitaiModelId: string
        optional?: true
        base: KnownModel_Base
     }
   | {
        type: 'modelInManager'
        modelName: KnownModel_Name
        optional?: true
     }
   | {
        type: 'modelCustom'
        infos: ComfyManagerModelInfo
        optional?: true
     }

   // custom nodes
   | {
        type: 'customNodesByTitle'
        title: KnownComfyPluginTitle
        optional?: true
     }
   | {
        type: 'customNodesByURI'
        uri: KnownComfyPluginURL
        optional?: true
     }
   | {
        type: 'customNodesByNodeKey'
        nodeName: KnownComfyCustomNodeName
        optional?: true
     }

export type PluginInstallStatus = 'installed' | 'not-installed' | 'update-available' | 'unknown' | 'error'

export type PluginSuggestion = {
   reason: string
   plugin: ComfyManagerPluginInfo
}
