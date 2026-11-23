// grow a one picture splat into a world, round after round: render it from a new camera, let the image model fill
// what is empty (20-grow-splat.cflow.ts), lift the filled view with SHARP, keep only its new part at the world's
// scale, merge. The world folder holds `splat.ply` (SHARP's splat of the picture, OpenCV axes, metres); the loop
// writes `splat-grown.ply` beside it and the pictures of each round under `grow/`.
//
//    bun examples/rvion/grow-splat/grow.ts <world folder> [--rounds "30 -30 60 -60"] [--extend "<what lies beyond>"]
//                                         [--seed 1] [--fresh] [--reuse] [--views]
// a round is `<yaw>[@<x>,<z>]`: turn left by yaw degrees (negative turns right), standing at x metres right and
// z metres forward of the picture's camera. Without --fresh the rounds go on from the last grown splat; --reuse
// takes a round's filled view and lifted splat from an earlier run when they exist (tuning the merge alone).
// --views only draws the grown splat (and the picture's) from a fixed set of cameras, into grow/views.png
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'pathe'
import sharp from 'sharp'
import { FILL_PROMPT, growSplatFill } from '../20-grow-splat.cflow.ts'
import { place, trimToFrame } from './align.ts'
import { concatSplats, readSplat, writeSplat, type Splat, type SplatCamera } from './ply.ts'
import { render, turn, type Pose, type Render } from './raster.ts'
import { sharpPredict } from './sharp.ts'

/** a pixel covered less than this is painted by the model */
const COVERED = 0.9
/** a lifted gaussian is kept where the world covered less than this */
const KEEP_BELOW = 0.6

type Round = { yaw: number; x: number; z: number }
type RoundLog = Round & { round: number; seed: number; seconds: number; scale: number; spread: [number, number]; fitPixels: number; hole: number; kept: number; total: number; gaussians: number }

function parseRound(token: string): Round {
   const m = /^(-?\d+(?:\.\d+)?)(?:@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?))?$/.exec(token)
   if (m == null) throw new Error(`a round is <yaw>[@<x>,<z>], got '${token}'`)
   return { yaw: Number(m[1]), x: Number(m[2] ?? 0), z: Number(m[3] ?? 0) }
}

const poseOf = (r: Round): Pose => ({ R: turn(r.yaw), C: [r.x, 0, r.z] })
const roundName = (r: Round): string => `${r.yaw >= 0 ? 'l' : 'r'}${Math.abs(r.yaw)}${r.x !== 0 || r.z !== 0 ? `-at${r.x},${r.z}` : ''}`

const to8 = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)))

/** the render as a png: rgb over black, alpha = how much the splat covers (LoadImage's mask is 1 − alpha) */
async function writeRender(path: string, r: Render, withAlpha: boolean, width = r.width): Promise<void> {
   const px = Buffer.alloc(r.width * r.height * 4)
   for (let i = 0; i < r.width * r.height; i++) {
      px[i * 4] = to8(r.color[i * 3]!)
      px[i * 4 + 1] = to8(r.color[i * 3 + 1]!)
      px[i * 4 + 2] = to8(r.color[i * 3 + 2]!)
      px[i * 4 + 3] = withAlpha ? to8(r.alpha[i]!) : 255
   }
   await sharp(px, { raw: { width: r.width, height: r.height, channels: 4 } }).resize(width).png().toFile(path)
}

async function writeMask(path: string, r: Render): Promise<number> {
   const px = Buffer.alloc(r.width * r.height)
   let hole = 0
   for (let i = 0; i < px.length; i++) {
      const empty = r.alpha[i]! < COVERED
      px[i] = empty ? 255 : 0
      if (empty) hole++
   }
   await sharp(px, { raw: { width: r.width, height: r.height, channels: 1 } }).png().toFile(path)
   return hole / px.length
}

async function fill(renderPng: string, seed: number, extend: string): Promise<Uint8Array> {
   growSplatFill.vars.render.set(renderPng)
   growSplatFill.vars.seed.set(seed)
   growSplatFill.vars.prompt.set(extend === '' ? FILL_PROMPT : `${FILL_PROMPT} Beyond the picture: ${extend}`)
   const execution = await growSplatFill.run({ log: false })
   const filled = execution.images.find((i) => i.tags.includes('filled'))
   if (filled == null) throw new Error(`the fill run gave no 'filled' image (${execution.images.length} images)`)
   return filled.buffer
}

/** the camera rounds are drawn with: the picture's own */
function cameraOf(s: Splat): SplatCamera {
   if (s.camera == null) throw new Error('the world splat has no camera (intrinsic, image_size): grow needs a SHARP ply')
   return s.camera
}

/** a round at a glance: the render, its empty part, the filled view, the world after the merge (2 × 2, 768 px each) */
async function sheet(path: string, pictures: string[]): Promise<void> {
   const W = 768
   const H = 512
   const tiles = await Promise.all(
      pictures.map(async (p, i) => ({
         input: await sharp(p).flatten({ background: '#000000' }).resize(W, H).png().toBuffer(),
         left: (i % 2) * (W + 8),
         top: Math.floor(i / 2) * (H + 8),
      })),
   )
   await sharp({ create: { width: 2 * W + 8, height: 2 * H + 8, channels: 3, background: '#ffffff' } }).composite(tiles).webp().toFile(path)
}

async function grow(dir: string, rounds: Round[], extend: string, seed0: number, fresh: boolean, reuse: boolean): Promise<void> {
   const out = join(dir, 'grow')
   mkdirSync(out, { recursive: true })
   const grownPath = join(dir, 'splat-grown.ply')
   const logPath = join(out, 'rounds.json')
   const resume = !fresh && existsSync(grownPath) && existsSync(logPath)
   const log: RoundLog[] = resume ? (JSON.parse(readFileSync(logPath, 'utf8')) as RoundLog[]) : []
   const picture = readSplat(join(dir, 'splat.ply'))
   const cam = cameraOf(picture)
   let world = resume ? readSplat(grownPath) : trimToFrame(picture, cam)
   console.log(`${resume ? 'resume' : 'start'}: ${world.n} gaussians, ${log.length} rounds done`)
   for (const r of rounds) {
      const t0 = performance.now()
      const n = log.length + 1
      const tag = `r${String(n).padStart(2, '0')}-${roundName(r)}`
      const pose = poseOf(r)
      const view = render(world, cam, pose)
      const renderPng = join(out, `${tag}-render.png`)
      await writeRender(renderPng, view, true)
      const hole = await writeMask(join(out, `${tag}-mask.png`), view)
      console.log(`${tag}: ${(hole * 100).toFixed(1)} % empty, filling`)
      const seedN = seed0 + n
      const filledPng = join(out, `${tag}-filled.png`)
      if (!(reuse && existsSync(filledPng))) await sharp(await fill(renderPng, seedN, extend)).removeAlpha().png().toFile(filledPng)
      const liftedPly = join(out, `${tag}-lifted.ply`)
      const tf = performance.now()
      console.log(`${tag}: filled in ${Math.round((tf - t0) / 1000)} s, lifting`)
      if (!(reuse && existsSync(liftedPly))) sharpPredict(filledPng, liftedPly)
      const tl = performance.now()
      const placed = place({ lifted: readSplat(liftedPly), world: view, cam, pose, keepBelow: KEEP_BELOW })
      world = concatSplats([world, placed.kept])
      await writeRender(join(out, `${tag}-after.png`), render(world, cam, pose), false)
      await sheet(join(out, `${tag}-sheet.webp`), [renderPng, join(out, `${tag}-mask.png`), filledPng, join(out, `${tag}-after.png`)])
      writeSplat(grownPath, world)
      const seconds = Math.round((performance.now() - t0) / 1000)
      log.push({ ...r, round: n, seed: seedN, seconds, scale: placed.fit.scale, spread: placed.fit.spread, fitPixels: placed.fit.pixels, hole, kept: placed.kept.n, total: placed.total, gaussians: world.n })
      writeFileSync(logPath, `${JSON.stringify(log, null, 3)}\n`)
      console.log(
         `${tag}: ${seconds} s (fill ${Math.round((tf - t0) / 1000)} s, SHARP ${Math.round((tl - tf) / 1000)} s), scale ×${placed.fit.scale.toFixed(3)} ` +
            `(half the pixels within ×${placed.fit.spread[0].toFixed(2)}..×${placed.fit.spread[1].toFixed(2)}), kept ${placed.kept.n} of ${placed.total}, world ${world.n}`,
      )
   }
}

/** the cameras a grown world is judged from: turns to each side, then steps forward */
const VIEW_ROUNDS: Round[] = [
   { yaw: 90, x: 0, z: 0 },
   { yaw: 60, x: 0, z: 0 },
   { yaw: 30, x: 0, z: 0 },
   { yaw: 0, x: 0, z: 0 },
   { yaw: -30, x: 0, z: 0 },
   { yaw: -60, x: 0, z: 0 },
   { yaw: -90, x: 0, z: 0 },
   { yaw: 0, x: 0, z: 1.5 },
   { yaw: 0, x: 0, z: 3 },
   { yaw: 30, x: 0, z: 2 },
   { yaw: -30, x: 0, z: 2 },
   { yaw: 0, x: 1, z: 1 },
]

/** one sheet: a row per camera, the picture's splat on the left and the grown one on the right */
async function views(dir: string): Promise<void> {
   const out = join(dir, 'grow')
   mkdirSync(out, { recursive: true })
   const seedSplat = readSplat(join(dir, 'splat.ply'))
   const grown = readSplat(join(dir, 'splat-grown.ply'))
   const cam = cameraOf(seedSplat)
   const W = 640
   const H = Math.round((W * cam.height) / cam.width)
   const tiles: { input: string; left: number; top: number }[] = []
   for (const [i, r] of VIEW_ROUNDS.entries()) {
      for (const [j, s] of [seedSplat, grown].entries()) {
         const p = join(out, `view-${roundName(r)}-${j === 0 ? 'seed' : 'grown'}.png`)
         await writeRender(p, render(s, cam, poseOf(r)), false, W)
         tiles.push({ input: p, left: j * (W + 8), top: i * (H + 8) })
      }
   }
   const sheet = join(out, 'views.png')
   await sharp({ create: { width: 2 * W + 8, height: VIEW_ROUNDS.length * (H + 8), channels: 3, background: '#ffffff' } })
      .composite(tiles)
      .png()
      .toFile(sheet)
   console.log(`🟢 ${sheet} (rows: ${VIEW_ROUNDS.map(roundName).join(' ')})`)
}

if (import.meta.main) {
   const args = process.argv.slice(2)
   const flag = (name: string): string | null => {
      const i = args.indexOf(name)
      return i >= 0 ? (args[i + 1] ?? null) : null
   }
   const dirArg = args[0]
   if (dirArg == null || dirArg.startsWith('--')) throw new Error('usage: grow.ts <world folder holding splat.ply> [--rounds "30 -30"] [--extend "…"] [--seed n] [--fresh] [--views]')
   const dir = resolve(dirArg)
   if (!existsSync(join(dir, 'splat.ply'))) throw new Error(`${dir} has no splat.ply`)
   try {
      if (args.includes('--views')) await views(dir)
      else {
         const rounds = (flag('--rounds') ?? '30 -30 60 -60').trim().split(/\s+/).map(parseRound)
         await grow(dir, rounds, flag('--extend') ?? '', Number(flag('--seed') ?? 1), args.includes('--fresh'), args.includes('--reuse'))
      }
   } finally {
      growSplatFill.host.disconnect()
   }
}
