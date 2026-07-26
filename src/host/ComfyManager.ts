/** 🔶 NAMING DISCLAIMER: I call a "custom node package" => "PLUGIN" */

import type { Type } from 'arktype'
import type { ComfyRegistry } from 'src/manager/ComfyRegistry.ts'
import type { KnownComfyPluginTitle } from 'src/manager/generated/KnownComfyPluginTitle.ts'
import type { KnownModel_Name } from 'src/manager/generated/KnownModel_Name.ts'
import type { ComfyManagerAPIFetchPolicy } from 'src/manager/types/ComfyManagerAPIFetchPolicy.ts'
import {
   type ComfyManagerAPIModelList,
   ComfyManagerAPIModelList_ark,
} from 'src/manager/types/ComfyManagerAPIModelList.ts'
import {
   type ComfyManagerAPIPluginList,
   ComfyManagerAPIPluginList_ark,
} from 'src/manager/types/ComfyManagerAPIPluginList.ts'
import type { ComfyManagerModelInfo } from 'src/manager/types/ComfyManagerModelInfo.ts'
import type { ComfyManagerPluginInfo } from 'src/manager/types/ComfyManagerPluginInfo.ts'
import type { Maybe } from 'src/types/index.ts'
import { logError as toastError, logSuccess as toastSuccess } from 'src/utils/log.ts'
import { softValidate } from 'src/utils/softValidate.ts'
import type { PluginInstallStatus } from 'src/host/Requirements.ts'

export class ComfyManager {
   constructor(public host: { getServerHostHTTP: () => string }) {
      // void this.updateHostPluginsAndModels()
   }

   get registry(): ComfyRegistry {
      return comfyts.registry
   }

   fetchPluginsAndModels = async (): Promise<void> => {
      const [_pluginList, _modelList] = await Promise.all([this.fetchPlugins(), this.fetchModels()])
      this.pluginList = _pluginList
      this.modelList = _modelList
   }

   // -----------
   configureLogging = (mi: boolean): Promise<unknown> => {
      // return this.repository.getModelInfoFinalFilePath(mi)
      return this.fetchGetText(`/manager/terminal?mode=${mi}`)
   }

   // utils ------------------------------------------------------------------------------
   getModelInfoFinalFilePath = (mi: ComfyManagerModelInfo): string => {
      return comfyts.registry.getModelInfoFinalFilePath(mi)
   }

   waitForHostToBeBackOnline(maxAttempt: 10): Promise<true> {
      return new Promise<true>((yes, no) => {
         let attempt = 0
         let abortCtrl: AbortController
         const interval = setInterval(async () => {
            attempt++
            if (attempt > maxAttempt) {
               console.log(`   - failure`)
               clearInterval(interval)
               no()
            }
            if (abortCtrl) abortCtrl.abort()
            const url = this.host.getServerHostHTTP()
            abortCtrl = new AbortController()
            try {
               console.log(`   - trying...`)
               await fetch(url, { signal: abortCtrl.signal })
               clearInterval(interval)
               yes(true)
            } catch {
               /* empty */
            }
         }, 1000)
      })
   }

   // actions ---------------------------------------------------------------------------
   rebootComfyUIAndUpdateHostPluginsAndModelsAfter10Seconds(): Promise<void> {
      // 🔴 bad code
      setTimeout(() => void this.fetchPluginsAndModels(), 10_000)
      // curl 'http://<host>:8188/api/manager/reboot' \
      //     -H 'Accept: */*' \
      //     -H 'Accept-Language: en-GB' \
      //     -H 'Cache-Control: max-age=0' \
      //     -H 'Comfy-User: undefined' \
      //     -H 'Connection: keep-alive' \
      //     -H 'Referer: http://<host>:8188/' \
      //     -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) cushystudio-shell/32.1.2 Chrome/128.0.6613.162 Electron/32.1.2 Safari/537.36'
      return this.fetchGetJSON('/manager/reboot')
   }

   restartComfyUI = async (): Promise<unknown> => {
      return this.fetchGetJSON('/manager/reboot')
   }

   modelList: Maybe<ComfyManagerAPIModelList> = null

   fetchModels = (): Promise<ComfyManagerAPIModelList> => {
      return this.fetchGetJSON('/externalmodel/getlist?mode=cache', ComfyManagerAPIModelList_ark)
   }

   fetchLogs = (): Promise<any> => {
      return this.fetchGetJSON<unknown>('/internal/logs')
   }

   isModelInstalled = (name: KnownModel_Name): boolean => {
      return this.modelList?.models.some((x) => x.name === name && x.installed === 'True') ?? false
   }

   modelsBeeingInstalled = new Set<KnownModel_Name>()

   installModel = async (model: ComfyManagerModelInfo): Promise<boolean> => {
      try {
         this.modelsBeeingInstalled.add(model.name)
         await this.fetchPost('/model/install', model)
         this.modelsBeeingInstalled.delete(model.name)
         toastSuccess('Model installed')
         return true
      } catch (exception) {
         console.error(`Install failed: ${/*model.title*/ ''} / ${exception}`)
         toastError('Model Installation Failed')
         this.modelsBeeingInstalled.delete(model.name)
         return false
      }
   }

   getModelStatus = (modelName: KnownModel_Name): PluginInstallStatus => {
      if (this.modelList == null) return 'unknown'
      const entry = this.modelList?.models.find((x) => x.name === modelName)
      const status = ((): PluginInstallStatus => {
         if (!entry) return 'unknown'
         if (entry?.installed === 'False') return 'not-installed'
         if (entry?.installed === 'True') return 'installed'
         if (entry?.installed === 'Update') return 'update-available'
         return 'error'
      })()
      return status
   }

   // PLUGINS (A.K.A. Custom nodes) ----------------------------------------------------------------------------
   /**
    * you need to call `fetchPluginList()` to populate this field
    */
   pluginList: Maybe<ComfyManagerAPIPluginList> = null // hasModel = async (model: ModelInfo) => {

   get titlesOfAllInstalledPlugins(): KnownComfyPluginTitle[] {
      return (
         this.pluginList?.custom_nodes //
            .filter((x) => x.installed === 'True')
            .map((x) => x.title) ?? []
      )
   }

   isPluginInstalled = (title: KnownComfyPluginTitle): boolean => {
      if (!this.pluginList || !this.pluginList.custom_nodes) return false
      return this.pluginList.custom_nodes.some((x) => x.title === title && x.installed === 'True') ?? false
   }

   getPluginStatus = (title: KnownComfyPluginTitle): PluginInstallStatus => {
      if (this.pluginList == null) return 'unknown'
      const entry = this.pluginList?.custom_nodes.find((x) => x.title === title)
      const status = ((): PluginInstallStatus => {
         if (!entry) return 'unknown'
         if (entry?.installed === 'False') return 'not-installed'
         if (entry?.installed === 'True') return 'installed'
         if (entry?.installed === 'Update') return 'update-available'
         return 'error'
      })()
      return status
   }

   // --------------------------------------------------------------
   // https://github.com/ltdrdata/ComfyUI-Manager/blob/4649d216b1842aa48b95d3f064c679a1b698e506/js/custom-nodes-downloader.js#L14C25-L14C88
   fetchPlugins = async (
      /** @default: 'cache' */
      mode: ComfyManagerAPIFetchPolicy = 'cache',
      /** @default: true */
      skipUpdate: boolean = true,
   ): Promise<ComfyManagerAPIPluginList> => {
      try {
         const skip_update = skipUpdate ? '&skip_update=true' : ''
         return await this.fetchGetJSON(`/customnode/getlist?mode=${mode}${skip_update}`, ComfyManagerAPIPluginList_ark)
      } catch (exception) {
         console.error(`node list retrieval failed: ${exception}`)
         toastError('node list retrieveal failed')
         throw exception
      }
   }

   installPlugin = async (model: ComfyManagerPluginInfo): Promise<boolean> => {
      try {
         await this.fetchPost('/customnode/install', model)
         console.log('✅ Custom Node installed')
         toastSuccess('Custom Node installed')
         return true
      } catch (exception) {
         console.error(`Install failed: ${/*model.title*/ ''} / ${exception}`)
         toastError('Custom Node Installation Failed')
         return false
      }
   }

   // --------------------------------------------------------------
   private fetchPost = async <IN, OUT = unknown>(endpoint: string, body: IN, validator?: Type<OUT>): Promise<OUT> => {
      const url = this.host.getServerHostHTTP() + endpoint
      const response = await fetch(url, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`POST ${endpoint} failed: ${response.status} ${response.statusText}`)
      const status = await response.json()
      if (validator) return softValidate(validator, status)
      // wire tolerance (agent/coding.md): unvalidated endpoints return unknown-shaped json
      return status as OUT
   }

   private fetchGetJSON = async <OUT = unknown>(endpoint: string, validator?: Type<OUT>): Promise<OUT> => {
      const url = this.host.getServerHostHTTP() + endpoint
      const response = await fetch(url)
      if (!response.ok) throw new Error(`GET ${endpoint} failed: ${response.status} ${response.statusText}`)
      const jsonResult = await response.json()
      if (validator) return softValidate(validator, jsonResult)
      // wire tolerance (agent/coding.md): unvalidated endpoints return unknown-shaped json
      return jsonResult as OUT
   }

   private fetchGetText = async (endopint: string): Promise<string> => {
      const url = this.host.getServerHostHTTP() + endopint
      const response = await fetch(url)
      const status = await response.text()
      return status
   }
}
