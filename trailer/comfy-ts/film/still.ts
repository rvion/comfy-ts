// a still image as a clip a grid or a split can play: it covers the frame and moves in slowly
//   bun trailer/comfy-ts/film/still.ts <image> <seconds> <out.mp4> <w> <h> <fps>
const [image, seconds, out, w = '1280', h = '720', fps = '30'] = process.argv.slice(2)
if (image == null || seconds == null || out == null) throw new Error('usage: still.ts <image> <seconds> <out.mp4> [w h fps]')
const n = Math.round(Number(seconds) * Number(fps))
const vf = [
   `scale=${Number(w) * 2}:${Number(h) * 2}:force_original_aspect_ratio=increase`,
   `crop=${Number(w) * 2}:${Number(h) * 2}`,
   `zoompan=z='1+0.06*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${w}x${h}:fps=${fps}`,
   'format=yuv420p',
].join(',')
const p = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-i', image, '-vf', vf, '-frames:v', String(n), '-r', fps, out], { stderr: 'inherit' })
process.exit(p.exitCode ?? 1)
