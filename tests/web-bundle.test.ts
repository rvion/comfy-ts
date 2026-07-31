import { describe, expect, it } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * the MACHINE GUARD of architecture item 13: the web entry's module graph must
 * stay browser-clean forever. A static import of node:fs / ws / sharp anywhere
 * under src/web.ts makes this test fail — the getBuiltinModule autodetect and
 * the variable-specifier lazy imports are the only sanctioned escapes, and
 * neither produces an import statement in the bundle.
 */
describe('comfy-ts/web bundles clean for the browser', () => {
   it('Bun.build(target browser) succeeds and emits no node/ws/sharp imports', async () => {
      // Bun SHIMS node: builtins to empty objects on browser target (silent
      // `undefined is not a function` at runtime) — output regexes alone
      // false-pass, so a resolve SPY records every node: request with its
      // importer and the assertion below is the real guard
      const nodeImports: string[] = []
      const result = await Bun.build({
         entrypoints: [join(repoRoot, 'src/web.ts')],
         target: 'browser',
         minify: false,
         throw: false,
         plugins: [
            {
               // the house 'src/...' absolute imports resolve via tsconfig paths,
               // which Bun.build does not read — map them to the repo root here
               name: 'repo-src-paths',
               setup(build) {
                  build.onResolve({ filter: /^src\// }, (args) => ({ path: join(repoRoot, args.path) }))
                  build.onResolve({ filter: /^node:/ }, (args) => {
                     nodeImports.push(`${args.path} ← ${args.importer}`)
                     return undefined
                  })
               },
            },
         ],
      })
      expect(nodeImports, 'node builtins reached the web graph').toEqual([])
      const logs = result.logs.map((l) => String(l)).join('\n')
      expect(result.success, `web bundle failed:\n${logs}`).toBe(true)
      const first = result.outputs[0]
      if (first == null) throw new Error('no bundle output')
      const out = await first.text()
      // import/require of node builtins (string mentions like getBuiltinModule('node:fs') are fine)
      expect(out).not.toMatch(/from\s*["']node:/)
      expect(out).not.toMatch(/require\(\s*["']node:/)
      expect(out).not.toMatch(/import\(\s*["']node:/)
      // ws and sharp must not be statically reachable (their bundles would drag node: imports anyway)
      expect(out).not.toMatch(/from\s*["']ws["']/)
      expect(out).not.toMatch(/from\s*["']sharp["']/)
      // the node storage backend module must not be in the graph at all
      expect(out).not.toContain('createNodeStorage(')
   })
})
