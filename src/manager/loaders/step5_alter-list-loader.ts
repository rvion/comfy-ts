import { readFileSync } from 'node:fs'
import { type } from 'arktype'
import type { ComfyRegistry } from 'src/manager/ComfyRegistry.ts'
import { ManagerParseError } from 'src/manager/loaders/parseReport.ts'
import {
   type ComfyManagerAlterInfo,
   ComfyManagerAlterInfo_ark,
   ComfyManagerFileAlterListRoot_ark,
} from 'src/manager/types/ComfyManagerAlterInfo.ts'

export const _getAlterList = (DB: ComfyRegistry): void => {
   const counter = DB.report.file('alter-list.json')

   const raw: unknown = JSON.parse(readFileSync('src/manager/json/alter-list.json', 'utf8'))
   const root = ComfyManagerFileAlterListRoot_ark(raw)
   if (root instanceof type.errors) throw new ManagerParseError('alter-list.json', root.summary)

   const canonical: ComfyManagerAlterInfo[] = []
   for (const row of root.items) {
      const res = ComfyManagerAlterInfo_ark(row)
      if (res instanceof type.errors) {
         counter.skip('schema', res.summary)
         continue
      }
      canonical.push(res)
      counter.ok()
   }
   DB.alterations = canonical
}
