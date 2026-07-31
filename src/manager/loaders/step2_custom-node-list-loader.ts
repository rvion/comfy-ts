import { getComfyStorage } from 'src/storage/ComfyStorage.ts'
import { type } from 'arktype'
import { ansi as chalk } from 'src/utils/ansi.ts'
import { githubRegexpV1 } from 'src/utils/githubRegexes.ts'
import type { ComfyRegistry } from 'src/manager/ComfyRegistry.ts'
import { ComfyPluginExtra } from 'src/manager/json/custom-node-list.extra.ts'
import { ManagerParseError } from 'src/manager/loaders/parseReport.ts'
import { ComfyManagerFilePluginListRoot_ark } from 'src/manager/types/ComfyManagerFilePluginList.ts'
import {
   type ComfyManagerRawPluginInfo,
   ComfyManagerRawPluginInfo_ark,
   type ComfyManagerPluginInfo,
} from 'src/manager/types/ComfyManagerPluginInfo.ts'

export const _getKnownPlugins = (DB: ComfyRegistry): void => {
   const counter = DB.report.file('custom-node-list.json')
   let totalFileSeen = 0

   // parse rows: loose raw schema per row, skip+report failures, normalize survivors
   const raw: unknown = JSON.parse(getComfyStorage().readText('src/manager/json/custom-node-list.json'))
   const root = ComfyManagerFilePluginListRoot_ark(raw)
   if (root instanceof type.errors) throw new ManagerParseError('custom-node-list.json', root.summary)

   const canonical: ComfyManagerPluginInfo[] = []
   for (const row of root.custom_nodes) {
      const res = ComfyManagerRawPluginInfo_ark(row)
      if (res instanceof type.errors) {
         counter.skip('schema', res.summary)
         continue
      }
      const plugin = normalizePluginInfo(res)
      if (plugin == null) {
         counter.skip('id-unrecoverable', res.reference)
         continue
      }
      canonical.push(plugin)
      counter.ok()
   }

   // hand-maintained extras are compile-checked canonical rows, not upstream data: no counting
   const knownPluginList: ComfyManagerPluginInfo[] = canonical.concat(ComfyPluginExtra)

   for (const plugin of knownPluginList) {
      if (DB.opts.check && DB.plugins_byTitle.has(plugin.title))
         console.log(`   ❌ plugin.title: "${plugin.title}" is duplicated`)
      DB.plugins_byTitle.set(plugin.title, plugin)
      for (const pluginURI of plugin.files) {
         totalFileSeen++
         if (DB.opts.check && DB.plugins_byFile.has(pluginURI))
            console.log(`   ❌ plugin.file: "${pluginURI}" is duplicated`)
         DB.plugins_byFile.set(pluginURI, plugin)
      }
   }

   // CODEGEN ------------------------------------------------------------
   if (DB.opts.genTypes) {
      let out1 = ''
      // TitleType
      const allPlugins = [...DB.plugins_byTitle.values()]
      const allPluginsSortedByTitles = allPlugins.sort((a, b) =>
         a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
      )
      out1 += '// prettier-ignore\n'
      out1 += 'export type KnownComfyPluginTitle =\n'
      for (const plugin of allPluginsSortedByTitles) {
         out1 += `    /** ${plugin.id} - ${plugin.reference} */\n`
         out1 += `    | ${JSON.stringify(plugin.title)}\n`
      }
      out1 += '\n'
      const out1Path = 'src/manager/generated/KnownComfyPluginTitle.ts'
      getComfyStorage().writeText(out1Path, out1 + '\n')
      console.log(`   > generated: ${chalk.blue.underline(out1Path)}`)

      // FileType
      let out2 = ''
      const allFileNames = [...DB.plugins_byFile.keys()]
      const sortedFileNames = allFileNames.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      out2 += '// prettier-ignore\n'
      out2 += 'export type KnownComfyPluginURL =\n'
      for (const fileName of sortedFileNames) out2 += `    | ${JSON.stringify(fileName)}\n`
      const out2Path = 'src/manager/generated/KnownComfyPluginURL.ts'
      getComfyStorage().writeText(out2Path, out2)
      console.log(`   > generated: ${chalk.blue.underline(out2Path)}`)
   }

   // INDEXING CHECKS ------------------------------------------------------------
   if (DB.opts.check) {
      console.log(`   - ${knownPluginList.length} CustomNodes in file`)
      console.log(`   - ${DB.plugins_byTitle.size} CustomNodes registered in map`)
      console.log(`   - ${totalFileSeen} CustomNodes-File Seen`)
      console.log(`   - ${DB.plugins_byFile.size} CustomNodes-File registered in map`)
   }
}

/**
 * raw → canonical: recover the missing `id` (absent on ~76% of upstream rows)
 * from the title, else the github repo name. null = unrecoverable, caller
 * reports and skips the row.
 */
function normalizePluginInfo(p: ComfyManagerRawPluginInfo): ComfyManagerPluginInfo | null {
   const id = p.id ?? p.title ?? p.reference.match(githubRegexpV1)?.[2]
   if (id == null) return null
   return { ...p, id }
}
