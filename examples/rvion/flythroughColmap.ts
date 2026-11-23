// a fly-through as a COLMAP text model, for a 3D gaussian splat trainer that reads one (Brush,
// gsplat, nerfstudio): every `every`-th frame of the clips as an image, the camera we chose for it
// as its pose (retimed to the guide frame it matches best, as the video runs a little ahead or
// behind), and the picture's MoGe mesh as the starting points. Reads what flythroughChain.ts wrote into <out>.
//
// run:  bun examples/rvion/flythroughColmap.ts <out> [every]
// writes <out>/colmap/images/*.png and <out>/colmap/sparse/0/{cameras,images,points3D}.txt
import { $ } from 'bun'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'
import sharp from 'sharp'
import { readGlb } from './flythroughGuide.ts'
import { levelPoint, type PathCamera } from './flythroughPath.ts'

/** world to camera, COLMAP axes (x right, y down, z ahead), as a quaternion and a translation */
export function colmapPose(c: PathCamera): { q: [number, number, number, number]; t: [number, number, number] } {
   const f = [c.target[0] - c.position[0], c.target[1] - c.position[1], c.target[2] - c.position[2]]
   const fl = Math.hypot(f[0]!, f[1]!, f[2]!)
   const fw = f.map((x) => x / fl) as [number, number, number]
   const rl = Math.hypot(fw[2], fw[0])
   const r: [number, number, number] = [-fw[2] / rl, 0, fw[0] / rl]
   const u: [number, number, number] = [r[1] * fw[2] - r[2] * fw[1], r[2] * fw[0] - r[0] * fw[2], r[0] * fw[1] - r[1] * fw[0]]
   // rows: camera x, y (down), z in world axes
   const R = [r, [-u[0], -u[1], -u[2]], fw] as const
   const t = R.map((row) => -(row[0] * c.position[0] + row[1] * c.position[1] + row[2] * c.position[2])) as [number, number, number]
   const [m00, m01, m02] = R[0]
   const [m10, m11, m12] = R[1]
   const [m20, m21, m22] = R[2]
   const trace = m00 + m11 + m22
   let q: [number, number, number, number]
   if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1)
      q = [0.25 / s, (m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s]
   } else if (m00 > m11 && m00 > m22) {
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
      q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s]
   } else if (m11 > m22) {
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
      q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s]
   } else {
      const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
      q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s]
   }
   return { q, t }
}

/** small grey frames of a video, for matching */
const SMALL = { width: 104, height: 60 }
const greyFrames = async (file: string): Promise<Uint8Array> =>
   new Uint8Array(await $`ffmpeg -loglevel error -i ${file} -vf scale=${SMALL.width}:${SMALL.height} -pix_fmt gray -f rawvideo -`.arrayBuffer())

/**
 * which guide frame a clip frame shows: the video model runs a little ahead of or behind the path,
 * so the frame takes the camera of the guide frame it matches best (correlation over the pixels the
 * guide covers) within `window` frames; it keeps its own when the match is weak
 */
export function retime(p: { clip: Uint8Array; render: Uint8Array; coverage: Uint8Array; frame: number; window: number }): { frame: number; score: number } {
   const size = SMALL.width * SMALL.height
   const frames = Math.min(p.render.length, p.coverage.length) / size
   const ncc = (b: number) => {
      let sa = 0
      let sb = 0
      let k = 0
      const ao = p.frame * size
      const bo = b * size
      for (let i = 0; i < size; i++)
         if (p.coverage[bo + i]! > 128) {
            sa += p.clip[ao + i]!
            sb += p.render[bo + i]!
            k++
         }
      if (k < size / 10) return -1
      const ma = sa / k
      const mb = sb / k
      let num = 0
      let da = 0
      let db = 0
      for (let i = 0; i < size; i++)
         if (p.coverage[bo + i]! > 128) {
            const x = p.clip[ao + i]! - ma
            const y = p.render[bo + i]! - mb
            num += x * y
            da += x * x
            db += y * y
         }
      return num / Math.sqrt(da * db || 1)
   }
   let best = { frame: p.frame, score: ncc(Math.min(p.frame, frames - 1)) }
   for (let b = Math.max(0, p.frame - p.window); b <= Math.min(frames - 1, p.frame + p.window); b++) {
      const score = ncc(b)
      if (score > best.score) best = { frame: b, score }
   }
   return best.score < 0.3 ? { frame: p.frame, score: best.score } : best
}

if (import.meta.main) {
   const [out, everyArg] = process.argv.slice(2)
   if (out == null) throw new Error('usage: bun examples/rvion/flythroughColmap.ts <out> [every]')
   const every = Number(everyArg ?? 4)
   const rig = JSON.parse(readFileSync(join(out, 'cameras.json'), 'utf8')) as {
      fovY: number
      pitch?: number
      width: number
      height: number
      length: number
      cameras: PathCamera[]
   }
   const root = join(out, 'colmap')
   const sparse = join(root, 'sparse', '0')
   const imagesDir = join(root, 'images')
   mkdirSync(sparse, { recursive: true })
   mkdirSync(imagesDir, { recursive: true })

   const focal = rig.height / 2 / Math.tan((rig.fovY * Math.PI) / 360)
   writeFileSync(join(sparse, 'cameras.txt'), `# CAMERA_ID MODEL WIDTH HEIGHT PARAMS[]\n1 PINHOLE ${rig.width} ${rig.height} ${focal} ${focal} ${rig.width / 2} ${rig.height / 2}\n`)

   const lines = ['# IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME', '# POINTS2D (none)']
   let id = 1
   const timing: { clip: number; frame: number; camera: number; score: number }[] = []
   for (let k = 0; existsSync(join(out, `clip-${k}.mp4`)); k++) {
      const dir = join(out, `clip-${k}.frames`)
      mkdirSync(dir, { recursive: true })
      await $`ffmpeg -loglevel error -y -i ${join(out, `clip-${k}.mp4`)} ${join(dir, '%04d.png')}`
      const [clipGrey, renderGrey, coverageGrey] = await Promise.all(
         ['', '-render', '-coverage'].map((tag) => greyFrames(join(out, `clip-${k}${tag}.mp4`))),
      )
      // frame 0 of a later clip is the last frame of the one before: kept once
      for (let j = k === 0 ? 0 : every; j < rig.length; j += every) {
         const match = retime({ clip: clipGrey!, render: renderGrey!, coverage: coverageGrey!, frame: j, window: 12 })
         timing.push({ clip: k, frame: j, camera: match.frame, score: Number(match.score.toFixed(2)) })
         const cam = rig.cameras[k * (rig.length - 1) + match.frame]
         if (cam == null) continue
         const name = `c${k}-f${String(j).padStart(3, '0')}.png`
         await $`cp ${join(dir, `${String(j + 1).padStart(4, '0')}.png`)} ${join(imagesDir, name)}`
         const { q, t } = colmapPose(cam)
         lines.push(`${id++} ${q.join(' ')} ${t.join(' ')} 1 ${name}`, '')
      }
      await $`rm -rf ${dir}`
   }
   writeFileSync(join(sparse, 'images.txt'), `${lines.join('\n')}\n`)
   writeFileSync(join(root, 'retime.json'), JSON.stringify(timing))

   // starting points: the mesh's vertices, one in 8, coloured from its texture, in the path's levelled world
   const mesh = readGlb(new Uint8Array(readFileSync(join(out, 'mesh.glb'))))
   const tex = await sharp(mesh.textureBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
   const pts = ['# POINT3D_ID X Y Z R G B ERROR TRACK[]']
   for (let i = 0, n = 1; i < mesh.positions.length / 3; i += 8) {
      const [x, y, z] = levelPoint([mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!], rig.pitch ?? 0)
      if (!Number.isFinite(x + y + z)) continue
      const u = Math.round(mesh.uvs[i * 2]! * (tex.info.width - 1))
      const v = Math.round(mesh.uvs[i * 2 + 1]! * (tex.info.height - 1))
      const o = (v * tex.info.width + u) * 3
      pts.push(`${n++} ${x} ${y} ${z} ${tex.data[o]} ${tex.data[o + 1]} ${tex.data[o + 2]} 0`)
   }
   writeFileSync(join(sparse, 'points3D.txt'), `${pts.join('\n')}\n`)
   console.log(`🟢 ${id - 1} images, ${pts.length - 1} points: ${root}`)
}
