import sharp from 'sharp'

/**
 * render an image as truecolor half-block ANSI: each char cell is 1px wide and
 * 2px tall (bg color = top pixel, fg '▄' = bottom pixel). Works in any
 * truecolor terminal and — unlike protocol images (iTerm/kitty/sixel) —
 * survives ink's layout engine. width/height are CHAR CELLS.
 */
export async function imageBufferToAnsi(
   input: Uint8Array | Buffer | string,
   p: { width: number; height: number; background?: string },
): Promise<string> {
   const { data, info } = await sharp(input)
      .flatten({ background: p.background ?? '#1e1e1e' })
      .resize(p.width, p.height * 2, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true })
   const w = info.width
   const h = info.height
   const c = info.channels
   const px = (x: number, y: number): [number, number, number] => {
      const i = (y * w + x) * c
      return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
   }
   const rows: string[] = []
   for (let y = 0; y < h; y += 2) {
      let row = ''
      for (let x = 0; x < w; x++) {
         const [tr, tg, tb] = px(x, y)
         const [br, bg, bb] = y + 1 < h ? px(x, y + 1) : px(x, y)
         row += `\x1b[48;2;${tr};${tg};${tb}m\x1b[38;2;${br};${bg};${bb}m▄`
      }
      rows.push(row + '\x1b[0m')
   }
   return rows.join('\n')
}
