// serve's own slice of `.comfy-ts/settings.json`, under a `serve` key.
// MERGE, never rewrite: the TUI owns the rest of that file and a whole-blob write
// from here would silently drop its preview mode, last draft and lora prefixes.
// Deliberately NOT the TUI's `saveToDisk`: that one governs TUI runs, this one
// governs the api's, so the two surfaces cannot fight over one value.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'pathe'

export type ServeSettings = {
   /** false = generations stay in memory, streamed to the client, nothing written to outputs/ */
   saveToDisk: boolean
   /** module key → host id the runs go to, when it is not the one the module defined
    * (the TUI's host override, per module because serve holds many workflows at once) */
   hostOverride: Record<string, string>
   /** module key → subfolder under outputs/ its images land in. Empty/absent = the module key,
    * which is what serve always used before it was choosable */
   savePrefix: Record<string, string>
}

export const DEFAULT_SERVE_SETTINGS: ServeSettings = { saveToDisk: true, hostOverride: {}, savePrefix: {} }

/** null when no comfyts is registered yet: a ServeApp can be constructed before the global
 * exists (tests do), and reading a setting must degrade to defaults, never throw */
function settingsPath(): string | null {
   const g = globalThis as { comfyts?: { settingsPath?: string } }
   const path = g.comfyts?.settingsPath
   return typeof path === 'string' ? path : null
}

function readBlob(): Record<string, unknown> {
   const path = settingsPath()
   if (path == null || !existsSync(path)) return {}
   try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
         ? (parsed as Record<string, unknown>)
         : {}
   } catch (e) {
      // a corrupt settings file must not take the server down: log loud, use defaults
      console.error(`[serve] settings unreadable (${settingsPath()}), using defaults:`, e)
      return {}
   }
}

function stringMap(raw: unknown): Record<string, string> {
   const out: Record<string, string> = {}
   if (typeof raw === 'object' && raw !== null) {
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v
   }
   return out
}

export function readServeSettings(): ServeSettings {
   const serve = readBlob().serve
   const o = typeof serve === 'object' && serve !== null ? (serve as Record<string, unknown>) : {}
   return {
      saveToDisk: typeof o.saveToDisk === 'boolean' ? o.saveToDisk : DEFAULT_SERVE_SETTINGS.saveToDisk,
      hostOverride: stringMap(o.hostOverride),
      savePrefix: stringMap(o.savePrefix),
   }
}

export function writeServeSettings(next: ServeSettings): void {
   const path = settingsPath()
   // loud: the caller reports "applied for this session but not saved" rather than pretending
   if (path == null) throw new Error('no comfyts instance registered — cannot persist serve settings')
   const blob = readBlob()
   mkdirSync(dirname(path), { recursive: true })
   writeFileSync(path, JSON.stringify({ ...blob, serve: next }, null, 2))
}
