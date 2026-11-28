import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

type PackageJson = {
   scripts: Record<string, string>
   dependencies?: Record<string, string>
   devDependencies?: Record<string, string>
}
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as PackageJson

/** the configs the portable gate checks: a fresh clone has no generated host sdk */
const GATE_CONFIGS = ['tsconfig.lib.json', 'tsconfig.tests.json', 'examples/web/tsconfig.json', 'src/cli/serve/web/tsconfig.json']
/** the configs that need a generated host sdk, or draw with the house viewer */
const LOCAL_CONFIGS = [
   'tsconfig.json',
   'examples/depth-explorer/web/tsconfig.json',
   'examples/world-explorer/web/tsconfig.json',
   'examples/upscale-explorer/web/tsconfig.json',
]

function compilerOptionsOf(rel: string): Record<string, unknown> {
   // json with comments: strip line comments before parsing (these configs are documented)
   const text = readFileSync(join(repoRoot, rel), 'utf8').replaceAll(/^\s*\/\/.*$/gm, '')
   const parsed = JSON.parse(text) as { compilerOptions?: Record<string, unknown> }
   return parsed.compilerOptions ?? {}
}

describe('the type check is bun check, on every config', () => {
   it('the gate typecheck chains every portable config', () => {
      for (const cfg of GATE_CONFIGS) expect(pkg.scripts.typecheck).toContain(`bun check -p ${cfg}`)
   })

   it('the full typecheck adds the configs that need a generated host sdk', () => {
      for (const cfg of [...GATE_CONFIGS.slice(1), ...LOCAL_CONFIGS])
         expect(pkg.scripts['typecheck:full']).toContain(`bun check -p ${cfg}`)
   })

   // a `check` script runs in place of bun's own checker
   it('no script is named check', () => {
      expect(Object.keys(pkg.scripts)).not.toContain('check')
   })

   // a `lint` script runs in place of `bun lint`, so it must be bun's own linter, and fail on a warning
   it('the lint script is bun lint, and one warning fails it', () => {
      expect(pkg.scripts.lint).toBe('bun lint --no-script --max-warnings=0')
      expect(pkg.scripts.ci).toContain('bun run lint')
   })

   it('no script calls tsc, tsgo, tsdown or oxlint', () => {
      for (const [name, script] of Object.entries(pkg.scripts))
         expect(script, `script ${name}`).not.toMatch(/\b(tsc|tsgo|tsdown|oxlint)\b/)
   })

   it('control: that pattern does catch a tsc call', () => {
      expect('tsc -p tsconfig.lib.json && bun test').toMatch(/\b(tsc|tsgo|tsdown|oxlint)\b/)
      expect('bun check -p tsconfig.lib.json').not.toMatch(/\b(tsc|tsgo|tsdown|oxlint)\b/)
   })

   it('the compiler and the tools built on it are not installed', () => {
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      for (const name of ['typescript', '@typescript/native-preview', 'tsdown', 'oxlint', 'oxlint-tsgolint'])
         expect(deps, name).not.toContain(name)
   })

   // bun check keeps no build info, so a cache setting is dead weight a reader would trust
   it('no config sets an incremental cache', () => {
      for (const cfg of [...GATE_CONFIGS, ...LOCAL_CONFIGS]) {
         const opts = compilerOptionsOf(cfg)
         expect(opts.incremental, cfg).toBeUndefined()
         expect(opts.tsBuildInfoFile, cfg).toBeUndefined()
      }
   })

   it('tests/ are checked without noUncheckedIndexedAccess, and only tests/', () => {
      expect(compilerOptionsOf('tsconfig.tests.json').noUncheckedIndexedAccess).toBe(false)
      expect(compilerOptionsOf('tsconfig.json').noUncheckedIndexedAccess).toBe(true)
      expect(compilerOptionsOf('tsconfig.lib.json').noUncheckedIndexedAccess).toBeUndefined()
   })
})
