// web ui bundle resolution (architecture item 12, web ui): prebuilt
// dist/serve-web.js next to the running module, else an in-memory Bun.build
// from source (src/ ships in the npm tarball), else null — the api must serve
// without a UI, never crash
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'

const WEB_ENTRY = 'src/cli/serve/web/main.tsx'

/** nearest dir upward holding a package.json — the comfy-ts package root, from dist/ and src/ alike */
function packageRoot(fromDir: string): string | null {
   let dir = fromDir
   while (true) {
      if (existsSync(join(dir, 'package.json'))) return dir
      const parent = dirname(dir)
      if (parent === dir) return null
      dir = parent
   }
}

/** bundle the web app to one browser file. Bun.build reads no tsconfig, so the
 * house 'src/...' absolute imports resolve through the same plugin shape as
 * tests/web-bundle.test.ts */
export async function buildWebJsText(pkgRoot: string): Promise<string> {
   const result = await Bun.build({
      entrypoints: [join(pkgRoot, WEB_ENTRY)],
      target: 'browser',
      minify: true,
      throw: false,
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [
         {
            name: 'repo-src-paths',
            setup(build) {
               build.onResolve({ filter: /^src\// }, (args) => ({ path: join(pkgRoot, args.path) }))
            },
         },
      ],
   })
   if (!result.success || result.outputs[0] == null)
      throw new Error(`web ui bundle failed:\n${result.logs.map((l) => String(l)).join('\n')}`)
   return await result.outputs[0].text()
}

/** the runtime resolution chain; every miss logs loud and degrades to api-only */
export async function loadOrBuildWebJs(): Promise<string | null> {
   const here = dirname(fileURLToPath(import.meta.url))
   const prebuilt = join(here, 'serve-web.js')
   if (existsSync(prebuilt)) return readFileSync(prebuilt, 'utf8')
   if (typeof Bun === 'undefined') {
      console.error('[serve] 🔴 no serve-web.js next to the cli and not running under bun — api only, no web ui')
      return null
   }
   const pkgRoot = packageRoot(here)
   if (pkgRoot == null || !existsSync(join(pkgRoot, WEB_ENTRY))) {
      console.error(`[serve] 🔴 web ui source not found (looked for ${WEB_ENTRY} above ${here}) — api only, no web ui`)
      return null
   }
   try {
      return await buildWebJsText(pkgRoot)
   } catch (e) {
      console.error('[serve] 🔴 web ui bundle failed — api only:', e)
      return null
   }
}
