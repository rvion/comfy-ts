// can the LAST field of the form be reached by scrolling, at a given window size? Opens a live
// serve panel in headless Chrome (CDP), scrolls every scrollable box as far as it goes, then
// measures the last var row against the viewport. A browser check on purpose: whether a box
// scrolls depends on computed layout, which no headless dom test reproduces.
//
// usage: bun scripts/check-panel-scroll.ts <panel url> [WxH ...]
//   bun scripts/check-panel-scroll.ts 'http://127.0.0.1:8288/?workflow=10-anima-t2i' 1200x600 500x700
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const url = process.argv[2]
const sizes = process.argv.slice(3).length > 0 ? process.argv.slice(3) : ['1200x600', '500x700']
if (url == null) {
   console.error('usage: bun scripts/check-panel-scroll.ts <panel url> [WxH ...]')
   process.exit(2)
}

/** runs in the page: scroll every scrollable box to its end, report where the last row lands */
const PROBE = `(() => {
   const rows = document.querySelectorAll('.var-row')
   const last = rows[rows.length - 1]
   if (last == null) return { error: 'no .var-row on the page' }
   for (let pass = 0; pass < 3; pass++)
      for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) {
         if (el == null) continue
         const style = getComputedStyle(el)
         const scrolls = /(auto|scroll)/.test(style.overflowY) || el === document.scrollingElement
         if (scrolls && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight
      }
   const r = last.getBoundingClientRect()
   return { rows: rows.length, lastBottom: Math.round(r.bottom), viewport: innerHeight, reachable: r.bottom <= innerHeight + 1 }
})()`

async function probe(size: string): Promise<{ ok: boolean; line: string }> {
   const [w, h] = size.split('x').map(Number)
   const port = 9300 + Math.floor(Math.random() * 500)
   const chrome = spawn(CHROME, [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--window-size=${w},${h}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'comfy-ts-chrome-'))}`,
      'about:blank',
   ])
   try {
      let wsUrl: string | null = null
      for (let i = 0; i < 50 && wsUrl == null; i++) {
         await Bun.sleep(200)
         const list = await fetch(`http://127.0.0.1:${port}/json/list`)
            .then((r) => r.json() as Promise<{ type: string; webSocketDebuggerUrl: string }[]>)
            .catch(() => [])
         wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null
      }
      if (wsUrl == null) return { ok: false, line: `${size}: chrome did not start` }
      const ws = new WebSocket(wsUrl)
      await new Promise((r) => ws.addEventListener('open', r, { once: true }))
      let id = 0
      const call = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
         new Promise((resolve) => {
            const my = ++id
            const on = (ev: MessageEvent): void => {
               const msg = JSON.parse(String(ev.data)) as { id?: number; result?: Record<string, unknown> }
               if (msg.id !== my) return
               ws.removeEventListener('message', on)
               resolve(msg.result ?? {})
            }
            ws.addEventListener('message', on)
            ws.send(JSON.stringify({ id: my, method, params }))
         })
      await call('Page.navigate', { url })
      // the panel boots, loads its draft, then lays out: give it a moment
      await Bun.sleep(3500)
      const res = await call('Runtime.evaluate', { expression: PROBE, returnByValue: true })
      const value = (res.result as { value?: Record<string, unknown> } | undefined)?.value ?? {}
      ws.close()
      if (typeof value.error === 'string') return { ok: false, line: `${size}: ${value.error}` }
      return {
         ok: value.reachable === true,
         line: `${size}: ${value.rows} rows, last row bottom ${value.lastBottom}px, viewport ${value.viewport}px → ${value.reachable === true ? 'reachable' : 'CUT OFF'}`,
      }
   } finally {
      chrome.kill()
   }
}

let failed = 0
for (const size of sizes) {
   const r = await probe(size)
   console.log(`${r.ok ? '🟢' : '🔴'} ${r.line}`)
   if (!r.ok) failed++
}
process.exit(failed === 0 ? 0 : 1)
