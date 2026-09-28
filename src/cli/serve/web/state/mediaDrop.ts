// what lands on a media var: a desktop file or a gallery output. PURE (the fetch and the upload
// are injected), tests/serve-web-media-drop.test.ts. The var must end on a LOCAL PATH, because
// that is the only value /generate accepts without a download
import { DEFAULT_MEDIA_EXTENSIONS, extensionOf, MEDIA_KINDS, type MediaKind } from 'src/runner/mediaKinds.ts'

/** the dataTransfer type a gallery output drags under */
export const OUTPUT_DRAG_MIME = 'application/x-comfy-output'

export type DraggedOutput = { kind: MediaKind; url: string | null; absPath: string | null; filename: string }

export function encodeDraggedOutput(o: DraggedOutput): string {
   return JSON.stringify(o)
}

/** null on anything that is not one of ours: a drop can come from any page */
export function decodeDraggedOutput(raw: string): DraggedOutput | null {
   let parsed: unknown
   try {
      parsed = JSON.parse(raw)
   } catch {
      return null
   }
   if (parsed == null || typeof parsed !== 'object') return null
   // family 10: every field is checked right below before the object is claimed
   const o = parsed as Record<string, unknown>
   const kind = o.kind
   if (typeof kind !== 'string' || !isMediaKind(kind)) return null
   if (typeof o.filename !== 'string') return null
   const url = typeof o.url === 'string' ? o.url : null
   const absPath = typeof o.absPath === 'string' ? o.absPath : null
   if (url == null && absPath == null) return null
   return { kind, url, absPath, filename: o.filename }
}

export function isMediaKind(kind: string): kind is MediaKind {
   return (MEDIA_KINDS as readonly string[]).includes(kind)
}

/** a desktop file's medium: its mime first, its extension when the browser gave no mime */
export function mediaKindOfFile(file: { name: string; type: string }): MediaKind | null {
   const top = file.type.split('/')[0] ?? ''
   if (isMediaKind(top)) return top
   const ext = extensionOf(file.name)
   return MEDIA_KINDS.find((k) => DEFAULT_MEDIA_EXTENSIONS[k].includes(ext)) ?? null
}

/** null when the var takes it, else the reason it does not, said to the user */
export function refuseDrop(varKind: MediaKind, dropped: MediaKind | null, what: string): string | null {
   if (dropped === varKind) return null
   return `this is ${article(varKind)} input: ${what} is ${dropped == null ? 'not a known media file' : article(dropped)}`
}

function article(kind: MediaKind): string {
   return kind === 'video' ? `a ${kind}` : `an ${kind}`
}

export type MediaValue = { path: string; url: string | null }

/** a saved output is already a local path. An unsaved one lives in the server memory only, so
 * its bytes are fetched and uploaded, and the var points at the uploaded copy */
export async function valueForOutput(
   o: DraggedOutput,
   deps: {
      fetchBlob: (url: string) => Promise<Blob>
      upload: (file: File) => Promise<{ path: string; url: string | null }>
   },
): Promise<MediaValue> {
   if (o.absPath != null) return { path: o.absPath, url: o.url }
   if (o.url == null) throw new Error(`${o.filename} is no longer in memory: nothing to use`)
   const blob = await deps.fetchBlob(o.url)
   const reply = await deps.upload(new File([blob], o.filename, { type: blob.type }))
   return { path: reply.path, url: reply.url }
}
