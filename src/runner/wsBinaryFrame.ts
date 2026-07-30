// pure parser for BINARY ws frames (formats per
// agent/external-docs/comfy-cloud/api-reference.md, all integers big-endian):
//   1 PREVIEW_IMAGE                4B type · 4B image_type (1 jpeg, 2 png) · image bytes
//   3 TEXT                         4B type · 4B node_id_len · node_id · progress text
//   4 PREVIEW_IMAGE_WITH_METADATA  4B type · 4B metadata_len · metadata JSON · image bytes
// Unknown types come back as 'unknown' — the CALLER logs, never throws: the
// wire drifts faster than we do (type 4 appeared on the first live cloud run).

export type ParsedBinaryWsFrame =
   | { kind: 'preview'; bytes: Uint8Array<ArrayBuffer>; mime: string; metadata: unknown }
   | { kind: 'text'; nodeId: string; text: string }
   | { kind: 'unknown'; eventType: number }

export function parseBinaryWsFrame(data: ArrayBuffer): ParsedBinaryWsFrame {
   const view = new DataView(data)
   const eventType = view.getUint32(0)

   if (eventType === 1) {
      const imageType = view.getUint32(4)
      const bytes = new Uint8Array(data.slice(8))
      const mime = imageType === 2 ? 'image/png' : 'image/jpeg'
      return { kind: 'preview', bytes, mime, metadata: null }
   }

   if (eventType === 3) {
      const nodeIdLen = view.getUint32(4)
      const decoder = new TextDecoder()
      const nodeId = decoder.decode(data.slice(8, 8 + nodeIdLen))
      const text = decoder.decode(data.slice(8 + nodeIdLen))
      return { kind: 'text', nodeId, text }
   }

   if (eventType === 4) {
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

   return { kind: 'unknown', eventType }
}
