// films the real web panel at work: `comfy-ts serve` over the staged harbor module (its steps a field, so a run samples
// long enough to watch), the panel shown in the cut's window
// frame, a prompt typed and ⌘⏎ pressed by playwright, recorded in real time from chromium's screencast, then trimmed
// to the shot and encoded at the cut's fps. Holds one of the repo's browser slots while it runs.
//   bun trailer/comfy-ts/film/panel.ts <seconds> <out.mp4> [stage dir]
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { browserSlot } from 'rvlib-shipkit/src/shot/browser-slot.ts'

const [seconds, out, stage = '/tmp/my-project'] = process.argv.slice(2)
if (seconds == null || out == null) throw new Error('usage: panel.ts <seconds> <out.mp4> [stage dir]')
const repo = resolve(import.meta.dir, '../../..')
const PORT = 8290
const PROMPT = 'a harbor at night, lanterns, rain'
const FPS = 30

const pw = createRequire(import.meta.resolve('rvlib-shipkit/src/shot/browser-slot.ts'))('playwright') as typeof import('playwright')

const serve = Bun.spawn(['bun', join(repo, 'src/cli/comfy-ts-cli.ts'), 'serve', 'harbor.cflow.ts', '--port', String(PORT)], { cwd: stage, stdout: 'ignore', stderr: 'pipe' })
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
iframe{position:absolute;top:41px;left:0;width:calc(100% / 1.2);height:calc((100% - 41px) / 1.2);transform:scale(1.2);transform-origin:0 0;border:0;background:#fff}
</style></head><body><div id="chrome"><div id="tabs"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span style="margin-left:14px">127.0.0.1:${PORT}</span></div>
<iframe src="http://127.0.0.1:${PORT}/"></iframe></div></body></html>`,
         { headers: { 'content-type': 'text/html' } },
      ),
})

const release = await browserSlot('comfy-ts trailer: the web panel', { root: repo })
const frames = mkdtempSync(join(tmpdir(), 'panel-frames-'))
try {
   for (let i = 0; i < 100; i++) {
      if ((await fetch(`http://127.0.0.1:${PORT}/drafts`).catch(() => null))?.ok) break
      await Bun.sleep(200)
   }
   const browser = await pw.chromium.launch()
   const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
   await page.goto(`http://127.0.0.1:${wrap.port}/`)
   const panel = page.frameLocator('iframe')
   const editor = panel.locator('.prompt-editor .cm-content').first()
   await editor.waitFor({ timeout: 30_000 })
   // the latent preview full size in the running card, so the picture forms where the eye already is
   await panel.locator('button[data-tip^="latent full size"]').click()
   // a new seed each take: the same seed twice is a cache hit on the box, a run with no sampling to watch
   await panel.getByRole('button', { name: 'random', exact: true }).first().click()
   await page.waitForTimeout(1500)

   const cdp = await page.context().newCDPSession(page)
   const shots: { t: number; file: string }[] = []
   cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const file = join(frames, `${String(shots.length).padStart(5, '0')}.jpg`)
      writeFileSync(file, Buffer.from(f.data, 'base64'))
      shots.push({ t: f.metadata.timestamp ?? Date.now() / 1000, file })
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined)
   })
   await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 })
   // room before the typing: the shot may open early so the run lands where the cut wants it
   await page.waitForTimeout(2600)
   const typing = Date.now() / 1000
   await editor.click()
   await page.keyboard.press('Meta+A')
   await page.keyboard.type(PROMPT, { delay: 30 })
   await page.waitForTimeout(350)
   await page.keyboard.press('Meta+Enter')
   const sent = Date.now() / 1000
   // the result lands in the gallery; then a beat to see it
   await panel.locator('img[src*="/outputs/"]').first().waitFor({ timeout: 60_000 })
   const landed = Date.now() / 1000
   await page.waitForTimeout(2000)
   await cdp.send('Page.stopScreencast')
   await browser.close()

   // a constant frame rate: each output frame shows the last screencast frame painted by its time
   const t0 = shots[0]?.t ?? 0
   const n = Math.round(Number(seconds) * FPS)
   const list: string[] = []
   // the shot ends 1 s after the result lands, in real time, so the latent forms at the same moment of every take; it
   // opens earlier when the run was quick, or just before the typing when it was slow, and when the GPU took longer
   // than the shot, the whole take plays faster by one factor (printed, so the cut can say it)
   const start = Math.max(t0, Math.min(typing - 0.25, landed + 1 - Number(seconds)))
   const factor = Math.max(1, (landed + 1 - start) / Number(seconds))
   for (let i = 0, j = 0; i < n; i++) {
      const at = start + (i / FPS) * factor
      while (j + 1 < shots.length && (shots[j + 1]?.t ?? Infinity) <= at) j++
      list.push(`file '${shots[j]?.file}'\nduration ${1 / FPS}`)
   }
   writeFileSync(join(frames, 'list.txt'), list.join('\n') + '\n')
   const ff = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'), '-r', String(FPS), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '16', resolve(out)], { stderr: 'inherit' })
   if (ff.exitCode !== 0) throw new Error('panel: ffmpeg failed')
   console.error(`panel: ${shots.length} screencast frames, ${n} frames at ${FPS} fps, played ${factor.toFixed(2)}x, the run ${(landed - sent).toFixed(2)} s from ${((sent - start) / factor).toFixed(2)} s of the shot`)
} finally {
   release()
   wrap.stop(true)
   serve.kill()
   rmSync(frames, { recursive: true, force: true })
}
