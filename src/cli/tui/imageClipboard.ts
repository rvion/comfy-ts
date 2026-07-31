/** platform command that puts an image file's PIXELS on the clipboard
 * (pbcopy/clip/xclip only do text — images need per-OS tools) */
export type ImageClipboardCommand = { cmd: string; args: string[] }

const extOf = (path: string): string => {
   const dot = path.lastIndexOf('.')
   return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}

/** platform command that puts PNG bytes on the clipboard from STDIN — no
 * file ever touches disk. The caller pipes `stdin`
 * into the spawned process and closes it. */
export type ImageClipboardStdinCommand = { cmd: string; args: string[]; stdin: Uint8Array }

export const imageClipboardStdinCommand = (
   platform: NodeJS.Platform,
   pngBytes: Uint8Array,
): ImageClipboardStdinCommand => {
   if (platform === 'darwin') {
      // osascript reads the SCRIPT itself from stdin (`-`): a «data PNGf<hex>»
      // literal carries the pixels inside the script — hex doubles the size,
      // so multi-MB images take a beat; the caller falls back to the file
      // command when this exits non-zero
      const hex = Buffer.from(pngBytes).toString('hex').toUpperCase()
      return {
         cmd: 'osascript',
         args: ['-'],
         stdin: new TextEncoder().encode(`set the clipboard to «data PNGf${hex}»`),
      }
   }
   if (platform === 'win32') {
      // base64 rides stdin; PS rebuilds the image from a MemoryStream — no
      // user-controlled string ever lands in the script (quoting stays trivial)
      const script =
         '$b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); ' +
         '$ms=New-Object System.IO.MemoryStream(,$b); ' +
         'Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ' +
         '$img=[System.Drawing.Image]::FromStream($ms); ' +
         '[System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()'
      return {
         cmd: 'powershell',
         args: ['-NoProfile', '-Sta', '-Command', script],
         stdin: new TextEncoder().encode(Buffer.from(pngBytes).toString('base64')),
      }
   }
   // xclip reads the image bytes from stdin natively
   return { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png'], stdin: pngBytes }
}

export const imageClipboardCommand = (platform: NodeJS.Platform, path: string): ImageClipboardCommand | null => {
   const ext = extOf(path)
   if (platform === 'darwin') {
      // osascript TAGS bytes with the class, it never transcodes: PNGf on a
      // webp would paste garbage under a green popup — only png/jpeg pass;
      // the caller transcodes anything else to png first
      if (ext !== 'png' && ext !== 'jpg' && ext !== 'jpeg') return null
      const cls = ext === 'png' ? '«class PNGf»' : 'JPEG picture'
      return {
         cmd: 'osascript',
         args: ['-e', `set the clipboard to (read (POSIX file ${JSON.stringify(path)}) as ${cls})`],
      }
   }
   if (platform === 'win32') {
      // single-quoted PS string, inner quotes doubled: a double-quoted string
      // would interpolate $ and ` from user-controlled paths
      const psQuoted = `'${path.replaceAll("'", "''")}'`
      return {
         cmd: 'powershell',
         args: [
            '-NoProfile',
            '-Sta',
            '-Command',
            `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $img=[System.Drawing.Image]::FromFile(${psQuoted}); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()`,
         ],
      }
   }
   const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
   return { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', mime, '-i', path] }
}
