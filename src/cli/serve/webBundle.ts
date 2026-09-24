// web ui bundle resolution (architecture item 12, web ui): prebuilt
// dist/serve-web.js next to the running module, else an in-memory Bun.build
// from source (src/ ships in the npm tarball), rebuilt when a source file changes,
// else null — the api must serve without a UI, never crash
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

/** changes whenever a file under `dir` is added, removed or rewritten. The web bundle reaches
 * outside web/ (vars, protocol types), so the whole src/ tree is the input: ~300 stats, a few ms */
export function sourceSignature(dir: string): string {
   let count = 0
   let newest = 0
   let bytes = 0
   const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
         const abs = join(d, entry.name)
         if (entry.isDirectory()) walk(abs)
         else if (entry.isFile()) {
            const st = statSync(abs)
            count += 1
            bytes += st.size
            newest = Math.max(newest, st.mtimeMs)
         }
      }
   }
   walk(dir)
   return `${count}:${bytes}:${newest}`
}

let prebuiltJs: string | null = null
let fromSource: { signature: string; js: Promise<string | null> } | null = null

/** the runtime resolution chain; every miss logs loud and degrades to api-only. Called on every
 * page load: a prebuilt file is read once, a source build is redone only when src/ changed, so
 * an edited panel shows on refresh under `bun --watch`, which never sees the bundled files */
export async function loadOrBuildWebJs(): Promise<string | null> {
   const here = dirname(fileURLToPath(import.meta.url))
   const prebuilt = join(here, 'serve-web.js')
   if (prebuiltJs != null) return prebuiltJs
   if (existsSync(prebuilt)) {
      prebuiltJs = readFileSync(prebuilt, 'utf8')
      return prebuiltJs
   }
   if (typeof Bun === 'undefined') {
      console.error('[serve] 🔴 no serve-web.js next to the cli and not running under bun — api only, no web ui')
      return null
   }
   const pkgRoot = packageRoot(here)
   if (pkgRoot == null || !existsSync(join(pkgRoot, WEB_ENTRY))) {
      console.error(`[serve] 🔴 web ui source not found (looked for ${WEB_ENTRY} above ${here}) — api only, no web ui`)
      return null
   }
   const signature = sourceSignature(join(pkgRoot, 'src'))
   if (fromSource?.signature !== signature) {
      const rebuilt = fromSource != null
      // a failed build stays failed for this signature: logged once, retried on the next edit
      fromSource = {
         signature,
         js: buildWebJsText(pkgRoot).then(
            (js) => {
               if (rebuilt) console.log('[serve] web ui rebuilt from source')
               return js
            },
            (e: unknown) => {
               console.error('[serve] 🔴 web ui bundle failed — api only until the next edit:', e)
               return null
            },
         ),
      }
   }
   return await fromSource.js
}
