import { observable, runInAction } from 'mobx'
import { join } from 'pathe'
import { getLoraTriggerWords } from 'src/host/loraInfoCache.ts'
import { getComfyStorage } from 'src/storage/ComfyStorage.ts'
import { logError } from 'src/utils/log.ts'

/**
 * hand-assigned trigger keyword(s) per lora name — set via ⌃K in the TUI loras
 * overlay, consumed by PromptVar's `loraKeywordsFrom` prefixing. Persisted at
 * `.comfy-ts/lora-keywords.json` (NOT under cache/: this is hand-entered data
 * and must survive a cache wipe). Observable map: overlay rows re-render on
 * assignment. Keys are the RAW lora names (folder/file.safetensors).
 *
 * This file is the OVERRIDE layer. Below it sits the lora-manager mirror's
 * civitai trigger words (src/host/loraInfoCache.ts, refreshed by
 * `comfy-ts loras`), so most loras carry a keyword without anyone typing one.
 * The overlay renders a mirror-sourced keyword dim and a hand-typed one yellow,
 * and ⌃D drops the override to fall back to the mirror again.
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

/** the hand keyword when this lora HAS an entry (`''` included), else the mirror's trigger words */
export function getLoraKeyword(name: string, hostId?: string): string {
   loadOnce()
   const hand = keywords.get(name)
   if (hand != null) return hand
   return getLoraTriggerWords(name, hostId).join(', ')
}

/** true when the keyword shown comes from the lora-manager mirror, not from ⌃K */
export function isLoraKeywordFromMirror(name: string, hostId?: string): boolean {
   loadOnce()
   return !keywords.has(name) && getLoraTriggerWords(name, hostId).length > 0
}

/** what `clearLoraKeywordOverride` would restore this lora to, `''` when nothing */
export function loraKeywordFromMirror(name: string, hostId?: string): string {
   return getLoraTriggerWords(name, hostId).join(', ')
}

/**
 * drop the hand entry entirely, so the mirror's trigger words apply again.
 * The way BACK from an empty-string tombstone: without it, clearing a keyword on
 * a lora that has trigger words was a one-way door only a text editor could undo.
 */
export function clearLoraKeywordOverride(name: string): void {
   loadOnce()
   if (!keywords.has(name)) return
   runInAction(() => void keywords.delete(name))
   writeKeywords()
}

/**
 * empty keyword deletes the entry — EXCEPT when the mirror has trigger words for
 * this lora: there `''` is stored as an explicit tombstone, the only way to say
 * "inject nothing" about a lora civitai gave words to. Every set writes the file
 * (tiny, rare).
 */
export function setLoraKeyword(name: string, keyword: string, hostId?: string): void {
   loadOnce()
   const trimmed = keyword.trim()
   runInAction(() => {
      if (trimmed === '' && getLoraTriggerWords(name, hostId).length === 0) keywords.delete(name)
      else keywords.set(name, trimmed)
   })
   writeKeywords()
}

/** every set writes the file: it is tiny and hand-edited rarely */
function writeKeywords(): void {
   const path = filePath()
   try {
      getComfyStorage().writeText(path, JSON.stringify(Object.fromEntries([...keywords.entries()].sort()), null, 2))
   } catch (e) {
      logError(`[loraKeywords] write failed ${path}: ${String(e)}`)
   }
}
