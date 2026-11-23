// world explorer: one world of .comfy-ts/worlds/<name>/ drawn in the browser (a panorama to look around, a mesh to
// walk, a splat to orbit, the source picture), the view page of the `world` thread kind (world-kind.shipkit.ts).
//    bun examples/world-explorer/serve.ts   →  http://127.0.0.1:8293/?key=<world>
// the hub serves this page again through its proxy: every path the page asks is RELATIVE, so the bundle is built with
// publicPath './' and the world files answer under `worlds/<name>/<file>`
import { closeSync, existsSync, openSync, readdirSync, readSync, renameSync, statSync } from 'node:fs'
import { join, resolve } from 'pathe'

const PORT = Number(process.env.PORT ?? 8293)
const ROOT = resolve(import.meta.dir, '../..')
const WORLDS = join(ROOT, '.comfy-ts/worlds')
const WEB = join(import.meta.dir, 'web')

/** the files a world may hold, in the order the page shows their tabs */
const FILES = ['panorama.png', 'world.glb', 'splat.ply', 'source.png', 'thumb.webp'] as const
/** a thumbnail is a few tens of KB: anything far past it is not one */
const THUMB_MAX = 2_000_000

type WorldFile = { name: string; v: string }
type World = { name: string; files: WorldFile[]; splatFov: number | null }

/** the vertical fov of the camera a SHARP ply was made for, from its `intrinsic` (fy at index 4) and `image_size`
 *  elements after the vertices; null when the header names none of them */
function splatFov(path: string): number | null {
   const fd = openSync(path, 'r')
   try {
      const head = Buffer.alloc(4096)
      readSync(fd, head, 0, head.length, 0)
      const end = head.indexOf('end_header\n')
      if (end < 0) return null
      const lines = head.subarray(0, end).toString('latin1').split('\n')
      const sizes: Record<string, number> = { float: 4, uint: 4, int: 4, uchar: 1, double: 8 }
      let offset = end + 'end_header\n'.length
      let el: { name: string; count: number; stride: number } | null = null
      const els: { name: string; count: number; stride: number; at: number }[] = []
      for (const l of lines) {
         const w = l.trim().split(/\s+/)
         if (w[0] === 'element') {
            el = { name: String(w[1]), count: Number(w[2]), stride: 0 }
            els.push({ ...el, at: 0 })
         } else if (w[0] === 'property' && el != null) {
            const last = els[els.length - 1]
            if (last != null) last.stride += sizes[String(w[1])] ?? 4
         }
      }
      for (const e of els) {
         e.at = offset
         offset += e.count * e.stride
      }
      const intr = els.find((e) => e.name === 'intrinsic')
      const size = els.find((e) => e.name === 'image_size')
      if (intr == null || size == null) return null
      const buf = Buffer.alloc(8)
      readSync(fd, buf, 0, 4, intr.at + 4 * 4)
      const fy = buf.readFloatLE(0)
      readSync(fd, buf, 0, 8, size.at)
      const h = buf.readUInt32LE(4)
      if (!(fy > 0 && h > 0)) return null
      return (2 * Math.atan(h / 2 / fy) * 180) / Math.PI
   } finally {
      closeSync(fd)
   }
}

const fovCache = new Map<string, number | null>()

function worldOf(name: string): World | null {
   if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return null
   const dir = join(WORLDS, name)
   if (!existsSync(dir)) return null
   const files: WorldFile[] = []
   for (const f of FILES) {
      const p = join(dir, f)
      if (!existsSync(p)) continue
      const s = statSync(p)
      files.push({ name: f, v: `${s.size.toString(36)}-${Math.round(s.mtimeMs).toString(36)}` })
   }
   const ply = files.find((f) => f.name === 'splat.ply')
   let fov: number | null = null
   if (ply != null) {
      const k = `${name}/${ply.v}`
      if (!fovCache.has(k)) fovCache.set(k, splatFov(join(dir, ply.name)))
      fov = fovCache.get(k) ?? null
   }
   return { name, files, splatFov: fov }
}

function worlds(): World[] {
   if (!existsSync(WORLDS)) return []
   return readdirSync(WORLDS)
      .sort()
      .map(worldOf)
      .filter((w): w is World => w != null && w.files.length > 0)
}

/** the page's bundle, in memory, built again when a file of web/ moved since */
let bundle: { stamp: string; files: Map<string, Blob> } | null = null

function webStamp(): string {
   return readdirSync(WEB)
      .map((f) => `${f}:${statSync(join(WEB, f)).mtimeMs}`)
      .join('|')
}

async function built(): Promise<Map<string, Blob>> {
   const stamp = webStamp()
   if (bundle?.stamp === stamp) return bundle.files
   const started = performance.now()
   const r = await Bun.build({
      entrypoints: [join(WEB, 'index.html')],
      publicPath: './',
      target: 'browser',
      minify: true,
      throw: false,
   })
   if (!r.success) throw new Error(`the page does not build:\n${r.logs.map(String).join('\n')}`)
   const files = new Map<string, Blob>()
   for (const o of r.outputs) files.set(o.path.replace(/^\.\//, ''), o)
   bundle = { stamp, files }
   console.log(`🟢 page built in ${Math.round(performance.now() - started)} ms (${[...files.keys()].join(', ')})`)
   return files
}

const json = (data: unknown, status = 200): Response =>
   Response.json(data, { status, headers: { 'cache-control': 'no-store' } })

const server = Bun.serve({
   port: PORT,
   hostname: '127.0.0.1',
   idleTimeout: 120,
   async fetch(req) {
      const url = new URL(req.url)
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (path === 'api/worlds') return json(worlds())
      // the page renders a world's thumbnail from its first view at the default camera and sends it here
      const t = /^api\/thumb\/([^/]+)$/.exec(path)
      if (t != null && req.method === 'POST') {
         const w = worldOf(String(t[1]))
         if (w == null) return json({ error: `no world ${t[1]}` }, 404)
         const bytes = new Uint8Array(await req.arrayBuffer())
         const webp = bytes.length > 12 && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP'
         if (!webp || bytes.length > THUMB_MAX) return json({ error: 'a thumbnail is a webp under 2 MB' }, 400)
         const dest = join(WORLDS, w.name, 'thumb.webp')
         await Bun.write(`${dest}.tmp`, bytes)
         renameSync(`${dest}.tmp`, dest)
         console.log(`🟢 thumbnail of ${w.name}: ${bytes.length} bytes`)
         return json({ ok: true, bytes: bytes.length })
      }
      const m = /^worlds\/([^/]+)\/([^/]+)$/.exec(path)
      if (m != null) {
         const w = worldOf(String(m[1]))
         const f = w?.files.find((x) => x.name === m[2])
         if (w == null || f == null) return json({ error: `no ${m[2]} in world ${m[1]}` }, 404)
         // a world file weighs 60 to 80 MB: under its stamp it never changes, so the browser keeps it
         const cache = url.searchParams.get('v') === f.v ? 'public, max-age=31536000, immutable' : 'no-cache'
         return new Response(Bun.file(join(WORLDS, w.name, f.name)), { headers: { 'cache-control': cache } })
      }
      try {
         const files = await built()
         const file = files.get(path === '' ? 'index.html' : path)
         if (file == null) return json({ error: `no ${path}` }, 404)
         return new Response(file, { headers: { 'cache-control': 'no-cache' } })
      } catch (e) {
         const message = e instanceof Error ? e.message : String(e)
         console.error(`🔴 ${message}`)
         return new Response(message, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      }
   },
})

console.log(`world explorer → http://127.0.0.1:${server.port}/  (${worlds().length} worlds in ${WORLDS})`)
