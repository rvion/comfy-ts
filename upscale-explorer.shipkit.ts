// the upscale explorer (examples/upscale-explorer) as a global process of the machine: every upscaler
// of windows-1 on one image, a synced loupe at 100 % pixels and the five compare modes. It reaches the
// box through the comfyui process's tunnel (127.0.0.1:8085), which works on the LAN when the tailnet
// does not.
import { globalProcess } from 'rvlib-shipkit/src/shipkit-files.ts'

export default globalProcess({
   id: 'upscale-explorer',
   label: 'upscale explorer',
   description: 'every upscaler of windows-1 on one image: a synced loupe at 100 % pixels, five compare modes',
   cmd: ['env', 'COMFY_URL=http://127.0.0.1:8085', 'bun', 'run', 'upscale'],
   url: 'http://127.0.0.1:8294',
})
