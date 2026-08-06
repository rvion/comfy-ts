// serve's own slice of `.comfy-ts/settings.json`, under a `serve` key.
// MERGE, never rewrite: the TUI owns the rest of that file and a whole-blob write
// from here would silently drop its preview mode, last draft and lora prefixes.
// Deliberately NOT the TUI's `saveToDisk`: that one governs TUI runs, this one
// governs the api's, so the two surfaces cannot fight over one value.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stringMap } from 'src/utils/stringMap.ts'
import { validSavePrefix } from 'src/cli/serve/safeName.ts'
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

const DEFAULT_SERVE_SETTINGS: ServeSettings = { saveToDisk: true, hostOverride: {}, savePrefix: {} }

/** null when no comfyts is registered yet: a ServeApp can be constructed before the global
 * exists (tests do), and reading a setting must degrade to defaults, never throw */
function settingsPath(): string | null {
   const g = globalThis as { comfyts?: { settingsPath?: string } }
   const path = g.comfyts?.settingsPath
   return typeof path === 'string' ? path : null
}

/** `readable: false` says the file EXISTS but could not be parsed — the one case where a write
 * must refuse. Merging onto `{}` there would rewrite the file from nothing and take the TUI's
 * keys with it, and these files are documented as hand-editable, so the user would lose the
 * chance to repair it. */
function readBlob(): { blob: Record<string, unknown>; readable: boolean } {
   const path = settingsPath()
   if (path == null || !existsSync(path)) return { blob: {}, readable: true }
   try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      const ok = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      if (!ok) console.error(`[serve] settings is not an object (${path}), using defaults`)
      return { blob: ok ? (parsed as Record<string, unknown>) : {}, readable: ok }
   } catch (e) {
      // reading must not take the server down: log loud, use defaults, and refuse to WRITE
      console.error(`[serve] settings unreadable (${path}), using defaults:`, e)
      return { blob: {}, readable: false }
   }
}

function filterValues(map: Record<string, string>, keep: (v: string) => boolean): Record<string, string> {
   const out: Record<string, string> = {}
   for (const [k, v] of Object.entries(map)) if (keep(v)) out[k] = v
   return out
}

export function readServeSettings(): ServeSettings {
   const serve = readBlob().blob.serve
   const o = typeof serve === 'object' && serve !== null ? (serve as Record<string, unknown>) : {}
   return {
      saveToDisk: typeof o.saveToDisk === 'boolean' ? o.saveToDisk : DEFAULT_SERVE_SETTINGS.saveToDisk,
      hostOverride: stringMap(o.hostOverride),
      // validated on the way IN as well as on the way out: PUT /settings gates it, but a
      // hand-written file did not go through that route, and this value becomes an output
      // directory. One gate on one side is not a gate
      savePrefix: filterValues(stringMap(o.savePrefix), (prefix) => validSavePrefix(prefix) != null),
   }
}

export function writeServeSettings(next: ServeSettings): void {
   const path = settingsPath()
   // loud: the caller reports "applied for this session but not saved" rather than pretending
   if (path == null) throw new Error('no comfyts instance registered — cannot persist serve settings')
   const current = readBlob()
   if (!current.readable)
      throw new Error(
         `serve settings not saved: ${path} is not readable json. Fix or delete it — overwriting would drop the keys it still holds`,
      )
   mkdirSync(dirname(path), { recursive: true })
   writeFileSync(path, JSON.stringify({ ...current.blob, serve: next }, null, 2))
}
