// the serve process's memory of its last runs: a page reload (or a second window) shows them
// again. Unsaved outputs keep their bytes here, the ONLY copy, under one byte budget, FIFO.
// Nothing is written to disk: a server restart forgets it all. PURE, headless-tested

export type RunOutput = { filename: string; url: string | null; absPath: string | null }
export type RunAudioOutput = RunOutput & { mime: string }

/** the run reply `POST /generate` answers, and what `GET /results` lists */
export type RunRecord = {
   ok: true
   module: string
   draft: string
   promptId: string
   durationMs: number
   /** epoch ms: the panel formats it, the server's clock is the one every window shares */
   finishedAt: number
   seeds: Record<string, number>
   savedToDisk: boolean
   texts: { nodeKey: string | null; text: string }[]
   images: RunOutput[]
   audios: RunAudioOutput[]
}

export type MemoryUsage = { usedBytes: number; budgetBytes: number; outputs: number; runs: number }

/** the bytes of one unsaved output, under the key its url names */
export type KeptBlob = { key: string; bytes: Uint8Array; contentType: string }

/** how many runs the list keeps, saved or not. The panel shows as many */
export const KEPT_RUNS = 50

export const DEFAULT_MEMORY_BUDGET_MB = 100

/** a run and the memory key of each output (null = saved on disk, or never had bytes) */
type Kept = { record: RunRecord; imageKeys: (string | null)[]; audioKeys: (string | null)[] }

export class ResultHistory {
   /** newest first */
   private runs: Kept[] = []
   /** insertion order IS the eviction order */
   private blobs = new Map<string, { bytes: Uint8Array; contentType: string }>()
   private used = 0

   constructor(private budgetBytes: number) {}

   add(p: { record: RunRecord; imageKeys: (string | null)[]; audioKeys: (string | null)[]; blobs: KeptBlob[] }): void {
      this.remove(p.record.promptId)
      for (const b of p.blobs) {
         this.blobs.set(b.key, { bytes: b.bytes, contentType: b.contentType })
         this.used += b.bytes.byteLength
      }
      this.runs = [{ record: p.record, imageKeys: p.imageKeys, audioKeys: p.audioKeys }, ...this.runs]
      for (const dropped of this.runs.slice(KEPT_RUNS)) this.freeRun(dropped)
      this.runs = this.runs.slice(0, KEPT_RUNS)
      this.evict()
   }

   blob(key: string): { bytes: Uint8Array; contentType: string } | null {
      return this.blobs.get(key) ?? null
   }

   /** an output whose bytes were evicted lists with url null: the panel says it is gone */
   list(): RunRecord[] {
      return this.runs.map((k) => ({
         ...k.record,
         images: k.record.images.map((img, ix) => this.withLiveUrl(img, k.imageKeys[ix])),
         audios: k.record.audios.map((a, ix) => this.withLiveUrl(a, k.audioKeys[ix])),
      }))
   }

   remove(promptId: string): void {
      const hit = this.runs.find((k) => k.record.promptId === promptId)
      if (hit == null) return
      this.freeRun(hit)
      this.runs = this.runs.filter((k) => k !== hit)
   }

   clear(): void {
      this.runs = []
      this.blobs.clear()
      this.used = 0
   }

   setBudget(bytes: number): void {
      this.budgetBytes = bytes
      this.evict()
   }

   usage(): MemoryUsage {
      return { usedBytes: this.used, budgetBytes: this.budgetBytes, outputs: this.blobs.size, runs: this.runs.length }
   }

   private withLiveUrl<T extends RunOutput>(out: T, key: string | null | undefined): T {
      if (key == null || this.blobs.has(key)) return out
      return { ...out, url: null }
   }

   private freeRun(k: Kept): void {
      for (const key of [...k.imageKeys, ...k.audioKeys]) {
         if (key == null) continue
         const b = this.blobs.get(key)
         if (b == null) continue
         this.used -= b.bytes.byteLength
         this.blobs.delete(key)
      }
   }

   /** the NEWEST output always stays, even alone over budget: the run that just finished must
    * not reply with a url that already 404s */
   private evict(): void {
      while (this.used > this.budgetBytes && this.blobs.size > 1) {
         const oldest = this.blobs.entries().next()
         if (oldest.done === true) break
         this.used -= oldest.value[1].bytes.byteLength
         this.blobs.delete(oldest.value[0])
      }
      // a run with nothing left to show is noise in the list
      this.runs = this.runs.filter((k) => {
         const live = (keys: (string | null)[]): boolean => keys.some((key) => key == null || this.blobs.has(key))
         const hasText = k.record.texts.length > 0
         const hasNothing = k.record.images.length === 0 && k.record.audios.length === 0
         return hasText || hasNothing || live(k.imageKeys) || live(k.audioKeys)
      })
   }
}
