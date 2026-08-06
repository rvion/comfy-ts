import { type } from 'arktype'
import { basename } from 'pathe'
import { getComfyStorage } from 'src/storage/ComfyStorage.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import { isRecord } from 'src/utils/isRecord.ts'
import { sha1HexOfString } from 'src/utils/sha1.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { logError } from 'src/utils/log.ts'

/**
 * client for the OPTIONAL ComfyUI-Lora-Manager extension.
 * absent extension = normal condition: callers get null/empty and degrade.
 */

/**
 * one lora exactly as lora-manager sent it. RAW on purpose (agent/architecture
 * item 8): the mirror on disk keeps every field, including the ones we do not
 * read yet, so adding `sha256` or `civitai.modelId` to a surface later is an
 * accessor, not a re-sync. Reading goes through the checked lm* helpers below.
 */
export type LmLoraItem = Record<string, unknown>

/** only the ENVELOPE is schema'd — items stay unknown so nothing can strip their fields */
const lmLoraPage = type({
   items: 'unknown[]',
   'total?': 'number',
})

function readString(item: LmLoraItem, key: string): string | null {
   const v = item[key]
   return typeof v === 'string' && v !== '' ? v : null
}

function readStringArray(item: LmLoraItem, key: string): string[] {
   const v = item[key]
   if (!Array.isArray(v)) return []
   return v.filter((x): x is string => typeof x === 'string' && x !== '')
}

export function lmFileName(item: LmLoraItem): string | null {
   return readString(item, 'file_name')
}
export function lmFolder(item: LmLoraItem): string {
   return readString(item, 'folder') ?? ''
}
export function lmModelName(item: LmLoraItem): string | null {
   return readString(item, 'model_name')
}
export function lmBaseModel(item: LmLoraItem): string | null {
   return readString(item, 'base_model')
}
export function lmPreviewUrl(item: LmLoraItem): string | null {
   return readString(item, 'preview_url')
}
/** the file's size in bytes, when the extension reports it */
/** the file's content hash: what the extension keys its example images by */
export function lmSha256(item: LmLoraItem): string | null {
   return readString(item, 'sha256')
}

export function lmFileSize(item: LmLoraItem): number | null {
   const raw = item['file_size']
   return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/** the note YOU wrote in the lora manager, empty when there is none */
export function lmNotes(item: LmLoraItem): string {
   return readString(item, 'notes') ?? ''
}

/** the civitai block: what links a local file back to the page it came from */
export function lmCivitai(item: LmLoraItem): { modelId: number | null; name: string | null } | null {
   const civitai = item['civitai']
   if (!isRecord(civitai)) return null
   const modelId = civitai['modelId']
   return {
      modelId: typeof modelId === 'number' && Number.isFinite(modelId) ? modelId : null,
      name: readString(civitai, 'name'),
   }
}

export function lmTags(item: LmLoraItem): string[] {
   return readStringArray(item, 'tags')
}

/** the trigger words: civitai's `trainedWords`, absent for a lora nobody published */
export function lmTrainedWords(item: LmLoraItem): string[] {
   const civitai = item['civitai']
   if (!isRecord(civitai)) return []
   return readStringArray(civitai, 'trainedWords')
}

/** lm's own absolute path for the file, as it exists on the HOST's disk */
export function lmFilePath(item: LmLoraItem): string | null {
   return readString(item, 'file_path')
}

/**
 * the ONE key space where a host's object_info spelling of a lora meets
 * lora-manager's: lowercase, forward slashes, no model extension.
 * `styles\Aurora.safetensors` and lm's folder `styles` + file_name `aurora`
 * both become `styles/aurora`.
 */
export function loraKey(name: string): string {
   return name
      .replaceAll('\\', '/')
      .replace(/\.(safetensors|st|pt|ckpt)$/i, '')
      .toLowerCase()
}

/** the file's own name, windows separators included (`styles\x.safetensors` → `x.safetensors`) */
export function loraBasename(name: string): string {
   return basename(name.replaceAll('\\', '/'))
}

/** the mirror key for an lm item: its folder/file_name pair, normalized */
export function lmItemKey(item: LmLoraItem): string | null {
   const file = lmFileName(item)
   if (file == null) return null
   const folder = lmFolder(item)
   return loraKey(folder === '' ? file : `${folder}/${file}`)
}

/** runaway stop: 20 pages × the server's 100-per-page cap = 2000 loras */
const MAX_PAGES = 20

/**
 * the outcome of a sweep, DISCRIMINATED. A bare `null` for "no loras" conflated
 * three very different situations, and callers then told the user the wrong one:
 * a host that is merely DOWN was reported as "extension not detected", and a
 * sweep cut short mid-collection was indistinguishable from a complete one, so
 * a partial mirror could overwrite a good one and report success.
 */
export type LoraSweep =
   | { status: 'ok'; items: LmLoraItem[] }
   /** the extension answered, then stopped answering: `items` is INCOMPLETE, never write it over a good mirror */
   | { status: 'partial'; items: LmLoraItem[]; reason: string }
   /** no ComfyUI-Lora-Manager on this host (404 on the first page) */
   | { status: 'absent' }
   /** the host itself could not be reached (down, refused, auth) */
   | { status: 'unreachable'; reason: string }

/** civitai's model description for ONE lora, as PLAIN TEXT. The extension answers html, and
 * html from a third party is never rendered: tags are stripped here, at the seam.
 * null = the extension has no description for it (or does not expose the route) */
export async function fetchLoraDescription(host: ComfyHost, filePath: string): Promise<string | null> {
   try {
      const res = await host.fetch(`/lm/loras/model-description?file_path=${encodeURIComponent(filePath)}`, {})
      // a 404 IS "no description", any other status is the extension failing at its job: the
      // two collapsed to the same silent null, which is the wrong-cause report the sibling
      // fetchLoraExampleImages carries a `reason` to avoid
      if (!res.ok) {
         if (res.status !== 404) logError(`[lora-manager] description ${res.status} for ${filePath}`)
         return null
      }
      const raw: unknown = await res.json()
      const description = isRecord(raw) ? raw['description'] : null
      if (typeof description !== 'string' || description === '') return null
      return htmlToText(description)
   } catch (e) {
      logError(`[lora-manager] description unreachable for ${filePath}: ${extractErrorMessage(e)}`)
      return null
   }
}

/** `<p>a</p><br>b` → `a\n\nb`. Deliberately dumb: this text is DISPLAYED, never parsed */
function htmlToText(html: string): string {
   return html
      .replaceAll(/<\s*br\s*\/?>/gi, '\n')
      .replaceAll(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n\n')
      .replaceAll(/<\s*li[^>]*>/gi, '· ')
      .replaceAll(/<[^>]+>/g, '')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll(/\n{3,}/g, '\n\n')
      .trim()
}

/** the example images lora-manager keeps for a lora. `reason` explains an empty list rather
 * than pretending the lora has none — "no example images path configured" is a SETTING */
export async function fetchLoraExampleImages(
   host: ComfyHost,
   sha256: string,
): Promise<{ files: string[]; reason: string | null }> {
   try {
      const res = await host.fetch(`/lm/example-image-files?model_hash=${encodeURIComponent(sha256)}`, {})
      const raw: unknown = await res.json()
      if (!isRecord(raw)) return { files: [], reason: `unexpected reply (http ${res.status})` }
      if (raw['success'] !== true) {
         const err = raw['error']
         return { files: [], reason: typeof err === 'string' ? err : `http ${res.status}` }
      }
      const files = raw['files']
      if (!Array.isArray(files)) return { files: [], reason: null }
      const out: string[] = []
      for (const f of files) {
         if (typeof f === 'string') out.push(f)
         else if (isRecord(f) && typeof f['path'] === 'string') out.push(f['path'])
      }
      return { files: out, reason: null }
   } catch (e) {
      return { files: [], reason: e instanceof Error ? e.message : String(e) }
   }
}

/**
 * every lora lora-manager knows, RAW, in one paged sweep.
 * page_size asks for 500; the server caps it at 100, so the loop follows `total`.
 */
export async function fetchLoraList(host: ComfyHost): Promise<LoraSweep> {
   const items: LmLoraItem[] = []
   for (let page = 1; page <= MAX_PAGES; page++) {
      let res: Response
      try {
         // the extension registers under /api — already prefixed, skip the probe
         res = await host.fetch(`/api/lm/loras/list?page=${page}&page_size=500`, {}, { apiPrefix: false })
      } catch (e) {
         const reason = `host unreachable at page ${page}: ${extractErrorMessage(e)}`
         return page === 1 ? { status: 'unreachable', reason } : partial(items, reason)
      }
      if (!res.ok) {
         // ONLY a route-not-there status means "no extension here". A 500 while lm
         // rescans its model db, or a 403, used to be announced to the user as
         // "the extension is not installed" — the same wrong-cause report the
         // discriminated status exists to prevent
         const missing = res.status === 404 || res.status === 405
         if (page === 1)
            return missing ? { status: 'absent' } : { status: 'unreachable', reason: `answered ${res.status}` }
         return partial(items, `page ${page} answered ${res.status}`)
      }
      let parsed: ReturnType<typeof lmLoraPage>
      try {
         // json() throws on an html SPA fallback or an empty body, and a THROW is
         // a fifth outcome this function promises not to have
         parsed = lmLoraPage(await res.json())
      } catch (e) {
         const reason = `page ${page} did not answer json: ${extractErrorMessage(e)}`
         return page === 1 ? { status: 'absent' } : partial(items, reason)
      }
      if (parsed instanceof type.errors) {
         // wire tolerance (agent/coding.md): lm drifts faster than our schema
         return partial(items, `page ${page} shape mismatch: ${parsed.summary}`)
      }
      const pageItems = parsed.items.filter(isRecord)
      items.push(...pageItems)
      const total = parsed.total
      if (total != null && items.length >= total) return { status: 'ok', items }
      if (pageItems.length === 0) {
         // an empty page is the END only when nothing said there was more. With a
         // `total` still ahead of us the collection is TRUNCATED, and calling that
         // `ok` let the cli overwrite a good mirror and print 🟢 while dropping loras
         return total == null || page === 1
            ? { status: 'ok', items }
            : partial(items, `page ${page} came back empty with ${items.length}/${total} fetched`)
      }
   }
   return partial(items, `stopped at the ${MAX_PAGES}-page runaway limit`)
}

/** a truncated sweep is LOUD at the source, whatever the caller then decides to do */
function partial(items: LmLoraItem[], reason: string): LoraSweep {
   logError(`[loraManagerApi] lora sweep INCOMPLETE after ${items.length} loras — ${reason}`)
   return { status: 'partial', items, reason }
}

/** `loraKey` → server-relative preview_url */
export function loraPreviewMapFrom(items: LmLoraItem[]): Map<string, string> {
   const map = new Map<string, string>()
   for (const item of items) {
      const key = lmItemKey(item)
      const url = lmPreviewUrl(item)
      if (key != null && url != null) map.set(key, url)
   }
   return map
}

/** the bytes look like an image (magic numbers) — guards against ComfyUI's SPA index.html fallback */
export function looksLikeImage(bytes: Uint8Array): boolean {
   if (bytes.length < 3) return false // shortest signature (JPEG/GIF) is 3 bytes
   const b = bytes
   const is = (sig: number[], off = 0): boolean => sig.every((v, i) => b[off + i] === v)
   return (
      is([0x89, 0x50, 0x4e, 0x47]) || // PNG
      is([0xff, 0xd8, 0xff]) || // JPEG
      is([0x47, 0x49, 0x46]) || // GIF
      (is([0x52, 0x49, 0x46, 0x46]) && is([0x57, 0x45, 0x42, 0x50], 8)) // RIFF…WEBP
   )
}

/**
 * fetch a preview image's bytes from its server-relative preview_url.
 * cached on success at `.comfy-ts/cache/lora-previews/<sha1(url)>`. Returns null
 * when the file is missing: lora-manager SPA-fallbacks to index.html (HTML), so
 * a non-image content-type OR non-image magic bytes => no preview, not a crash.
 */
export async function fetchLoraPreviewBytes(host: ComfyHost, previewUrl: string): Promise<Uint8Array | null> {
   const storage = getComfyStorage()
   const cachePath = comfyts.resolveFromCache(`lora-previews/${sha1HexOfString(previewUrl)}`)
   if (storage.exists(cachePath)) return storage.readBytes(cachePath)
   try {
      // preview_url is already a full server-relative path — no /api probing
      const res = await host.fetch(previewUrl, {}, { apiPrefix: false })
      if (!res.ok) return null
      const ct = res.headers.get('content-type') ?? ''
      if (ct !== '' && !ct.startsWith('image/')) return null // HTML fallback etc.
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (!looksLikeImage(bytes)) return null
      storage.writeBytes(cachePath, bytes)
      return bytes
   } catch {
      return null
   }
}
