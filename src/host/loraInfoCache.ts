import { join } from 'pathe'
import { getComfyStorage } from 'src/storage/ComfyStorage.ts'
import {
   type LmLoraItem,
   lmBaseModel,
   lmFileName,
   lmFilePath,
   lmFolder,
   lmItemKey,
   lmModelName,
   lmPreviewUrl,
   lmTags,
   lmTrainedWords,
   loraBasename,
   loraKey,
} from 'src/host/loraManagerApi.ts'
import type { AbsolutePath } from 'src/types/index.ts'
import { isRecord } from 'src/utils/isRecord.ts'
import { logError } from 'src/utils/log.ts'

/**
 * the LOCAL MIRROR of what ComfyUI-Lora-Manager knows about a host's loras
 * (agent/architecture.md item 8). A ComfyUI host only ever tells us a lora's
 * file name; the model's real name, its trigger words and its tags live in the
 * extension. We sweep them once (`comfy-ts loras`) into
 * `.comfy-ts/hosts/<id>/loras.json` and every surface reads the mirror after.
 */

export type LoraMirror = {
   hostId: string
   /** remembered so a later `comfy-ts loras` re-syncs with no flags. NEVER an api key. */
   hostUrl: string
   fetchedAt: string
   count: number
   /** `loraKey` → the RAW lm item */
   loras: Record<string, LmLoraItem>
}

function loraMirrorPath(hostId: string): AbsolutePath {
   return comfyts.resolveFromHosts(join(hostId, 'loras.json'))
}

/** pure: the on-disk shape for a sweep. Items without a file_name are dropped (nothing to key them by). */
export function buildLoraMirror(p: {
   hostId: string
   hostUrl: string
   fetchedAt: string
   items: LmLoraItem[]
}): LoraMirror {
   const loras: Record<string, LmLoraItem> = {}
   for (const item of p.items) {
      const key = lmItemKey(item)
      if (key == null) continue
      // `x.safetensors` and `x.pt` in one folder collapse here: one lora would
      // silently inherit the other's trigger words, so say it out loud
      if (loras[key] != null) logError(`[loraInfoCache] two loras share the key '${key}' — one of them is shadowed`)
      loras[key] = item
   }
   return {
      hostId: p.hostId,
      hostUrl: p.hostUrl,
      fetchedAt: p.fetchedAt,
      count: Object.keys(loras).length,
      loras,
   }
}

export function writeLoraMirror(mirror: LoraMirror): AbsolutePath {
   const path = loraMirrorPath(mirror.hostId)
   getComfyStorage().writeText(path, JSON.stringify(mirror, null, 2))
   return path
}

/** null = never synced (or unreadable, which is LOGGED) */
export function readLoraMirror(hostId: string): LoraMirror | null {
   const path = loraMirrorPath(hostId)
   const text = getComfyStorage().readTextIfExists(path)
   if (text == null) return null
   try {
      const raw: unknown = JSON.parse(text)
      if (!isRecord(raw)) return null
      const rawLoras = raw['loras']
      if (!isRecord(rawLoras)) return null
      const loras: Record<string, LmLoraItem> = {}
      for (const [key, item] of Object.entries(rawLoras)) if (isRecord(item)) loras[key] = item
      const str = (key: string, fallback: string): string => {
         const v = raw[key]
         return typeof v === 'string' ? v : fallback
      }
      // count is RECOUNTED, never trusted: the file is hand-editable like every .comfy-ts json
      return {
         hostId: str('hostId', hostId),
         hostUrl: str('hostUrl', ''),
         fetchedAt: str('fetchedAt', ''),
         count: Object.keys(loras).length,
         loras,
      }
   } catch (e) {
      logError(`[loraInfoCache] unreadable ${path}: ${String(e)}`)
      return null
   }
}

/**
 * the read model: each registered host's mirror, kept PER HOST.
 *
 * Per host, not merged into one map, because the same file name on two hosts is
 * routinely a different model. A merged map served whichever host loaded first,
 * so on the other host the overlay showed the wrong model name and the prompt
 * silently received the wrong trigger words — a bad generation with no error
 * anywhere. Callers that know their host say so; the rest fall back to any host
 * that has the lora, which is still better than nothing for a display name.
 *
 * Plain (non-observable) on purpose: the loras overlay reads this from inside a
 * mobx render. The storage seam has no readdir, so the host set comes from
 * `comfyts.hosts` — exactly the hosts this process can be asked about.
 */
const byHost = new Map<string, Map<string, LmLoraItem>>()
/** hosts already looked for, INCLUDING the ones with no mirror on disk → their mtime is null */
const loadedMtimes = new Map<string, number | null>()

/** cheap: no stat, no parse — this runs inside the overlay's render for every row */
function ensureLoaded(): void {
   for (const hostId of comfyts.hosts.keys()) if (!loadedMtimes.has(hostId)) loadHost(hostId)
}

function loadHost(hostId: string): void {
   const storage = getComfyStorage()
   const path = loraMirrorPath(hostId)
   loadedMtimes.set(hostId, storage.mtimeMs(path))
   const mirror = readLoraMirror(hostId)
   if (mirror != null) byHost.set(hostId, new Map(Object.entries(mirror.loras)))
   // a mirror that EXISTS but will not parse (a sync killed mid-write) still makes
   // this host authoritative, with an empty map: falling through to another host's
   // entries is exactly the wrong-model-name bug the per-host split removed
   else if (storage.exists(path)) byHost.set(hostId, new Map())
   else byHost.delete(hostId)
}

/**
 * re-read any mirror whose file changed (or appeared) since we loaded it.
 * `comfy-ts loras` in another terminal is the normal case, and without this a
 * TUI session kept the stale data — or kept knowing NOTHING, for a host whose
 * first sync happened while it was open. One stat per registered host, so this
 * belongs at user-initiated moments (opening the loras overlay), never in a render.
 */
export function refreshLoraInfoCacheIfChanged(): void {
   const storage = getComfyStorage()
   for (const hostId of comfyts.hosts.keys()) {
      const seen = loadedMtimes.get(hostId)
      const now = storage.mtimeMs(loraMirrorPath(hostId))
      // `undefined` = never looked; `null` = looked, no file. Both differ from a real mtime.
      if (!loadedMtimes.has(hostId) || seen !== now) loadHost(hostId)
   }
}

/** forget everything loaded, so the next read re-reads from disk (tests, and a hard refresh) */
export function reloadLoraInfoCache(): void {
   byHost.clear()
   loadedMtimes.clear()
}

/**
 * the lm item for a raw lora name (`styles\x.safetensors`).
 * `hostId` picks the mirror that actually describes this host's file; without
 * it, any host that knows the name answers. null when unsynced/unknown.
 */
export function getLoraInfo(name: string, hostId?: string): LmLoraItem | null {
   ensureLoaded()
   const key = loraKey(name)
   if (hostId != null) {
      const own = byHost.get(hostId)
      // a host WITH a mirror is authoritative about its own loras: never fall
      // back to another host's entry for a lora it does not have
      if (own != null) return own.get(key) ?? null
   }
   for (const mirror of byHost.values()) {
      const hit = mirror.get(key)
      if (hit != null) return hit
   }
   return null
}

/** civitai trigger words for this lora, in civitai's order */
export function getLoraTriggerWords(name: string, hostId?: string): string[] {
   const info = getLoraInfo(name, hostId)
   return info == null ? [] : lmTrainedWords(info)
}

/** the human name (`Aurora Ink Wash`), falling back to the file's own name */
export function getLoraDisplayName(name: string, hostId?: string): string {
   const info = getLoraInfo(name, hostId)
   return (info == null ? null : lmModelName(info)) ?? loraBasename(name)
}

/** server-relative preview url from the mirror, null when unsynced/unknown */
export function getLoraPreviewUrl(name: string, hostId?: string): string | null {
   const info = getLoraInfo(name, hostId)
   return info == null ? null : lmPreviewUrl(info)
}

/** the lora's NAMES: the file, and the model name a human would call it by */
/**
 * every lora the mirror knows for a host: its normalized KEY (comparable with `loraKey(option)`,
 * never with a raw enum value — those keep their case, extension and windows separators) and the
 * NAME a ComfyUI graph would load it by, rebuilt from the manager's folder + real filename.
 * `[]` when the host was never synced.
 */
export function loraMirrorEntries(
   hostId: string,
   p: { separator?: '/' | '\\' } = {},
): {
   key: string
   serverName: string
}[] {
   ensureLoaded()
   const sep = p.separator ?? '/'
   const out: { key: string; serverName: string }[] = []
   for (const [key, item] of byHost.get(hostId) ?? []) {
      // file_path carries the extension the enum value needs; file_name may not
      const filePath = lmFilePath(item)
      const base = filePath == null ? null : (filePath.split(/[/\\]/).pop() ?? null)
      const file = base ?? lmFileName(item)
      if (file == null) continue
      const folder = lmFolder(item)
      // the manager's own `folder` can be a NESTED path with its own separators, so the whole
      // name is normalized to the host's style, never just the join (8 of 119 came out mixed)
      const joined = folder === '' ? file : `${folder}/${file}`
      out.push({ key, serverName: joined.replaceAll(/[\\/]/g, sep) })
   }
   return out.sort((a, b) => a.serverName.localeCompare(b.serverName))
}

export function loraSearchNames(name: string, hostId?: string): string[] {
   const names = [loraBasename(name), name.replaceAll('\\', '/')]
   const info = getLoraInfo(name, hostId)
   const modelName = info == null ? null : lmModelName(info)
   if (modelName != null) names.push(modelName)
   return names
}

/** the lora's FREE TEXT: tags, base model, trigger words */
export function loraSearchText(name: string, hostId?: string): string[] {
   const info = getLoraInfo(name, hostId)
   if (info == null) return []
   const text = [...lmTags(info), ...lmTrainedWords(info)]
   const baseModel = lmBaseModel(info)
   if (baseModel != null) text.push(baseModel)
   return text
}

/**
 * the loras overlay filter: find a lora by its human name, not only by the file
 * name. EVERY whitespace-separated token must be a SUBSTRING of some field — order
 * free, so `aurora ink`, `ink aurora` and `styles wash` all land on the same
 * lora. NOT fuzzyMatch: a subsequence match over phrases this long matches
 * nearly everything. Measured on a real collection, filtering by each lora's
 * own file name: this rule peaks at 8 hits where fuzzyMatch matched a third of
 * every lora present.
 * Fields are matched one by one, never as a concatenated haystack, for the same
 * reason. `tests/lora-corpus.private.test.ts` keeps that measurement runnable.
 */
export function loraMatchesFilter(name: string, filter: string, hostId?: string): boolean {
   const tokens = filter
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t !== '')
   if (tokens.length === 0) return true
   const fields = [...loraSearchNames(name, hostId), ...loraSearchText(name, hostId)].map((f) => f.toLowerCase())
   return tokens.every((token) => fields.some((field) => field.includes(token)))
}
