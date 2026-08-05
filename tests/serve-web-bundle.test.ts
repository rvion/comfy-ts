import { describe, expect, it } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'
import { buildWebJsText } from 'src/cli/serve/webBundle.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * the machine guard for the serve web ui (architecture item 12): the app under
 * src/cli/serve/web/ must stay bundleable for the browser — this is the exact
 * build `bun run build` ships as dist/serve-web.js and the serve fallback runs
 * in memory. A node-only import sneaking into that tree fails here, in CI,
 * before any browser ever loads it.
 */
describe('serve web ui bundles for the browser', () => {
   it('buildWebJsText produces a non-trivial browser bundle', async () => {
      const js = await buildWebJsText(repoRoot)
      // react-dom + mobx are in there: a tiny output means the entry collapsed
      expect(js.length).toBeGreaterThan(100_000)
      expect(js).not.toContain('from "node:')
      expect(js).not.toContain("from 'node:")
   }, 30_000)
})
