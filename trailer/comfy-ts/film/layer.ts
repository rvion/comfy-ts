// the cut's corner mark: the comfy-ts icon, small, in the top right corner (outside every window and clear of the
// titles), from the first step's body shot to the end card, laid over the built cut in place. The trailer language
// has no overlay that spans shots in a landscape cut (only a vertical's watermark), so this runs after the build.
//   bun trailer/comfy-ts/film/layer.ts [from shot] [to shot]   (default hosts, end)
import { renameSync } from 'fs'
import { join, resolve } from 'path'

const [fromShot = 'hosts', toShot = 'end'] = process.argv.slice(2)
const here = resolve(import.meta.dir, '..')
const repo = resolve(here, '../..')
const cut = join(here, 'out/comfy-ts.mp4')
const icon = join(repo, '.shipkit/identity/icon.png')
const SIZE = 44
const MARGIN = 14
const FADE = 0.3

// the shots' start times, as the cut's own timeline prints them
const check = Bun.spawnSync(['sk', 'trailer', 'check', join(here, 'main.trailer')], { cwd: repo })
const timeline = check.stdout.toString()
const startOf = (name: string): number => {
   const m = new RegExp(`^\\s+\\d+\\s+([\\d.]+) s\\s+${name}\\s`, 'm').exec(timeline)
   if (m == null) throw new Error(`layer: no shot ${name} in the timeline of sk trailer check`)
   return Number(m[1])
}
const from = startOf(fromShot)
const to = startOf(toShot)

const tmp = cut.replace(/\.mp4$/, '.layer.mp4')
// the mark fades in and out over FADE: geq scales its alpha plane by the frame's time T
const alpha = `if(lt(T,${from}),0,if(lt(T,${from + FADE}),(T-${from})/${FADE},if(lt(T,${to - FADE}),1,if(lt(T,${to}),(${to}-T)/${FADE},0))))`
const graph = [
   `[1:v]scale=-1:${SIZE},format=rgba,loop=-1:1,setpts=N/30/TB,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*0.92*(${alpha})'[m]`,
   `[0:v][m]overlay=x=W-w-${MARGIN}:y=${MARGIN}:shortest=1[o]`,
].join(';')
const ff = Bun.spawnSync(
   ['ffmpeg', '-v', 'error', '-y', '-i', cut, '-framerate', '30', '-i', icon, '-filter_complex', graph, '-map', '[o]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'copy', tmp],
   { stderr: 'inherit' },
)
if (ff.exitCode !== 0) throw new Error('layer: ffmpeg failed')
renameSync(tmp, cut)
console.log(`layer: the comfy-ts mark from ${fromShot} (${from} s) to ${toShot} (${to} s) on ${cut}`)
