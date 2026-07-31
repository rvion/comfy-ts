import { type } from 'arktype'
import { getComfyStorage } from 'src/storage/ComfyStorage.ts'
import { sha1HexOfString } from 'src/utils/sha1.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { logError } from 'src/utils/log.ts'

/**
 * client for the OPTIONAL ComfyUI-Lora-Manager extension.
 * absent extension = normal condition: callers get null/empty and degrade.
 */

const lmLoraItem = type({
   folder: 'string',
   file_name: 'string',
   preview_url: 'string',
})
const lmLoraPage = type({
   items: lmLoraItem.array(),
   total: 'number',
})

/** normalize an object_info lora name OR an lm folder/file pair to one key */
export function loraPreviewKey(name: string): string {
   return name
      .replaceAll('\\', '/')
      .replace(/\.(safetensors|st|pt|ckpt)$/i, '')
      .toLowerCase()
}

/**
 * fetch every lora known to lora-manager, mapped `loraPreviewKey` → preview_url
 * (server-relative). Returns null when the extension is absent (404/network).
 */
export async function fetchLoraPreviewMap(host: ComfyHost): Promise<Map<string, string> | null> {
   const map = new Map<string, string>()
   const pageSize = 500
   for (let page = 1; page <= 20; page++) {
      let res: Response
      try {
         // the extension registers under /api — already prefixed, skip the probe
         res = await host.fetch(`/api/lm/loras/list?page=${page}&page_size=${pageSize}`, {}, { apiPrefix: false })
      } catch {
         return null // host unreachable (or auth-refused): previews off, not an error
      }
      if (!res.ok) return page === 1 ? null : map // 404 on page 1 = extension absent
      const json: unknown = await res.json()
      const parsed = lmLoraPage(json)
      if (parsed instanceof type.errors) {
         // wire tolerance (agent/coding.md): lm drifts faster than our schema — LOG then bail
         logError(`[loraManagerApi] /api/lm/loras/list page ${page} shape mismatch: ${parsed.summary}`)
         return map
      }
      for (const item of parsed.items) {
         const rel = item.folder === '' ? item.file_name : `${item.folder}/${item.file_name}`
         map.set(loraPreviewKey(rel), item.preview_url)
      }
      if (map.size >= parsed.total || parsed.items.length === 0) break
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
