// a world's thumbnail: what the view shows at its default camera, 640 px wide, sent to the server that keeps it as
// .comfy-ts/worlds/<name>/thumb.webp. A 3D view gives it by `View3d.snapshot`, the picture view by its <img>
export const THUMB_W = 640

export async function sendThumb(name: string, src: CanvasImageSource, w: number, h: number): Promise<void> {
   if (w <= 0 || h <= 0) return
   const c = document.createElement('canvas')
   c.width = THUMB_W
   c.height = Math.round((THUMB_W * h) / w)
   const g = c.getContext('2d')
   if (g == null) throw new Error('thumbnail: no 2d context')
   g.drawImage(src, 0, 0, c.width, c.height)
   const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/webp', 0.85))
   if (blob == null) throw new Error('thumbnail: the browser made no webp')
   await postThumb(name, blob)
}

export async function postThumb(name: string, blob: Blob): Promise<void> {
   const r = await fetch(`api/thumb/${encodeURIComponent(name)}`, { method: 'POST', body: blob })
   if (!r.ok) throw new Error(`thumbnail of ${name}: ${r.status} ${await r.text()}`)
}
