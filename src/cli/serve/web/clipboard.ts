// copy a served image to the clipboard. ClipboardItem accepts image/png and
// nothing else that matters, so non-png outputs re-encode through a canvas
export async function copyImageToClipboard(url: string): Promise<void> {
   const res = await fetch(url)
   if (!res.ok) throw new Error(`fetch failed (http ${res.status})`)
   const blob = await res.blob()
   const png = blob.type === 'image/png' ? blob : await reencodeToPng(blob)
   await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

async function reencodeToPng(blob: Blob): Promise<Blob> {
   const bitmap = await createImageBitmap(blob)
   const canvas = document.createElement('canvas')
   canvas.width = bitmap.width
   canvas.height = bitmap.height
   const ctx = canvas.getContext('2d')
   if (ctx == null) throw new Error('canvas 2d context unavailable')
   ctx.drawImage(bitmap, 0, 0)
   return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((out) => {
         if (out == null) reject(new Error('png encode failed'))
         else resolve(out)
      }, 'image/png')
   })
}
