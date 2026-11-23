// a long fly-through, clip by clip: 19-flythrough cut along one camera path, each clip started
// from the last frame of the clip before. The picture's MoGe mesh is made once on the box and kept,
// the guide of every clip is drawn here (flythroughGuide.ts), so the box only runs Wan.
// Writes into <out>: mesh.glb, clip-<k>.mp4 with its guide, colour render and coverage beside it,
// cameras.json (every frame's camera), and flythrough.mp4, the clips joined.
//
// run:  bun examples/rvion/flythroughChain.ts <picture> <settings.json> <out> [from] [to]
// settings.json holds 19-flythrough's vars ({ "path": "orbit", "clips": 7, "fov": 62, … })
import { $ } from 'bun'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'pathe'
import sharp from 'sharp'
import { ComfyTS } from 'comfy-ts'
import flythrough, { chainStart, premadeCoverage, premadeGuide, premadeRender } from './19-flythrough.cflow.ts'
import { dropStretched, levelMesh, readGlb, renderGuideFrame, type GuideMesh } from './flythroughGuide.ts'
import { matchFrame, paletteOf, pictureAt } from './flythroughPalette.ts'
import { clipFrames, ENGINES, frameFovY, pathCameras } from './flythroughPath.ts'

const [picture, settingsPath, out, fromArg, toArg] = process.argv.slice(2)
if (picture == null || settingsPath == null || out == null)
   throw new Error('usage: bun examples/rvion/flythroughChain.ts <picture> <settings.json> <out> [from] [to]')
mkdirSync(out, { recursive: true })
const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
for (const [key, value] of Object.entries(settings)) {
   const slot = Object.entries(flythrough.vars).find(([name]) => name === key)?.[1]
   if (slot == null) throw new Error(`settings: no var '${key}' on 19-flythrough`)
   if (!slot.parse(typeof value === 'string' ? value : JSON.stringify(value)))
      throw new Error(`settings: '${key}' does not take ${JSON.stringify(value)}`)
}
flythrough.vars.image.set(picture)
const v = flythrough.vars

// the mesh, once: MoGe of the picture on the box, saved as a glb
const host = ComfyTS.create().host({ id: 'windows-1' })
await host.loadSchemaFromCache()
const meshPath = join(out, 'mesh.glb')
if (!existsSync(meshPath)) {
   const fov = v.fov.value
   const meshFlow = host.defineWorkflow({
      id: 'flythrough-mesh',
      vars: {},
      build: async (b, _vars, wf) => {
         const geometry = b.MoGeInference({
            moge_model: b.LoadMoGeModel({ model_name: 'moge_2_vitl_normal_fp16.safetensors' }),
            image: await v.image.loadInWorkflow(wf),
            fov_x_degrees: fov,
         })
         b.SaveGLB({ mesh: b.MoGePointMapToMesh({ moge_geometry: geometry }), filename_prefix: 'comfy-ts-example/flythrough-mesh' })
      },
   })
   const made = await meshFlow.run({})
   const glb = made.models3d[0]
   if (glb == null) throw new Error('flythrough chain: the box sent no mesh back')
   writeFileSync(meshPath, glb.bytes)
}
const parsed = readGlb(new Uint8Array(readFileSync(meshPath)))
const decoded = await sharp(parsed.textureBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
// without its curtains (dropStretched): seen from the side they are streaks Wan would copy; in the
// path's levelled world (the picture's pitch)
const mesh: GuideMesh = levelMesh(
   dropStretched({ ...parsed, texture: { width: decoded.info.width, height: decoded.info.height, rgb: new Uint8Array(decoded.data) } }, 3),
   v.pitch.value,
)

// the whole path, every camera, written once
const source = v.size.imageSize()
if (source == null) throw new Error(`flythrough chain: cannot read the size of ${picture}`)
const length = clipFrames(v.engine.value, v.seconds.value)
const fps = ENGINES[v.engine.value].fps
const cameras = pathCameras({
   path: v.path.value,
   length,
   clips: v.clips.value,
   fovX: v.fov.value,
   distance: v.distance.value,
   turn: v.turn.value,
   rise: v.rise.value,
   aim: v.aim.value,
   aimRow: v.aimRow.value,
   aspect: source.height / source.width,
   aimDistance: v.aimDistance.value,
   radius: v.radius.value,
   sweep: v.sweep.value,
   pitch: v.pitch.value,
})
const size = v.size.value
const fovY = frameFovY({ picture: source, fovX: v.fov.value, size })
writeFileSync(join(out, 'cameras.json'), JSON.stringify({ fovY, pitch: v.pitch.value, width: size.width, height: size.height, length, cameras }, null, 1))

/** frames of raw rgb into an mp4 at the engine's fps */
const encode = async (frames: Uint8Array[], file: string) => {
   const dir = `${file}.frames`
   mkdirSync(dir, { recursive: true })
   await Promise.all(
      frames.map((rgb, i) =>
         sharp(rgb, { raw: { width: size.width, height: size.height, channels: 3 } })
            .png({ compressionLevel: 1 })
            .toFile(join(dir, `${String(i).padStart(4, '0')}.png`)),
      ),
   )
   await $`ffmpeg -loglevel error -y -framerate ${fps} -i ${join(dir, '%04d.png')} -c:v libx264 -crf 12 -pix_fmt yuv420p ${file}`
   await $`rm -rf ${dir}`
}

/** a chained clip starts from the last frame of the one before, and each clip drifts a little in
 * colour: before it seeds the next clip, that frame moves to the picture's Lab mean and spread
 * (flythroughPalette.ts), so the drift cannot add up from clip to clip */
async function matchColours(frame: string, reference: string): Promise<string> {
   const img = await sharp(frame).removeAlpha().raw().toBuffer({ resolveWithObject: true })
   const own = new Uint8Array(img.data)
   const target = paletteOf(await pictureAt(reference, img.info.width, img.info.height))
   const data = matchFrame(own, paletteOf(own), target, 1)
   const outFile = frame.replace(/\.png$/, '-matched.png')
   await sharp(data, { raw: { width: img.info.width, height: img.info.height, channels: 3 } }).png().toFile(outFile)
   return outFile
}

const from = Number(fromArg ?? 0)
const to = Number(toArg ?? v.clips.value - 1)
for (let k = from; k <= to; k++) {
   const t0 = Date.now()
   const own = cameras.slice(k * (length - 1), k * (length - 1) + length)
   const frames = own.map((camera) => renderGuideFrame({ mesh, camera, width: size.width, height: size.height, fovY }))
   const guide = join(out, `clip-${k}-guide.mp4`)
   await encode(frames.map((f) => (v.guide.value === 'depth' ? f.depth : f.color)), guide)
   const render = join(out, `clip-${k}-render.mp4`)
   const coverage = join(out, `clip-${k}-coverage.mp4`)
   await encode(frames.map((f) => f.color), render)
   await encode(frames.map((f) => f.coverage), coverage)
   const drawn = ((Date.now() - t0) / 1000).toFixed(1)

   premadeGuide.set(guide)
   premadeRender.set(render)
   premadeCoverage.set(coverage)
   if (k === 0) chainStart.set('')
   else {
      const last = join(out, `clip-${k - 1}-last.png`)
      await $`ffmpeg -loglevel error -y -sseof -0.3 -i ${join(out, `clip-${k - 1}.mp4`)} -update 1 -frames:v 1 ${last}`
      chainStart.set(await matchColours(last, picture))
   }
   v.clip.set(k)
   const t1 = Date.now()
   const execution = await flythrough.run({})
   const clip = execution.videos.find((x) => x.tags.includes('clip'))
   if (clip == null) throw new Error(`flythrough chain: clip ${k} came back without its video`)
   writeFileSync(join(out, `clip-${k}.mp4`), clip.bytes)
   console.log(`🟢 clip ${k}: guide drawn in ${drawn} s, ${v.engine.value} in ${((Date.now() - t1) / 1000).toFixed(0)} s`)
}

// the joined video: every clip after the first loses its first frame, the last frame of the one before
const parts: string[] = []
for (let k = 0; k < v.clips.value; k++) {
   const file = join(out, `clip-${k}.mp4`)
   if (!existsSync(file)) break
   if (k === 0) parts.push(file)
   else {
      const trimmed = join(out, `clip-${k}-trimmed.mp4`)
      const dropFirst = `select=gte(n\\,1),setpts=N/${fps}/TB`
      await $`ffmpeg -loglevel error -y -i ${file} -vf ${dropFirst} -r ${fps} -c:v libx264 -crf 14 -pix_fmt yuv420p ${trimmed}`
      parts.push(trimmed)
   }
}
writeFileSync(join(out, 'parts.txt'), parts.map((p) => `file '${resolve(p)}'`).join('\n'))
await $`ffmpeg -loglevel error -y -f concat -safe 0 -i ${join(out, 'parts.txt')} -c copy ${join(out, 'flythrough.mp4')}`
console.log(`🟢 ${parts.length} clips joined: ${join(out, 'flythrough.mp4')}`)
host.disconnect()
process.exit(0)
