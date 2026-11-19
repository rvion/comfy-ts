// a sound's own waveform as a picture: the real file drawn by ffmpeg's showwaves on the cut's ground
//   bun trailer/comfy-ts/film/waves.ts <audio> <seconds> <out.mp4> <w> <h> <fps>
const [audio, seconds, out, w = '1280', h = '720', fps = '30'] = process.argv.slice(2)
if (audio == null || seconds == null || out == null) throw new Error('usage: waves.ts <audio> <seconds> <out.mp4> [w h fps]')
const ww = Math.round(Number(w) * 0.86)
const wh = Math.round(Number(h) * 0.42)
const graph = [
   `color=c=0x0b1220:s=${w}x${h}:r=${fps}[bg]`,
   `[0:a]showwaves=s=${ww}x${wh}:mode=cline:colors=0xffb020:r=${fps}[w]`,
   `[bg][w]overlay=(W-w)/2:(H-h)/2+${Math.round(Number(h) * 0.06)}:shortest=1,format=yuv420p`,
].join(';')
const p = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-i', audio, '-filter_complex', graph, '-t', seconds, '-an', out], { stderr: 'inherit' })
process.exit(p.exitCode ?? 1)
