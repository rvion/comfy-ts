// films the export beat on a real ComfyUI canvas: the staged scenery module exported as workflow.json
// (stage/export.ts) is loaded into the ComfyUI page of the comfyui global process, shown in the cut's window frame;
// the graph is on the canvas from the first frame (the page settles its own view first), then a slow push in. Frame
// by frame: each frame sets the canvas
// view, then one screenshot. An out ending in .png is one still at <seconds>, to read before a take.
//   bun trailer/comfy-ts/film/canvas.ts <seconds> <out.mp4|out.png> [workflow.json]
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { browserSlot } from 'rvlib-shipkit/src/shot/browser-slot.ts'

const [seconds, out, graph = '/tmp/my-project/scenery.workflow.json'] = process.argv.slice(2)
if (seconds == null || out == null) throw new Error('usage: canvas.ts <seconds> <out.mp4|out.png> [workflow.json]')
const repo = resolve(import.meta.dir, '../../..')
const COMFY = 'http://127.0.0.1:8085'
const FPS = 30
const LAND = 0
const still = out.endsWith('.png')
// the graph is exported again on every take, from the staged module as it stands
const exported = Bun.spawnSync(['bun', join(import.meta.dir, '../stage/export.ts')], { cwd: '/tmp/my-project', stderr: 'inherit' })
if (exported.exitCode !== 0) throw new Error('canvas: stage/export.ts failed')
const workflow = JSON.parse(readFileSync(graph, 'utf8'))

const pw = createRequire(import.meta.resolve('rvlib-shipkit/src/shot/browser-slot.ts'))('playwright') as typeof import('playwright')

const wrap = Bun.serve({
   port: 0,
   hostname: '127.0.0.1',
   fetch: () =>
      new Response(
         `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0b1220;overflow:hidden}
#chrome{position:absolute;left:56px;right:56px;top:172px;bottom:16px;background:#0f1a2e;border:1px solid #1d2b45;border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45)}
#tabs{height:40px;display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid #1d2b45;font:600 15px monospace;color:#c9d6ee}
.dot{width:11px;height:11px;border-radius:50%;background:#2a3a58}
iframe{position:absolute;top:41px;left:0;width:100%;height:calc(100% - 41px);border:0;background:#202020}
</style></head><body><div id="chrome"><div id="tabs"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span style="margin-left:14px">ComfyUI · scenery.workflow.json</span></div>
<iframe src="${COMFY}/"></iframe></div></body></html>`,
         { headers: { 'content-type': 'text/html' } },
      ),
})

const release = await browserSlot('comfy-ts trailer: the ComfyUI canvas', { root: repo })
const frames = mkdtempSync(join(tmpdir(), 'canvas-frames-'))
try {
   const browser = await pw.chromium.launch()
   const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
   await page.goto(`http://127.0.0.1:${wrap.port}/`)
   let frame = page.frames().find((f) => f.url().startsWith(COMFY))
   for (let i = 0; frame == null && i < 100; i++) {
      await page.waitForTimeout(100)
      frame = page.frames().find((f) => f.url().startsWith(COMFY))
   }
   if (frame == null) throw new Error('canvas: the ComfyUI frame never loaded')
   type W = { app: any }
   await frame.waitForFunction(() => (window as unknown as W).app?.canvas?.ds != null, null, { timeout: 60_000 })
   await page.waitForTimeout(1500)
   // a fresh profile: no dialog, no side panel, an empty canvas before the drop
   for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
   // focus mode: the canvas alone, none of the box's own panels (its job history, its extensions' buttons)
   await frame.evaluate(async () => {
      const app = (window as unknown as W).app
      await app.extensionManager?.command?.execute?.('Workspace.ToggleFocusMode')
      app.canvas.show_info = false
      app.graph.clear()
      app.canvas.setDirty(true, true)
   })
   await page.waitForTimeout(300)

   // the view the push in starts from and ends on, measured once the graph is on the canvas
   const view = async (t: number): Promise<void> => {
      await frame.evaluate(
         async ([t, land, wf]) => {
            const app = (window as unknown as W).app
            const g = window as unknown as { __landed?: boolean; __fit?: { scale: number; offset: [number, number] } }
            if (t >= land && !g.__landed) {
               await app.loadGraphData(wf, true, false)
               await new Promise((r) => setTimeout(r, 300))
               g.__landed = true
               app.canvas.ds.reset?.()
               const nodes = app.graph._nodes as { pos: [number, number]; size: [number, number] }[]
               const minX = Math.min(...nodes.map((n) => n.pos[0]))
               const minY = Math.min(...nodes.map((n) => n.pos[1] - 30))
               const maxX = Math.max(...nodes.map((n) => n.pos[0] + n.size[0]))
               const maxY = Math.max(...nodes.map((n) => n.pos[1] + n.size[1]))
               const c = app.canvas.canvas as HTMLCanvasElement
               const w = c.clientWidth
               const h = c.clientHeight
               const scale = Math.min((w * 0.84) / (maxX - minX), (h * 0.8) / (maxY - minY))
               g.__fit = { scale, offset: [(w / scale - (maxX - minX)) / 2 - minX, (h / scale - (maxY - minY)) / 2 - minY] }
            }
            if (g.__fit) {
               // a slow push in toward the sampler side of the graph, 12 % over the shot
               const k = 1 + 0.12 * Math.max(0, t - land) / 5
               const ds = app.canvas.ds
               const c = app.canvas.canvas as HTMLCanvasElement
               ds.scale = g.__fit.scale * k
               const cx = c.clientWidth / 2
               const cy = c.clientHeight / 2
               ds.offset[0] = g.__fit.offset[0] - (cx / g.__fit.scale - cx / ds.scale)
               ds.offset[1] = g.__fit.offset[1] - (cy / g.__fit.scale - cy / ds.scale)
            }
            app.canvas.setDirty(true, true)
            app.canvas.draw(true, true)
         },
         [t, LAND, workflow] as const,
      )
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
   }

   // the page moves its view by itself for a moment after a load: settle before the first frame
   await view(LAND)
   await page.waitForTimeout(1500)
   if (still) {
      await view(Number(seconds))
      await page.screenshot({ path: resolve(out) })
   } else {
      const n = Math.round(Number(seconds) * FPS)
      for (let i = 0; i < n; i++) {
         await view(i / FPS)
         await page.screenshot({ path: join(frames, `${String(i).padStart(5, '0')}.png`) })
      }
      const ff = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-framerate', String(FPS), '-i', join(frames, '%05d.png'), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '16', resolve(out)], { stderr: 'inherit' })
      if (ff.exitCode !== 0) throw new Error('canvas: ffmpeg failed')
      console.error(`canvas: ${n} frames at ${FPS} fps`)
   }
   await browser.close()
} finally {
   release()
   wrap.stop(true)
   rmSync(frames, { recursive: true, force: true })
}
