import chalk from 'chalk'
import type { NodeNameInComfy, NodeNameInCushy } from '../sdk-generator/comfyui-types'
import type { KnownComfyCustomNodeName } from './generated/KnownComfyCustomNodeName'
import type { KnownComfyPluginTitle } from './generated/KnownComfyPluginTitle'
import type { KnownComfyPluginURL } from './generated/KnownComfyPluginURL'
import type { KnownModel_Name } from './generated/KnownModel_Name'
import { DownloadComfyManagerJSONs } from './loaders/step1_downloadComfyManagerJSONs'
import { _getKnownPlugins } from './loaders/step2_custom-node-list-loader'
import { _getCustomNodeRegistry } from './loaders/step3_extension-node-map-loader'
import { _getKnownModels } from './loaders/step4_model-list-loader'
import type { ComfyManagerModelInfo } from './types/ComfyManagerModelInfo'
import type { ComfyManagerPluginInfo } from './types/ComfyManagerPluginInfo'

const log = (...args: unknown[]) => console.log(`[📘 registry]`, ...args)

export class ComfyRegistry {
   // plugins, indexed
   plugins_byTitle = new Map<KnownComfyPluginTitle, ComfyManagerPluginInfo>()
   plugins_byFile = new Map<KnownComfyPluginURL, ComfyManagerPluginInfo>()
   plugins_byNodeNameInComfy = new Map<NodeNameInComfy, ComfyManagerPluginInfo[]>()
   plugins_byNodeNameInCushy = new Map<NodeNameInCushy, ComfyManagerPluginInfo[]>()

   // custom nodes
   customNodes_byPluginName = new Map<KnownComfyPluginTitle, KnownComfyCustomNodeName[]>()

   // Models
   knownModels = new Map<KnownModel_Name, ComfyManagerModelInfo>()

   static async DownloadAndUpdate(download: boolean): Promise<ComfyRegistry> {
      if (download) {
         log(chalk.bold(`1. Downloading comfy-manager JSONs...`))
         await DownloadComfyManagerJSONs()
      } else {
         log(`1. Downloading comfy-manager JSONs... ${chalk.bold('[SKIPPED]')}`)
      }
      // should take care of the code generation
      return new ComfyRegistry({
         check: true,
         genTypes: true,
      })
   }

   constructor(
      public opts: {
         check?: boolean
         genTypes?: boolean
      } = {},
   ) {
      this.plugins_byFile.set('https://github.com/comfyanonymous/ComfyUI' as any, {
         id: 'nodes',
         author: 'comfyanonymous',
         description: 'built-in',
         title: 'built-in' as any,
         files: [],
         reference: 'https://github.com/comfyanonymous/ComfyUI',
         install_type: '',
      })

      log(`loading src/manager/json/${chalk.yellow('custom-node-list.json')}...`)
      _getKnownPlugins(this)

      log(`loading src/manager/json/${chalk.yellow('extension-node-map.json')}...`)
      _getCustomNodeRegistry(this)

      log(`loading src/manager/json/${chalk.yellow('model-list.json')}...`)
      _getKnownModels(this)
   }

   getKnownCheckpoints = (): ComfyManagerModelInfo[] => {
      const allKnownModels = [...this.knownModels.values()]
      const allKnownCheckpoints = allKnownModels.filter((i) => i.type === 'checkpoint')
      // console.log(`[🤠] allKnownCheckpoints`, allKnownCheckpoints)
      // for (const mi of knownModels.values()) {
      //     console.log(`[🧐] `, mi.type === 'checkpoint' ? '✅' : '❌', mi.name)
      // }
      return allKnownCheckpoints
   }

   /**
    * try to replicate the logic of ComfyUIManager to extract the final
    * file path of a downloaded managed model
    */
   getModelInfoFinalFilePath = (mi: ComfyManagerModelInfo): string => {
      /**
       * the wide data-lt once told:
       *
       * | if save_path is 'default'
       * | models/type'/filename
       *
       * | if type is "checkpoint"
       * | models/checkpoints/filename
       *
       * | if save_path not starting with custom node
       * | base path is models
       * | e.g. save_path is "checkpoints/SD1.5"
       * | models/checkpoints/SD1.5/filename
       * | save_path is "custom_nodes/AAA/models"
       * | custom_nodes/AAA/models/filename
       *
       */
      if (mi.save_path === 'default') return `models/${mi.type}/${mi.filename}`
      if (mi.type === 'checkpoint') return `models/checkpoints/${mi.filename}`
      if (mi.save_path.startsWith('custom_nodes')) return `${mi.save_path}/${mi.filename}`
      else return `models/${mi.save_path}/${mi.filename}`
   }

   getModelInfoEnumName = (mi: ComfyManagerModelInfo, prefix: string = ''): { win: string; nix: string } => {
      const relPath = this.getModelInfoFinalFilePath(mi)

      const winPath = relPath.replace(/\//g, '\\')
      const winPrefix = prefix?.replace(/\//g, '\\')
      const isUnderPrefixWin = winPath.startsWith(winPrefix)

      const nixPath = relPath.replace(/\\/g, '/')
      const nixPrefix = prefix?.replace(/\//g, '\\')
      const isUnderPrefixNix = nixPath.startsWith(nixPrefix)

      const isUnderPrefix = isUnderPrefixNix || isUnderPrefixWin
      return {
         win: isUnderPrefix ? winPath.slice(winPrefix.length) : mi.filename /* winRel */,
         nix: isUnderPrefix ? nixPath.slice(nixPrefix.length) : mi.filename /* nixRel */,
      }
   }
}
