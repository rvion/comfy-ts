import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const CONFIGS = ['tsconfig.json', 'tsconfig.lib.json', 'src/cli/serve/web/tsconfig.json', 'examples/web/tsconfig.json']

function buildInfoOf(rel: string): string {
   // json with comments: strip line comments before parsing (these configs are documented)
   const text = readFileSync(join(repoRoot, rel), 'utf8').replaceAll(/^\s*\/\/.*$/gm, '')
   const parsed: unknown = JSON.parse(text)
   const opts = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).compilerOptions : {}
   const file = typeof opts === 'object' && opts !== null ? (opts as Record<string, unknown>).tsBuildInfoFile : null
   return typeof file === 'string' ? file : ''
}

/**
 * THE GUARD: every tsconfig that is actually invoked needs its OWN incremental cache.
 * two configs with different include sets writing one tsbuildinfo poison each other —
 * `typecheck:lib` then fails on a symbol that exists (an editor running the root config
 * in the background is enough to trigger it), which blocked a release once.
 */
describe('incremental caches are not shared between tsconfigs', () => {
   it('each config declares a distinct tsBuildInfoFile', () => {
      const seen = new Map<string, string>()
      for (const rel of CONFIGS) {
         const file = buildInfoOf(rel)
         expect(file, `${rel} must set compilerOptions.tsBuildInfoFile`).not.toBe('')
         const clash = seen.get(file)
         expect(clash, `${rel} shares ${file} with ${clash ?? ''}`).toBeUndefined()
         seen.set(file, rel)
      }
   })
})
