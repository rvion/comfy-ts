// why we think it is actually a bug, and not just meaning spec should change: installModel promises to install a model, and no ComfyUI-Manager since V3 serves POST /model/install (box V3.42 and upstream 4.4 both read), so every call answers 404 and resolves false while the model never lands
import { describe, expect, it } from 'bun:test'
import { ComfyManager } from 'src/host/ComfyManager.ts'
import type { ComfyManagerModelInfo } from 'src/manager/types/ComfyManagerModelInfo.ts'

const model = {
   name: 'TAEF1 Decoder',
   type: 'TAESD',
   base: 'FLUX.1',
   save_path: 'vae_approx',
   description: 'taesd decoder',
   reference: 'https://github.com/madebyollin/taesd',
   filename: 'taef1_decoder.pth',
   url: 'https://github.com/madebyollin/taesd/raw/main/taef1_decoder.pth',
} as ComfyManagerModelInfo

// the V3.42 route table: queue routes only, the old direct install routes 404
function v3Box(): { manager: ComfyManager; calls: string[] } {
   const calls: string[] = []
   let queued = false
   let onDisk = false
   const json = (v: unknown): Response => Response.json(v)
   const manager = new ComfyManager(
      {
         getServerHostHTTP: () => 'http://box:8188',
         fetch: async (route, init) => {
            const method = init?.method ?? 'GET'
            calls.push(`${method} ${route}`)
            if (method === 'GET' && route === '/manager/version') return new Response('V3.42')
            if (method === 'POST' && route === '/manager/queue/install_model') {
               queued = true
               return new Response('')
            }
            if (method === 'POST' && route === '/manager/queue/start') {
               if (queued) onDisk = true
               return new Response('')
            }
            if (method === 'GET' && route === '/manager/queue/status')
               return json({ total_count: 1, done_count: 1, in_progress_count: 0, is_processing: false })
            if (method === 'GET' && route.startsWith('/externalmodel/getlist'))
               return json({ models: [{ ...model, installed: onDisk ? 'True' : 'False' }] })
            if (method === 'POST' && route === '/manager/reboot') throw new Error('socket hang up')
            return new Response('', { status: 404 })
         },
      },
      { pollMs: 1, installTimeoutMs: 200 },
   )
   return { manager, calls }
}

describe('manager install routes (V3.42 table)', () => {
   it('control: reboot already speaks the V3 route', async () => {
      const box = v3Box()
      await box.manager.restartComfyUI()
      expect(box.calls).toContain('POST /manager/reboot')
   })

   it('installModel lands the model through the queue', async () => {
      const box = v3Box()
      expect(await box.manager.installModel(model)).toBe(true)
      expect(box.calls).toContain('POST /manager/queue/install_model')
   })
})
