import { readFileSync } from 'node:fs'
import { type } from 'arktype'
import type { ComfyRegistry } from 'src/manager/ComfyRegistry.ts'
import { ManagerParseError } from 'src/manager/loaders/parseReport.ts'
import { ComfyManagerGithubStatEntry_ark } from 'src/manager/types/ComfyManagerGithubStats.ts'

export const _getGithubStats = (DB: ComfyRegistry): void => {
   const counter = DB.report.file('github-stats.json')

   const raw: unknown = JSON.parse(readFileSync('src/manager/json/github-stats.json', 'utf8'))
   const root = type('Record<string, unknown>')(raw)
   if (root instanceof type.errors) throw new ManagerParseError('github-stats.json', root.summary)

   for (const [url, value] of Object.entries(root)) {
      const res = ComfyManagerGithubStatEntry_ark(value)
      if (res instanceof type.errors) {
         counter.skip('schema', `${url}: ${res.summary}`)
         continue
      }
      DB.githubStats.set(url, res)
      counter.ok()
   }
}
