// depth map display: grey or turbo, optional min/max stretch. Each model outputs its own range,
// the stretch makes them comparable at a glance.
import type { Colormap } from './state.ts'

/** Google's turbo colormap, polynomial fit (Mikhailov 2019) */
function turbo(x: number): [number, number, number] {
   const r =
      0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))))
   const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))))
   const b =
      0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))))
   const c = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255)
   return [c(r), c(g), c(b)]
}
const TURBO: [number, number, number][] = Array.from({ length: 256 }, (_, i) => turbo(i / 255))

export async function loadImage(url: string): Promise<HTMLImageElement> {
   const img = new Image()
   img.src = url
   await img.decode()
   return img
}

/** the depth map as a grey canvas, stretched to 0..255 when `stretch` (2nd and 98th percentiles) */
export function greyDepth(img: HTMLImageElement, stretch: boolean): HTMLCanvasElement {
   const c = document.createElement('canvas')
   c.width = img.naturalWidth
   c.height = img.naturalHeight
   const ctx = c.getContext('2d', { willReadFrequently: true })
   if (ctx == null) throw new Error('no 2d context')
   ctx.drawImage(img, 0, 0)
   const data = ctx.getImageData(0, 0, c.width, c.height)
   const px = data.data
   let lo = 0
   let hi = 255
   if (stretch) {
      const hist = new Uint32Array(256)
      for (let i = 0; i < px.length; i += 4) {
         const v = px[i] ?? 0
         hist[v] = (hist[v] ?? 0) + 1
      }
      const n = px.length / 4
      let acc = 0
      lo = -1
      for (let v = 0; v < 256; v++) {
         acc += hist[v] ?? 0
         if (lo < 0 && acc >= n * 0.02) lo = v
         if (acc >= n * 0.98) {
            hi = v
            break
         }
      }
      if (hi <= lo) hi = lo + 1
   }
   const k = 255 / (hi - lo)
   for (let i = 0; i < px.length; i += 4) {
      const v = Math.min(255, Math.max(0, ((px[i] ?? 0) - lo) * k))
      px[i] = v
      px[i + 1] = v
      px[i + 2] = v
   }
   ctx.putImageData(data, 0, 0)
   return c
}

/** grey depth → the picked colormap, drawn into `out` */
export function paintDepth(grey: HTMLCanvasElement, map: Colormap, out: HTMLCanvasElement): void {
   out.width = grey.width
   out.height = grey.height
   const ctx = out.getContext('2d')
   const src = grey.getContext('2d')
   if (ctx == null || src == null) throw new Error('no 2d context')
   if (map === 'gray') {
      ctx.drawImage(grey, 0, 0)
      return
   }
   const data = src.getImageData(0, 0, grey.width, grey.height)
   const px = data.data
   for (let i = 0; i < px.length; i += 4) {
      const t = TURBO[px[i] ?? 0] ?? [0, 0, 0]
      px[i] = t[0]
      px[i + 1] = t[1]
      px[i + 2] = t[2]
   }
   ctx.putImageData(data, 0, 0)
}
