// pure parser for BINARY ws frames (formats per
// agent/external-docs/comfy-cloud/api-reference.md, all integers big-endian):
//   1 PREVIEW_IMAGE                4B type · 4B image_type (1 jpeg, 2 png) · image bytes
//   3 TEXT                         4B type · 4B node_id_len · node_id · progress text
//   4 PREVIEW_IMAGE_WITH_METADATA  4B type · 4B metadata_len · metadata JSON · image bytes
// Unknown types come back as 'unknown' — the CALLER logs, never throws: the
// wire drifts faster than we do (type 4 appeared on the first live cloud run).

export const BINARY_FRAME_PREVIEW_IMAGE = 1
export const BINARY_FRAME_TEXT = 3
export const BINARY_FRAME_PREVIEW_IMAGE_WITH_METADATA = 4

export type ParsedPreviewFrame = { kind: 'preview'; bytes: Uint8Array<ArrayBuffer>; mime: string; metadata: unknown }

export type ParsedBinaryWsFrame =
   | ParsedPreviewFrame
   | { kind: 'text'; nodeId: string; text: string }
   | { kind: 'unknown'; eventType: number }

/** the frame's event type, read in place: deciding whether anyone wants a frame costs no copy */
export function binaryFrameType(data: ArrayBuffer): number {
   if (data.byteLength < 4) return -1
   return new DataView(data).getUint32(0)
}

export function isPreviewFrameType(eventType: number): boolean {
   return eventType === BINARY_FRAME_PREVIEW_IMAGE || eventType === BINARY_FRAME_PREVIEW_IMAGE_WITH_METADATA
}

export function parseBinaryWsFrame(data: ArrayBuffer): ParsedBinaryWsFrame {
   const eventType = binaryFrameType(data)
   if (isPreviewFrameType(eventType)) return parsePreviewFrame(data)

   if (eventType === BINARY_FRAME_TEXT) {
      const nodeIdLen = new DataView(data).getUint32(4)
      const decoder = new TextDecoder()
      const nodeId = decoder.decode(data.slice(8, 8 + nodeIdLen))
      const text = decoder.decode(data.slice(8 + nodeIdLen))
      return { kind: 'text', nodeId, text }
   }

   return { kind: 'unknown', eventType }
}

/** a type 1 or type 4 frame; the caller checked the type with `isPreviewFrameType` */
export function parsePreviewFrame(data: ArrayBuffer): ParsedPreviewFrame {
   const view = new DataView(data)
   if (view.getUint32(0) === BINARY_FRAME_PREVIEW_IMAGE) {
      const imageType = view.getUint32(4)
      const bytes = new Uint8Array(data.slice(8))
      const mime = imageType === 2 ? 'image/png' : 'image/jpeg'
      return { kind: 'preview', bytes, mime, metadata: null }
   }
   const metadataLen = view.getUint32(4)
   let metadata: unknown = null
   try {
      metadata = JSON.parse(new TextDecoder().decode(data.slice(8, 8 + metadataLen)))
   } catch {
      // tolerate broken metadata: the image bytes are the payload that matters
   }
   const bytes = new Uint8Array(data.slice(8 + metadataLen))
   // the docs say "raw JPEG/PNG bytes" with no format field — sniff the magic
   const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg'
   return { kind: 'preview', bytes, mime, metadata }
}

/** the node a type 4 frame names (`node_id` in its metadata), null when absent or malformed */
export function previewMetadataNodeId(metadata: unknown): string | null {
   if (metadata == null || typeof metadata !== 'object' || !('node_id' in metadata)) return null
   return typeof metadata.node_id === 'string' && metadata.node_id !== '' ? metadata.node_id : null
}
