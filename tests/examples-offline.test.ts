import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'

const examplesDir = join(import.meta.dir, '..', 'examples')

/** every runnable example module, zoo included — auto-enrolled so a new file is covered the moment it exists */
function allCflowFiles(): string[] {
   const out: string[] = []
   const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
         if (entry.isDirectory()) walk(join(dir, entry.name))
         else if (entry.name.endsWith('.cflow.ts')) out.push(join(dir, entry.name))
      }
   }
   walk(examplesDir)
   return out.sort()
}

// `comfy-ts tui` with no arg must include the PACKAGED
// examples, so they must open from a fresh consumer project where
// .comfy-ts/hosts/<id>/ does not exist AND no api key is set. Before the fix
// the examples' top-level `await host.loadSchemaFromCache()` threw at IMPORT
// time and took the whole TUI down; the cloud zoo would have painted one red ✗
// row per file on a keyless machine (agent/examples.md owns the bar).
describe('every example imports headlessly (auto-enrolled)', () => {
   it('all *.cflow.ts import keyless in a cacheless consumer cwd', () => {
      const files = allCflowFiles()
      // a broken walk returning [] must never silently pass — the zoo alone is 40+
      expect(files.length).toBeGreaterThan(40)
      const consumerCwd = mkdtempSync(join(tmpdir(), 'comfy-ts-consumer-'))
      // beyond import-safety: every kind-'image' var must default to an
      // EXISTING file (the bundled examples/images/ default resolves from the
      // package location, never from the consumer cwd) — auto-enrolled like
      // the import check, a typoed exampleImagePath name fails here
      const script = [
         `const { existsSync } = await import('node:fs')`,
         `const files = ${JSON.stringify(files)}`,
         `for (const f of files) {`,
         `   const mod = await import(f)`,
         `   console.log('IMPORT_OK ' + f)`,
         `   const wf = mod.default`,
         `   if (wf == null || wf.vars == null) continue`,
         `   for (const [name, varDef] of Object.entries(wf.vars)) {`,
         `      if (varDef == null || varDef.kind !== 'image') continue`,
         `      const p = varDef.absPath()`, // throws when unset: image vars must ship a default
         `      if (!existsSync(p)) throw new Error('image var ' + name + ' of ' + f + ' defaults to a missing file: ' + p)`,
         `      console.log('IMAGE_DEFAULT_OK ' + f)`,
         `   }`,
         `}`,
      ].join('\n')
      try {
         const env = { ...process.env }
         delete env.COMFY_CLOUD_API_KEY
         const res = spawnSync('bun', ['-e', script], { cwd: consumerCwd, encoding: 'utf8', env })
         expect(res.stderr).toContain('no schema cache') // degraded with a loud log, never thrown
         const missing = files.filter((f) => !res.stdout.includes(`IMPORT_OK ${f}`))
         expect(missing).toEqual([])
         // the swept i2i/i2v families: 16 zoo files + example 02 carry an image var
         const imageOk = res.stdout.match(/IMAGE_DEFAULT_OK /g) ?? []
         expect(imageOk.length).toBeGreaterThanOrEqual(17)
         expect(res.status).toBe(0)
      } finally {
         rmSync(consumerCwd, { recursive: true, force: true })
      }
   }, 120_000)
})

// the cloud examples are IMPORT-SAFE without an api key (covered for ALL files
// above); what remains specific here is the RUN-time key story
describe('cloud example without COMFY_CLOUD_API_KEY', () => {
   it('standalone run gate throws a clear message naming the env var', () => {
      const helper = join(examplesDir, 'comfy-cloud', 'cloudHost.ts')
      const cmd = `const { requireCloudKey } = await import(${JSON.stringify(helper)}); requireCloudKey()`
      const env = { ...process.env }
      delete env.COMFY_CLOUD_API_KEY
      const res = spawnSync('bun', ['-e', cmd], { encoding: 'utf8', env })
      expect(res.status).not.toBe(0)
      expect(res.stderr).toContain('COMFY_CLOUD_API_KEY')
   })

   it('with a key set, import degrades offline like any bundled example', () => {
      const example = join(examplesDir, 'rvion', '05-comfy-cloud.cflow.ts')
      const importCmd = `await import(${JSON.stringify(example)}); console.log('IMPORT_OK')`
      const consumerCwd = mkdtempSync(join(tmpdir(), 'comfy-ts-consumer-'))
      try {
         // never the guarded key shape — presence is all the module checks at import
         const env = { ...process.env, COMFY_CLOUD_API_KEY: 'test-dummy-key' }
         const res = spawnSync('bun', ['-e', importCmd], { cwd: consumerCwd, encoding: 'utf8', env })
         expect(res.stderr).toContain('no schema cache')
         expect(res.stdout).toContain('IMPORT_OK')
         expect(res.status).toBe(0)
      } finally {
         rmSync(consumerCwd, { recursive: true, force: true })
      }
   })
})
