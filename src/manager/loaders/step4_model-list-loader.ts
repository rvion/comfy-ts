import { readFileSync, writeFileSync } from 'node:fs'
import { type } from 'arktype'
import { ansi as chalk } from 'src/utils/ansi.ts'
import type { ComfyRegistry } from 'src/manager/ComfyRegistry.ts'
import { extraModels } from 'src/manager/json/model-list.extra.ts'
import { ManagerParseError } from 'src/manager/loaders/parseReport.ts'
import { ComfyManagerFileModelInfoRoot_ark } from 'src/manager/types/ComfyManagerFileModelInfo.ts'
import { type ComfyManagerModelInfo, ComfyManagerModelInfo_ark } from 'src/manager/types/ComfyManagerModelInfo.ts'

export const _getKnownModels = (DB: ComfyRegistry): void => {
   const counter = DB.report.file('model-list.json')

   const raw: unknown = JSON.parse(readFileSync('src/manager/json/model-list.json', 'utf8'))
   const root = ComfyManagerFileModelInfoRoot_ark(raw)
   if (root instanceof type.errors) throw new ManagerParseError('model-list.json', root.summary)

   const canonical: ComfyManagerModelInfo[] = []
   for (const row of root.models) {
      const res = ComfyManagerModelInfo_ark(row)
      if (res instanceof type.errors) {
         counter.skip('schema', res.summary)
         continue
      }
      canonical.push(res)
      counter.ok()
   }

   // hand-maintained extras are compile-checked canonical rows, not upstream data: no counting
   const knownModelList = canonical.concat(extraModels.models)

   for (const modelInfo of knownModelList) {
      DB.knownModels.set(modelInfo.name, modelInfo)
   }

   // CODEGEN ------------------------------------------------------------
   if (DB.opts.genTypes) {
      // #region type
      let out1 = ''
      const uniqCategories: { [key: string]: number } = knownModelList.reduce(
         (acc, cur) => {
            if (acc[cur.type] != null) acc[cur.type]! += 1
            else acc[cur.type] = 1
            return acc
         },
         {} as { [key: string]: number },
      )
      out1 += `// prettier-ignore\n`
      out1 += 'export type KnownModel_Type =\n'
      for (const [cat, count] of Object.entries(uniqCategories))
         out1 += `    | ${JSON.stringify(cat).padEnd(20)} // x ${count.toString().padStart(3)}\n`
      out1 += '\n'
      out1 += 'export const knownModel_Type: KnownModel_Type[] = [\n'
      for (const [cat, count] of Object.entries(uniqCategories))
         out1 += `    ${JSON.stringify(cat).padEnd(20)},  // x ${count.toString().padStart(3)}\n`
      out1 += ']\n'
      const out1Path = 'src/manager/generated/KnownModel_Type.ts'
      writeFileSync(out1Path, out1 + '\n', 'utf-8')
      console.log(`   > generated: ${chalk.blue.underline(out1Path)}`)

      // #region savepath
      let out4 = ''
      const uniqSavePath: { [key: string]: number } = knownModelList.reduce(
         (acc, cur) => {
            if (acc[cur.save_path] != null) acc[cur.save_path]! += 1
            else acc[cur.save_path] = 1
            return acc
         },
         {} as { [key: string]: number },
      )
      out4 += `// prettier-ignore\n`
      out4 += 'export type KnownModel_SavePath =\n'
      for (const [cat, count] of Object.entries(uniqSavePath))
         out4 += `    | ${JSON.stringify(cat).padEnd(50)} // x ${count.toString().padStart(3)}\n`
      out4 += '\n'
      out4 += 'export const knownModel_SavePath: KnownModel_SavePath[] = [\n'
      for (const [cat, count] of Object.entries(uniqSavePath))
         out4 += `    ${JSON.stringify(cat).padEnd(50)},  // x ${count.toString().padStart(3)}\n`
      out4 += ']\n'
      const out4Path = 'src/manager/generated/KnownModel_SavePath.ts'
      writeFileSync(out4Path, out4 + '\n', 'utf-8')
      console.log(`   > generated: ${chalk.blue.underline(out4Path)}`)

      // #region base
      let out2 = ''
      const uniqBases: { [key: string]: number } = knownModelList.reduce(
         (acc, cur) => {
            if (acc[cur.base] != null) acc[cur.base]! += 1
            else acc[cur.base] = 1
            return acc
         },
         {} as { [key: string]: number },
      )
      out2 += `// prettier-ignore\n`
      out2 += 'export type KnownModel_Base =\n'
      for (const [cat, count] of Object.entries(uniqBases))
         out2 += `    | ${JSON.stringify(cat).padEnd(20)} // x ${count.toString().padStart(3)}\n`
      out2 += '\n'
      out2 += '// prettier-ignore\n'
      out2 += 'export const knownModel_Base: KnownModel_Base[] = [\n'
      for (const [cat, count] of Object.entries(uniqBases))
         out2 += `    ${JSON.stringify(cat).padEnd(20)},  // x ${count.toString().padStart(3)}\n`
      out2 += ']\n'
      const out2Path = 'src/manager/generated/KnownModel_Base.ts'
      writeFileSync(out2Path, out2 + '\n', 'utf-8')
      console.log(`   > generated: ${chalk.blue.underline(out2Path)}`)

      // #region KnownModel_Name
      let out3 = ''
      const sortedModels = knownModelList.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      out3 += `// prettier-ignore\n`
      out3 += 'export type KnownModel_Name =\n'
      for (const mi of sortedModels) {
         out3 += `    /** ${mi.description}\n`
         out3 += `     * ${mi.size} - ${mi.url}\n`
         out3 += `     * see ${mi.reference}\n`
         out3 += `     */\n`
         out3 += `    | ${JSON.stringify(mi.name)}\n`
      }
      out3 += '\n'
      const out3Path = 'src/manager/generated/KnownModel_Name.ts'
      writeFileSync(out3Path, out3 + '\n', 'utf-8')
      console.log(`   > generated: ${chalk.blue.underline(out3Path)}`)

      // #region KnownModel_FileName
      let out99 = ''
      out99 += `// prettier-ignore\n`
      out99 += 'export type KnownModel_FileName =\n'
      for (const mi of sortedModels) {
         out99 += `    /** ${mi.description}\n`
         out99 += `     * ${mi.size} - ${mi.url}\n`
         out99 += `     * see ${mi.reference}\n`
         out99 += `     */\n`
         out99 += `    | ${JSON.stringify(mi.filename)}\n`
      }
      out99 += '\n'
      const out99Path = 'src/manager/generated/KnownModel_FileName.ts'
      writeFileSync(out99Path, out99 + '\n', 'utf-8')
      console.log(`   > generated: ${chalk.blue.underline(out99Path)}`)
   }

   // INDEXING CHECKS ------------------------------------------------------------
   if (DB.opts.check) {
      console.log(`${knownModelList.length} models found`)
      console.log(`${DB.knownModels.size} models registered map`)
      if (knownModelList.length !== DB.knownModels.size)
         console.log(`❌ some models are either duplicated or have overlapping indexing keys`)
   }
}
