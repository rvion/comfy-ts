// a new soundtrack on a video, on windows-1: the frames of one file, the audio of another, muxed
// back into one video at the fps you pick (lower = slower). Core nodes only, no model
// shows the media vars: v.video and v.audio load through LoadVideo and LoadAudio, and the result
// comes back as a VIDEO output (execution.videos). In the serve panel, drop a file on either var,
// or drag a generated video or audio from the results onto it
// run directly:  bun examples/rvion/14-video-soundtrack.cflow.ts [video.mp4] [audio.flac]
import { ComfyTS, exampleMediaPath, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

// bundled defaults (examples/media/, ship in the tarball)
const video = v.video(exampleMediaPath('testsrc_256x256_3s.mp4'))
const soundtrack = v.audio(exampleMediaPath('sine_440hz_3s.flac'))

export const videoSoundtrack = host.defineWorkflow({
   id: 'video-soundtrack',
   tags: ['soundtrack', 'mux'],
   vars: {
      video,
      soundtrack,
      fps: v.float(12, { min: 1, max: 60 }),
   },
   // async build: both files are uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const frames = b.GetVideoComponents({ video: await video.loadInWorkflow(wf) })
      b.SaveVideo({
         video: b.CreateVideo({ images: frames._IMAGE, fps: vars.fps, audio: await soundtrack.loadInWorkflow(wf) }),
         filename_prefix: 'comfy-ts-example/video-soundtrack',
         format: 'mp4',
         codec: 'h264',
      })
   },
})

export default videoSoundtrack

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) videoSoundtrack.vars.video.set(process.argv[2])
   if (process.argv[3]) videoSoundtrack.vars.soundtrack.set(process.argv[3])

   const execution = await videoSoundtrack.run({ log: true, save: { prefix: 'comfy-ts-example/video-soundtrack' } })
   for (const clip of execution.videos) console.log(`🟢 ${clip.absPath}`)
   host.disconnect()
}
