import sharp from 'sharp'

/** which real-image dialect this terminal speaks. Env-only detection: querying
 * the terminal would race ink's own stdin handshakes (kitty keyboard, CSI u). */
export type ImageProtocol = 'iterm' | 'kitty'

export function imageProtocol(): ImageProtocol | null {
   // the one native-images kill switch, whatever the dialect
   if (process.env.COMFY_TS_NO_ITERM_IMAGES === '1') return null
   const term = process.env.TERM ?? ''
   const program = process.env.TERM_PROGRAM ?? ''
   // ghostty speaks the kitty graphics protocol
   const kitty =
      term.includes('kitty') ||
      term.includes('ghostty') ||
      process.env.KITTY_WINDOW_ID != null ||
      process.env.GHOSTTY_RESOURCES_DIR != null
   if (kitty) return 'kitty'
   const iterm =
      program === 'iTerm.app' || program === 'WezTerm' || program === 'vscode' || process.env.LC_TERMINAL === 'iTerm2'
   return iterm ? 'iterm' : null
}

export function protocolCapable(): boolean {
   return imageProtocol() != null
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

export function isPng(bytes: Uint8Array): boolean {
   return PNG_MAGIC.every((byte, ix) => bytes[ix] === byte)
}

/** kitty only draws png (f=100), never jpeg/webp; iterm takes any format.
 * Pass every native-renderer byte source that is not sharp-produced png through here. */
export async function protocolReadyBytes(bytes: Uint8Array): Promise<Uint8Array> {
   if (imageProtocol() !== 'kitty' || isPng(bytes)) return bytes
   return new Uint8Array(await sharp(bytes).png().toBuffer())
}
