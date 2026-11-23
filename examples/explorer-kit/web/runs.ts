// what every explorer page shares: the catalog and samples from its server, the uploaded source
// image, and a sequential run queue (one prompt at a time on the GPU), one RunSt per result key.
import { makeAutoObservable, runInAction } from 'mobx'

export type WeightFile = { node: string; input: string; file: string; folder: string; url: string }

/** a catalog entry as the server sends it (examples/explorer-kit/catalog.ts `entryPayload`) */
export type CardInfo = {
   id: string
   label: string
   family: string
   year: number
   blurb: string
   date: string
   size: string
   quality: number
   speed: string
   autoDownload: boolean
   ok: boolean
   missingNodes: string[]
   missingFiles: WeightFile[]
}

export type Source = { key: string; url: string; name: string; width: number; height: number }

export async function fetchCatalog<M extends CardInfo>(): Promise<{ host: string; models: M[]; samples: string[] }> {
   const [m, s] = await Promise.all([fetch('/api/models'), fetch('/api/samples')])
   const mj = (await m.json()) as { host: string; models: M[] }
   const samples = (await s.json()) as string[]
   return { host: mj.host, models: mj.models, samples }
}

export async function sampleBlob(name: string): Promise<Blob> {
   return (await fetch(`/api/samples/${encodeURIComponent(name)}`)).blob()
}

/** decodes the image and uploads it once to the server, which keys it by its content hash */
export async function uploadSource(blob: Blob, name: string): Promise<Source> {
   const url = URL.createObjectURL(blob)
   const img = new Image()
   img.src = url
   await img.decode()
   const res = await fetch('/api/image', { method: 'POST', body: blob })
   const j = (await res.json()) as { key?: string; error?: string }
   if (j.key == null) throw new Error(j.error ?? 'upload failed')
   return { key: j.key, url, name, width: img.naturalWidth, height: img.naturalHeight }
}

export class RunSt {
   status: 'queued' | 'running' | 'done' | 'error' = 'queued'
   url: string | null = null
   ms: number | null = null
   error: string | null = null
   startedAt = 0
   /** the result's file size and pixel size, once done */
   bytes = 0
   width = 0
   height = 0
   /** 'box': ComfyUI reused an earlier run (`ms` is then the transfer); 'server': the server kept it */
   cached: 'no' | 'box' | 'server' = 'no'
   constructor() {
      makeAutoObservable(this)
   }
}

export type RunBody = { image: string; model: string } & Record<string, unknown>

/** POSTs each job's body to /api/run in turn; the body names the image and the model */
export class RunQueue {
   results = new Map<string, RunSt>()
   private queue: { key: string; body: RunBody; onDone?: (r: RunSt) => void }[] = []
   draining = false
   /** ticks every 200 ms, for the elapsed timers of running cards */
   now = Date.now()

   constructor() {
      makeAutoObservable(this, { results: true })
      setInterval(() => runInAction(() => (this.now = Date.now())), 200)
   }

   get busy(): boolean {
      return this.queue.length > 0 || this.draining
   }

   get(key: string): RunSt | undefined {
      return this.results.get(key)
   }

   /** `onDone`: once this result is in (a page derives a thumbnail from it, say) */
   enqueue(key: string, body: RunBody, onDone?: (r: RunSt) => void): void {
      const prev = this.results.get(key)
      if (prev != null && (prev.status === 'queued' || prev.status === 'running')) return
      this.results.set(key, new RunSt())
      this.queue.push({ key, body, onDone })
      void this.drain()
   }

   /** resolves once the queue is empty */
   settled(): Promise<void> {
      return new Promise((resolve) => {
         const tick = (): void => {
            if (this.busy) setTimeout(tick, 100)
            else resolve()
         }
         tick()
      })
   }

   private async drain(): Promise<void> {
      if (this.draining) return
      this.draining = true
      try {
         for (;;) {
            const job = this.queue.shift()
            if (job == null) break
            const r = this.results.get(job.key)
            if (r == null) continue
            runInAction(() => {
               r.status = 'running'
               r.startedAt = Date.now()
            })
            try {
               const res = await fetch('/api/run', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(job.body),
               })
               if (!res.ok) {
                  const j = (await res.json()) as { error?: string }
                  throw new Error(j.error ?? `http ${res.status}`)
               }
               const blob = await res.blob()
               const url = URL.createObjectURL(blob)
               const img = new Image()
               img.src = url
               await img.decode()
               const ms = Number(res.headers.get('x-ms'))
               const cached = res.headers.get('x-cached')
               runInAction(() => {
                  r.url = url
                  r.ms = ms
                  r.bytes = blob.size
                  r.width = img.naturalWidth
                  r.height = img.naturalHeight
                  r.cached = cached === 'box' || cached === 'server' ? cached : 'no'
                  r.status = 'done'
               })
               job.onDone?.(r)
            } catch (e) {
               runInAction(() => {
                  r.error = e instanceof Error ? e.message : String(e)
                  r.status = 'error'
               })
            }
         }
      } finally {
         runInAction(() => (this.draining = false))
      }
   }
}
