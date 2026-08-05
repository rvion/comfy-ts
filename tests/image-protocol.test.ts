import { afterEach, describe, expect, it } from 'bun:test'
import {
   fitCellBox,
   imageDims,
   KITTY_DELETE_ALL,
   kittyDeleteEscape,
   kittyPlaceEscape,
   kittyTransmitEscape,
   itermImageEscape,
   KittyImageSlot,
} from 'src/cli/tui/imageEscapes.ts'
import { imageProtocol, isPng, protocolCapable } from 'src/cli/tui/protocolImage.ts'

const ENV_KEYS = [
   'COMFY_TS_NO_ITERM_IMAGES',
   'TERM',
   'TERM_PROGRAM',
   'LC_TERMINAL',
   'KITTY_WINDOW_ID',
   'GHOSTTY_RESOURCES_DIR',
] as const

const saved = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]))

function setEnv(p: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
   for (const k of ENV_KEYS) delete process.env[k]
   for (const [k, v] of Object.entries(p)) process.env[k] = v
}

afterEach(() => {
   for (const [k, v] of saved) {
      if (v == null) delete process.env[k]
      else process.env[k] = v
   }
})

describe('imageProtocol detection', () => {
   it('detects kitty via TERM (the reported miss: kitty fell back to half-blocks)', () => {
      setEnv({ TERM: 'xterm-kitty' })
      expect(imageProtocol()).toBe('kitty')
      expect(protocolCapable()).toBe(true)
   })

   it('detects kitty via KITTY_WINDOW_ID even under a generic TERM', () => {
      setEnv({ TERM: 'xterm-256color', KITTY_WINDOW_ID: '1' })
      expect(imageProtocol()).toBe('kitty')
   })

   it('detects ghostty (speaks the kitty graphics protocol)', () => {
      setEnv({ TERM: 'xterm-ghostty' })
      expect(imageProtocol()).toBe('kitty')
      setEnv({ TERM: 'xterm-256color', GHOSTTY_RESOURCES_DIR: '/tmp/g' })
      expect(imageProtocol()).toBe('kitty')
   })

   it('detects the iterm dialect terminals', () => {
      setEnv({ TERM_PROGRAM: 'iTerm.app' })
      expect(imageProtocol()).toBe('iterm')
      setEnv({ TERM_PROGRAM: 'WezTerm' })
      expect(imageProtocol()).toBe('iterm')
      setEnv({ TERM_PROGRAM: 'vscode' })
      expect(imageProtocol()).toBe('iterm')
      setEnv({ LC_TERMINAL: 'iTerm2' })
      expect(imageProtocol()).toBe('iterm')
   })

   it('reports incapable terminals as null', () => {
      setEnv({ TERM: 'xterm-256color', TERM_PROGRAM: 'Apple_Terminal' })
      expect(imageProtocol()).toBe(null)
      expect(protocolCapable()).toBe(false)
   })

   it('the kill switch disables both dialects', () => {
      setEnv({ TERM: 'xterm-kitty', COMFY_TS_NO_ITERM_IMAGES: '1' })
      expect(imageProtocol()).toBe(null)
      setEnv({ TERM_PROGRAM: 'iTerm.app', COMFY_TS_NO_ITERM_IMAGES: '1' })
      expect(imageProtocol()).toBe(null)
   })
})

// smallest valid png: 8-byte signature is all isPng checks; imageDims parses a real header
const PNG_1X2 = Buffer.from(
   'iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACzzX7wAAAADUlEQVR4nGNgYGD4DwABBAEAX+XLaAAAAABJRU5ErkJggg==',
   'base64',
)

describe('png sniffing', () => {
   it('recognizes png bytes and rejects jpeg', () => {
      expect(isPng(new Uint8Array(PNG_1X2))).toBe(true)
      expect(isPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe(false)
      expect(isPng(new Uint8Array([]))).toBe(false)
   })
})

describe('kitty escapes', () => {
   it('single-chunk transmit carries the full control set and terminates with ST', () => {
      const bytes = new Uint8Array([1, 2, 3])
      const esc = kittyTransmitEscape(bytes, 1)
      expect(esc).toBe(`\u001b_Ga=t,f=100,t=d,i=1,q=2,m=0;${Buffer.from(bytes).toString('base64')}\u001b\\`)
   })

   it('chunked transmit: 4096-char payload cap, control keys only on the first chunk, m=0 last, payload round-trips', () => {
      const bytes = new Uint8Array(9000).map((_, i) => i % 251)
      const esc = kittyTransmitEscape(bytes, 2)
      const chunks = esc.split('\u001b\\').filter((s) => s !== '')
      expect(chunks.length).toBe(3)
      const payloads: string[] = []
      for (const [ix, chunk] of chunks.entries()) {
         expect(chunk.startsWith('\u001b_G')).toBe(true)
         const sep = chunk.indexOf(';')
         expect(sep).toBeGreaterThan(0)
         const ctrl = chunk.slice(3, sep)
         const payload = chunk.slice(sep + 1)
         expect(payload.length).toBeLessThanOrEqual(4096)
         if (ix === 0) expect(ctrl).toBe('a=t,f=100,t=d,i=2,q=2,m=1')
         else if (ix === chunks.length - 1) expect(ctrl).toBe('m=0')
         else expect(ctrl).toBe('m=1')
         payloads.push(payload)
      }
      expect(new Uint8Array(Buffer.from(payloads.join(''), 'base64'))).toEqual(bytes)
   })

   it('placement addresses the cursor, replaces by i,p, stays quiet and keeps the cursor', () => {
      const esc = kittyPlaceEscape(1, 6, 40, 30, 15)
      expect(esc).toBe('\u001b7\u001b[6;40H\u001b_Ga=p,i=1,p=1,c=30,r=15,C=1,q=2\u001b\\\u001b8')
   })

   it('deletes free the image data too (uppercase I / A)', () => {
      expect(kittyDeleteEscape(2)).toBe('\u001b_Ga=d,d=I,i=2,q=2\u001b\\')
      expect(KITTY_DELETE_ALL).toBe('\u001b_Ga=d,d=A,q=2\u001b\\')
   })
})

describe('fitCellBox (kitty stretches: the box must carry the aspect)', () => {
   it('square image in a wide panel: height caps, width shrinks to 2:1 cells', () => {
      expect(fitCellBox({ imgW: 512, imgH: 512, w: 60, h: 20 })).toEqual({ w: 40, h: 20 })
   })

   it('wide image: full width, short box', () => {
      expect(fitCellBox({ imgW: 1024, imgH: 512, w: 40, h: 20 })).toEqual({ w: 40, h: 10 })
   })

   it('unknown dims: the panel box unchanged', () => {
      expect(fitCellBox({ imgW: 0, imgH: 0, w: 40, h: 20 })).toEqual({ w: 40, h: 20 })
   })

   it('imageDims reads a real png header and caches per bytes object', () => {
      const bytes = new Uint8Array(PNG_1X2)
      expect(imageDims(bytes)).toEqual({ w: 1, h: 2 })
      expect(imageDims(bytes)).toBe(imageDims(bytes))
      expect(imageDims(new Uint8Array([1, 2, 3]))).toEqual({ w: 0, h: 0 })
   })
})

describe('iterm escape (the pre-kitty behavior, pinned byte-for-byte)', () => {
   it('emits the exact OSC 1337 paint the painter always emitted', () => {
      const bytes = new Uint8Array([1, 2, 3])
      const esc = itermImageEscape(bytes, 6, 40, 30, 15)
      expect(esc).toBe(
         `\u001b7\u001b[6;40H\u001b]1337;File=inline=1;size=3;width=30;height=15;preserveAspectRatio=1:${Buffer.from(bytes).toString('base64')}\u0007\u001b8`,
      )
   })
})

describe('KittyImageSlot (the painter state machine)', () => {
   it('transmits once per bytes object, then only re-places', () => {
      const slot = new KittyImageSlot(1)
      const bytes = new Uint8Array([1, 2, 3])
      const first = slot.show(bytes, 6, 40, 30, 15)
      expect(first).toContain('a=t,f=100')
      expect(first).toContain('a=p,i=1')
      const second = slot.show(bytes, 6, 40, 30, 15)
      expect(second).not.toContain('a=t')
      expect(second).toBe(kittyPlaceEscape(1, 6, 40, 30, 15))
   })

   it('new bytes delete the old data before retransmitting', () => {
      const slot = new KittyImageSlot(2)
      slot.show(new Uint8Array([1]), 6, 40, 30, 15)
      const next = slot.show(new Uint8Array([2]), 6, 40, 30, 15)
      expect(next.startsWith(kittyDeleteEscape(2))).toBe(true)
      expect(next).toContain('a=t,f=100')
   })

   it('drop deletes exactly once, and only after a transmit', () => {
      const slot = new KittyImageSlot(1)
      expect(slot.drop()).toBe('')
      slot.show(new Uint8Array([1]), 6, 40, 30, 15)
      expect(slot.drop()).toBe(kittyDeleteEscape(1))
      expect(slot.drop()).toBe('')
   })

   it('a z pin rides the placement (the corner sits above the main image)', () => {
      const slot = new KittyImageSlot(2)
      const esc = slot.show(new Uint8Array([1]), 6, 40, 10, 5, 1)
      expect(esc).toContain('C=1,q=2,z=1')
   })
})
