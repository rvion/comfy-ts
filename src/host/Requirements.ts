import type { KnownComfyCustomNodeName } from '../manager/generated/KnownComfyCustomNodeName'
import type { KnownComfyPluginTitle } from '../manager/generated/KnownComfyPluginTitle'
import type { KnownComfyPluginURL } from '../manager/generated/KnownComfyPluginURL'
import type { KnownModel_Base } from '../manager/generated/KnownModel_Base'
import type { KnownModel_Name } from '../manager/generated/KnownModel_Name'
import type { ComfyManagerModelInfo } from '../manager/types/ComfyManagerModelInfo'
import type { ComfyManagerPluginInfo } from '../manager/types/ComfyManagerPluginInfo'

/**
 * cushy-specific types to allow
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
        type: 'customNodesByNameInCushy'
        nodeName: KnownComfyCustomNodeName
        optional?: true
     }

export type PluginInstallStatus = 'installed' | 'not-installed' | 'update-available' | 'unknown' | 'error'

export type PluginSuggestion = {
   reason: string
   plugin: ComfyManagerPluginInfo
}
