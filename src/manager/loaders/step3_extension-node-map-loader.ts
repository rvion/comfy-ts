import { writeFileSync, readFileSync } from 'node:fs'
import { type } from 'arktype'
import { ansi as chalk } from 'src/utils/ansi.ts'
import { toQualifiedNodeKey } from 'src/sdk-generator/_toQualifiedNodeKey.ts'
import { githubRegexpV2 } from 'src/utils/githubRegexes.ts'
import type { ComfyRegistry } from 'src/manager/ComfyRegistry.ts'
import type { KnownComfyCustomNodeName } from 'src/manager/generated/KnownComfyCustomNodeName.ts'
import type { KnownComfyPluginURL } from 'src/manager/generated/KnownComfyPluginURL.ts'
import { ManagerParseError } from 'src/manager/loaders/parseReport.ts'
import { ComfyManagerExtensionNodeMapEntry_ark } from 'src/manager/types/ComfyManagerFilePluginContent.ts'
import type { ComfyManagerPluginInfo } from 'src/manager/types/ComfyManagerPluginInfo.ts'

export const _getCustomNodeRegistry = (DB: ComfyRegistry): void => {
   const counter = DB.report.file('extension-node-map.json')
   let totalCustomNodeSeen: number = 0

   const raw: unknown = JSON.parse(readFileSync('src/manager/json/extension-node-map.json', 'utf8'))
   const root = type('Record<string, unknown>')(raw)
   if (root instanceof type.errors) throw new ManagerParseError('extension-node-map.json', root.summary)

   for (const [url, value] of Object.entries(root)) {
      // row shape: [nodeNames, meta]
      const res = ComfyManagerExtensionNodeMapEntry_ark(value)
      if (res instanceof type.errors) {
         counter.skip('schema', `${url}: ${res.summary}`)
         continue
      }
      // cross-reference: the url must be a file of a known plugin (upstream ships a few orphans)
      const plugin = DB.plugins_byFile.get(url as KnownComfyPluginURL)
      if (plugin == null) {
         counter.skip('unknown-plugin-url', url)
         continue
      }
      counter.ok()

      // meta (res[1]) is validated so drift stays visible, but consumed by nothing today
      const comfyNodeNames = res[0]
      totalCustomNodeSeen += comfyNodeNames.length
      const pythonModule = reverseEngineerWhatComfyWillSendAsPythonModuleValueOnceInstalled(plugin)

      // ensure we have a list of nodes for this plugin
      const nodesInPlugin: KnownComfyCustomNodeName[] = DB.customNodes_byPluginName.get(plugin.title) ?? []
      DB.customNodes_byPluginName.set(plugin.title, nodesInPlugin)

      for (const nodeNameInComfy of comfyNodeNames) {
         const nodeKey = toQualifiedNodeKey(pythonModule, nodeNameInComfy)
         const prevEntry = DB.plugins_byNodeKey.get(nodeKey)
         if (prevEntry == null) DB.plugins_byNodeKey.set(nodeKey, [plugin])
         else prevEntry.push(plugin)
         nodesInPlugin.push(nodeKey as KnownComfyCustomNodeName)
      }
   }

   // CODEGEN ------------------------------------------------------------
   if (DB.opts.genTypes) {
      let out = ''
      const allNodeKeys = [...DB.plugins_byNodeKey.keys()]
      const sortedNodeKeys = allNodeKeys.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      out += '// prettier-ignore\n'
      out += 'export type KnownComfyCustomNodeName =\n'
      for (const nodeName of sortedNodeKeys) {
         out += `    | ${JSON.stringify(nodeName)}\n`
      }
      out += '\n'

      const outPath = 'src/manager/generated/KnownComfyCustomNodeName.ts'
      writeFileSync(outPath, out + '\n', 'utf-8')
      console.log(`   > generated: ${chalk.blue.underline(outPath)}`)
   }

   // INDEXING CHECKS ------------------------------------------------------------
   if (DB.opts.check) {
      console.log(`   - ${totalCustomNodeSeen} CustomNodes names processed`)
      console.log(`   - ${DB.plugins_byNodeKey.size} unique node keys registered in map`)
   }
}

function reverseEngineerWhatComfyWillSendAsPythonModuleValueOnceInstalled(plugin: ComfyManagerPluginInfo): string {
   if (plugin.id === 'nodes' && plugin.reference === 'https://github.com/comfyanonymous/ComfyUI') return 'nodes'
   const repoName = plugin.reference.match(githubRegexpV2)?.[2]
   if (repoName) return `custom_nodes.${repoName}`
   return `custom_nodes.${plugin.id}`
}
