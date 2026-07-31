// observed on a live Comfy Cloud run: the cloud streams
// sampling previews as binary type 4 (PREVIEW_IMAGE_WITH_METADATA) and our
// onMessage threw `Unknown binary websocket message of type 4` on every step.
// Frame formats per agent/external-docs/comfy-cloud/api-reference.md.
import { describe, expect, test } from 'bun:test'
import { parseBinaryWsFrame } from 'src/runner/wsBinaryFrame.ts'

const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0]
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

function frame(eventType: number, payload: number[]): ArrayBuffer {
   const buf = new ArrayBuffer(4 + payload.length)
   new DataView(buf).setUint32(0, eventType)
   new Uint8Array(buf, 4).set(payload)
   return buf
}

function u32(n: number): number[] {
   const b = new ArrayBuffer(4)
   new DataView(b).setUint32(0, n)
   return [...new Uint8Array(b)]
}

describe('parseBinaryWsFrame', () => {
   test('type 1: preview image, image_type 1 = jpeg', () => {
      const parsed = parseBinaryWsFrame(frame(1, [...u32(1), ...JPEG_MAGIC]))
      expect(parsed.kind).toBe('preview')
      if (parsed.kind !== 'preview') throw new Error('unreachable')
      expect(parsed.mime).toBe('image/jpeg')
      expect([...parsed.bytes]).toEqual(JPEG_MAGIC)
   })

   test('type 1: image_type 2 = png', () => {
      const parsed = parseBinaryWsFrame(frame(1, [...u32(2), ...PNG_MAGIC]))
      expect(parsed.kind).toBe('preview')
      if (parsed.kind !== 'preview') throw new Error('unreachable')
      expect(parsed.mime).toBe('image/png')
   })

   test('type 4: preview with metadata json, mime sniffed from magic bytes', () => {
      const metadata = new TextEncoder().encode(JSON.stringify({ node_id: '3', prompt_id: 'abc-123' }))
      const parsed = parseBinaryWsFrame(frame(4, [...u32(metadata.length), ...metadata, ...PNG_MAGIC]))
      expect(parsed.kind).toBe('preview')
      if (parsed.kind !== 'preview') throw new Error('unreachable')
      expect(parsed.mime).toBe('image/png')
      expect([...parsed.bytes]).toEqual(PNG_MAGIC)
   })

   test('type 4: jpeg bytes sniff as jpeg', () => {
      const metadata = new TextEncoder().encode('{}')
      const parsed = parseBinaryWsFrame(frame(4, [...u32(metadata.length), ...metadata, ...JPEG_MAGIC]))
      expect(parsed.kind).toBe('preview')
      if (parsed.kind !== 'preview') throw new Error('unreachable')
      expect(parsed.mime).toBe('image/jpeg')
   })

   test('type 3: node progress text', () => {
      const nodeId = new TextEncoder().encode('12')
      const text = new TextEncoder().encode('50%|█████')
      const parsed = parseBinaryWsFrame(frame(3, [...u32(nodeId.length), ...nodeId, ...text]))
      expect(parsed.kind).toBe('text')
      if (parsed.kind !== 'text') throw new Error('unreachable')
      expect(parsed.nodeId).toBe('12')
      expect(parsed.text).toBe('50%|█████')
   })

   test('unknown type: returned as unknown, NEVER a throw (wire tolerance)', () => {
      const parsed = parseBinaryWsFrame(frame(9, [1, 2, 3]))
      expect(parsed.kind).toBe('unknown')
      if (parsed.kind !== 'unknown') throw new Error('unreachable')
      expect(parsed.eventType).toBe(9)
   })
})
