// dev server for the browser example: bundles example.ts with the SAME
// browser target the guard test enforces, serves it with index.html.
//    bun examples/web/serve.ts   →  http://127.0.0.1:8290
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '../..')

const result = await Bun.build({
   entrypoints: [join(here, 'example.ts')],
   target: 'browser',
   minify: false,
   plugins: [
      {
         name: 'repo-paths',
         setup(build) {
            build.onResolve({ filter: /^comfy-ts\/web$/ }, () => ({ path: join(repoRoot, 'src/web.ts') }))
            build.onResolve({ filter: /^src\// }, (args) => ({ path: join(repoRoot, args.path) }))
         },
      },
   ],
})
if (!result.success) {
   console.error(result.logs.join('\n'))
   throw new Error('example bundle failed')
}
const first = result.outputs[0]
if (first == null) throw new Error('no bundle output')
const bundle = await first.text()

const server = Bun.serve({
   port: 8290,
   hostname: '127.0.0.1',
   fetch: (req) => {
      const path = new URL(req.url).pathname
      if (path === '/example.js') return new Response(bundle, { headers: { 'content-type': 'text/javascript' } })
      return new Response(Bun.file(join(here, 'index.html')))
   },
})
console.log(`comfy-ts/web example → http://127.0.0.1:${server.port}/`)
console.log(`point it at a ComfyUI started with: --enable-cors-header '*'`)
