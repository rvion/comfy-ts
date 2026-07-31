import { observable, runInAction } from 'mobx'
import { join } from 'pathe'
import { getComfyStorage } from 'src/storage/ComfyStorage.ts'
import { logError } from 'src/utils/log.ts'

/**
 * hand-assigned trigger keyword(s) per lora name — set via ⌃K in the TUI loras
 * overlay, consumed by PromptVar's `loraKeywordsFrom` prefixing. Persisted at
 * `.comfy-ts/lora-keywords.json` (NOT under cache/: this is hand-entered data
 * and must survive a cache wipe). Observable map: overlay rows re-render on
 * assignment. Keys are the RAW lora names (folder/file.safetensors).
 */
const keywords = observable.map<string, string>()
let loaded = false

function filePath(): string {
   return join(comfyts.baseFolder, 'lora-keywords.json')
}

function loadOnce(): void {
   if (loaded) return
   loaded = true
   const path = filePath()
   const text = getComfyStorage().readTextIfExists(path)
   if (text == null) return
   try {
      const raw: unknown = JSON.parse(text)
      if (raw == null || typeof raw !== 'object') return
      runInAction(() => {
         for (const [name, kw] of Object.entries(raw)) if (typeof kw === 'string') keywords.set(name, kw)
      })
   } catch (e) {
      logError(`[loraKeywords] unreadable ${path}: ${String(e)}`)
   }
}

export function getLoraKeyword(name: string): string {
   loadOnce()
   return keywords.get(name) ?? ''
}

/** empty keyword deletes the entry; every set writes the file (tiny, rare) */
export function setLoraKeyword(name: string, keyword: string): void {
   loadOnce()
   const trimmed = keyword.trim()
   runInAction(() => {
      if (trimmed === '') keywords.delete(name)
      else keywords.set(name, trimmed)
   })
   const path = filePath()
   try {
      getComfyStorage().writeText(path, JSON.stringify(Object.fromEntries([...keywords.entries()].sort()), null, 2))
   } catch (e) {
      logError(`[loraKeywords] write failed ${path}: ${String(e)}`)
   }
}
