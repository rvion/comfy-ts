import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { Server } from 'bun'
import type { PromptID } from 'src/runner/ComfyWsApi.ts'
import { ComfyTS } from 'src/state.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
const servers: Server[] = []
beforeEach(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
})
afterEach(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
   for (const s of servers.splice(0)) s.stop(true)
})

function countingHost(id: string): { host: ReturnType<ComfyTS['host']>; interrupts: () => number } {
   let n = 0
   const server = Bun.serve({
      port: 0,
      fetch(req: Request): Response {
         if (new URL(req.url).pathname === '/api/interrupt') n++
         return Response.json({})
      },
   })
   servers.push(server)
   const comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-interrupt-')) })
   const host = comfy.host({ id, url: `http://127.0.0.1:${server.port}` })
   return { host, interrupts: () => n }
}

// why we think it is actually a bug, and not just meaning spec should change: several /interrupt
// posts in a burst make the ComfyUI python process quit, and one post already stops the prompt,
// so the repeats carry no intent and only put the host at risk
test('a burst of interrupts for the running prompt reaches the host once', async () => {
   const t = countingHost('interrupt-burst')
   await Promise.all([t.host.interrupt(), t.host.interrupt(), t.host.interrupt(), t.host.interrupt()])
   await t.host.interrupt()
   expect(t.interrupts()).toBe(1)
})

test('control: once the coalesce window is over, a new interrupt is sent', async () => {
   const t = countingHost('interrupt-window')
   t.host.interruptCoalesceMs = 0
   await t.host.interrupt()
   await t.host.interrupt()
   expect(t.interrupts()).toBe(2)
})

test('control: the next prompt starting lets a new interrupt through at once', async () => {
   const t = countingHost('interrupt-next')
   const running = (id: string): void =>
      t.host.routeOrBuffer(id as PromptID, { type: 'executing', data: { prompt_id: id, node: '1' } } as never)
   running('p1')
   await t.host.interrupt()
   running('p2')
   await t.host.interrupt()
   expect(t.interrupts()).toBe(2)
})
