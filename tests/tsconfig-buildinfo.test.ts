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

// why we think it is actually a bug, and not just meaning spec should change: coding.md says every
// invoked typecheck owns its cache, and the folder-open `tsc --watch` runs the ROOT config too, so
// the gate's typecheck read the watcher's cache and failed on a method that exists
describe('the gate typecheck: its own cache, every config', () => {
   const scripts = (
      JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
   ).scripts
   const rootCall = (script: string): string => script.split('&&')[0]?.trim() ?? ''

   it('the root typecheck call passes its own --tsBuildInfoFile', () => {
      const call = rootCall(scripts.typecheck ?? '')
      const own = /--tsBuildInfoFile\s+(\S+)/.exec(call)?.[1] ?? ''
      expect(own, `typecheck must pass --tsBuildInfoFile: ${call}`).not.toBe('')
      expect(own).not.toBe(buildInfoOf('tsconfig.json'))
   })

   // why we think it is actually a bug, and not just meaning spec should change: the root config
   // excludes the dom corners and says each is CHAINED by a script, but the gate runs `typecheck`,
   // which chained examples/web only, so the web panel code was never typechecked by the gate
   it('the gate typecheck covers every dom config the root one excludes', () => {
      const script = scripts.typecheck ?? ''
      for (const cfg of ['examples/web/tsconfig.json', 'src/cli/serve/web/tsconfig.json'])
         expect(script, `typecheck must chain tsc -p ${cfg}`).toContain(`tsc -p ${cfg}`)
   })

   it('control: the root config still declares the cache the watcher uses', () => {
      expect(buildInfoOf('tsconfig.json')).toBe('node_modules/.cache/tsbuildinfo.json')
   })
})
