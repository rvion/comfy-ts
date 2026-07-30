import { ansi as chalk } from 'src/utils/ansi.ts'
import type { NodeNameInComfy, QualifiedNodeKey } from 'src/sdk-generator/comfyui-types.ts'
import type { KnownComfyCustomNodeName } from 'src/manager/generated/KnownComfyCustomNodeName.ts'
import type { KnownComfyPluginTitle } from 'src/manager/generated/KnownComfyPluginTitle.ts'
import type { KnownComfyPluginURL } from 'src/manager/generated/KnownComfyPluginURL.ts'
import type { KnownModel_Name } from 'src/manager/generated/KnownModel_Name.ts'
import { DownloadComfyManagerJSONs } from 'src/manager/loaders/step1_downloadComfyManagerJSONs.ts'
import { _getKnownPlugins } from 'src/manager/loaders/step2_custom-node-list-loader.ts'
import { _getCustomNodeRegistry } from 'src/manager/loaders/step3_extension-node-map-loader.ts'
import { _getKnownModels } from 'src/manager/loaders/step4_model-list-loader.ts'
import { _getAlterList } from 'src/manager/loaders/step5_alter-list-loader.ts'
import { _getGithubStats } from 'src/manager/loaders/step6_github-stats-loader.ts'
import { ManagerParseReport } from 'src/manager/loaders/parseReport.ts'
import type { ComfyManagerAlterInfo } from 'src/manager/types/ComfyManagerAlterInfo.ts'
import type { ComfyManagerGithubStatEntry } from 'src/manager/types/ComfyManagerGithubStats.ts'
import type { ComfyManagerModelInfo } from 'src/manager/types/ComfyManagerModelInfo.ts'
import type { ComfyManagerPluginInfo } from 'src/manager/types/ComfyManagerPluginInfo.ts'

const log = (...args: unknown[]) => console.log(`[📘 registry]`, ...args)

// core ComfyUI as a pseudo-plugin: extension-node-map keys the builtin nodes under this url
const BUILTIN_URL: KnownComfyPluginURL = 'https://github.com/comfyanonymous/ComfyUI'
const BUILTIN_PLUGIN: ComfyManagerPluginInfo = {
   id: 'nodes',
   author: 'comfyanonymous',
   description: 'built-in',
   title: 'built-in',
   files: [BUILTIN_URL],
   reference: 'https://github.com/comfyanonymous/ComfyUI',
   install_type: '',
}

export class ComfyRegistry {
   // plugins, indexed
   plugins_byTitle = new Map<KnownComfyPluginTitle, ComfyManagerPluginInfo>()
   plugins_byFile = new Map<KnownComfyPluginURL, ComfyManagerPluginInfo>()
   plugins_byNodeNameInComfy = new Map<NodeNameInComfy, ComfyManagerPluginInfo[]>()
   plugins_byNodeKey = new Map<QualifiedNodeKey, ComfyManagerPluginInfo[]>()

   // custom nodes
   customNodes_byPluginName = new Map<KnownComfyPluginTitle, KnownComfyCustomNodeName[]>()

   // Models
   knownModels = new Map<KnownModel_Name, ComfyManagerModelInfo>()

   // a1111 → comfy alternatives (alter-list.json)
   alterations: ComfyManagerAlterInfo[] = []

   // repo url → stars / last_update (github-stats.json)
   githubStats = new Map<string, ComfyManagerGithubStatEntry>()

   // per-file row accounting of the last load, printed on every build
   report = new ManagerParseReport()

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
      // seeded BEFORE codegen so 'built-in' and the core repo url are legitimate union members
      this.plugins_byTitle.set(BUILTIN_PLUGIN.title, BUILTIN_PLUGIN)
      this.plugins_byFile.set(BUILTIN_URL, BUILTIN_PLUGIN)

      log(`loading src/manager/json/${chalk.yellow('custom-node-list.json')}...`)
      _getKnownPlugins(this)

      log(`loading src/manager/json/${chalk.yellow('extension-node-map.json')}...`)
      _getCustomNodeRegistry(this)

      log(`loading src/manager/json/${chalk.yellow('model-list.json')}...`)
      _getKnownModels(this)

      log(`loading src/manager/json/${chalk.yellow('alter-list.json')}...`)
      _getAlterList(this)

      log(`loading src/manager/json/${chalk.yellow('github-stats.json')}...`)
      _getGithubStats(this)

      this.report.print()
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
