// films one page of this folder frame by frame: serves trailer/comfy-ts/ on a free port (plus the two type files the
// editor page reads), then asks the house shot service for a stepped clip through window.__trailerStep(t).
//   bun trailer/comfy-ts/film/page.ts <page path> <seconds> <out.mp4|out.png> [key=value…]
import { resolve, join, extname } from 'path'
import { clipUrl, shotUrl } from 'rvlib-shipkit/src/shot/client.ts'

const [page, seconds, out, ...params] = process.argv.slice(2)
// the page's query as separate key=value words, so no film line carries a shell's `&`
const query = params.join('&')
if (page == null || seconds == null || out == null) throw new Error('usage: page.ts <page path> <seconds> <out.mp4|out.png> [key=value…]')

const here = resolve(import.meta.dir, '..')
const repo = resolve(here, '../..')
// the editor reads the published types and the public Comfy Cloud catalog; the one host sdk is the staged project's
const routes: Record<string, string> = {
   '/lib/comfy-ts.d.ts': join(repo, 'dist/index.d.ts'),
   '/lib/cloud-sdk.d.ts': join(repo, 'examples/comfy-cloud/sdk.d.ts'),
   '/icon.png': join(repo, '.shipkit/identity/icon.png'),
   // the app take's types: the sdk comfy-ts gen wrote in the staged project; only the type checker reads it, no take shows
   // a completion or a hover from it
   '/lib/stage-sdk.d.ts': '/tmp/my-project/.comfy-ts/hosts/my-gpu/sdk.d.ts',
}
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ts': 'text/plain', '.png': 'image/png' }

const server = Bun.serve({
   port: 0,
   hostname: '127.0.0.1',
   async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname)
      const file = routes[path] ?? join(here, path)
      if (!file.startsWith(here) && routes[path] == null) return new Response('no', { status: 403 })
      const f = Bun.file(file)
      if (!(await f.exists())) return new Response('not found', { status: 404 })
      return new Response(f, { headers: { 'content-type': types[extname(file)] ?? 'application/octet-stream' } })
   },
})

try {
   const url = `http://127.0.0.1:${server.port}/${page}${query ? `?${query}` : ''}`
   const ask = { url, out: resolve(out), viewport: { width: 1280, height: 720 }, step: '__trailerStep', waitMs: 60_000, root: repo }
   const log = (l: string): void => console.error(l)
   // dom: every page here is html; the terminal's image layer is a canvas over the whole terminal, and the service films
   // a page's largest canvas alone when it covers most of the viewport, which drops the text
   // an out ending in .png is one still, the page stepped to <seconds>: a probe of a frame without a clip
   const r = out.endsWith('.png') ? await shotUrl({ ...ask, at: Number(seconds) }, log) : await clipUrl({ ...ask, seconds: Number(seconds), dom: true }, log)
   console.error(r.note ?? 'filmed')
} finally {
   server.stop(true)
}
