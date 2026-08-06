import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'pathe'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** json with comments: these configs are documented, strip the line comments before parsing */
function readConfig(rel: string): Record<string, unknown> {
   const text = readFileSync(join(repoRoot, rel), 'utf8').replaceAll(/^\s*\/\/.*$/gm, '')
   return JSON.parse(text) as Record<string, unknown>
}

function strings(raw: unknown): string[] {
   return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

/**
 * THE GUARD: a config that `extends` the root INHERITS its `exclude`, and the root excludes
 * both dom corners. Each of them therefore excluded the very directory it exists to check,
 * and every file under src/cli/serve/web went unchecked, which is how an undefined import
 * reached the browser. A dom config must override `exclude` and must not cover its own dir.
 */
const DOM_CONFIGS = ['src/cli/serve/web/tsconfig.json', 'examples/web/tsconfig.json']

describe('every tsconfig actually checks its own directory', () => {
   it('the root config excludes the dom corners (they have their own lib)', () => {
      const root = strings(readConfig('tsconfig.json').exclude)
      expect(root).toContain('src/cli/serve/web')
      expect(root).toContain('examples/web')
   })

   for (const rel of DOM_CONFIGS) {
      it(`${rel} overrides exclude and does not exclude itself`, () => {
         const cfg = readConfig(rel)
         const dir = dirname(join(repoRoot, rel))
         expect(cfg.exclude, `${rel} must set its own "exclude" (extends would inherit the root's)`).toBeDefined()
         for (const entry of strings(cfg.exclude)) {
            const excluded = resolve(dir, entry)
            const rebased = relative(excluded, dir)
            // '' means the excluded path IS this dir; a relative path with no '..' means it contains it
            const swallowsItself = rebased === '' || !rebased.startsWith('..')
            expect(swallowsItself, `${rel} excludes '${entry}', which covers its own files`).toBe(false)
         }
      })
   }
})
