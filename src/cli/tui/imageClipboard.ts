/** platform command that puts an image file's PIXELS on the clipboard
 * (pbcopy/clip/xclip only do text — images need per-OS tools) */
export type ImageClipboardCommand = { cmd: string; args: string[] }

const extOf = (path: string): string => {
   const dot = path.lastIndexOf('.')
   return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}

export const imageClipboardCommand = (platform: NodeJS.Platform, path: string): ImageClipboardCommand | null => {
   const ext = extOf(path)
   if (platform === 'darwin') {
      // JPEG has its own clipboard class; everything else goes in as PNGf
      const cls = ext === 'jpg' || ext === 'jpeg' ? 'JPEG picture' : '«class PNGf»'
      return {
         cmd: 'osascript',
         args: ['-e', `set the clipboard to (read (POSIX file ${JSON.stringify(path)}) as ${cls})`],
      }
   }
   if (platform === 'win32') {
      return {
         cmd: 'powershell',
         args: [
            '-NoProfile',
            '-Sta',
            '-Command',
            `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $img=[System.Drawing.Image]::FromFile(${JSON.stringify(path)}); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()`,
         ],
      }
   }
   const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
   return { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', mime, '-i', path] }
}
