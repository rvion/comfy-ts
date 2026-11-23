// the depth explorer (examples/depth-explorer) as a global process of the machine: every depth,
// normal and material model of windows-1 on one image, the relight widget over the best maps.
import { globalProcess } from 'rvlib-shipkit/src/shipkit-files.ts'

export default globalProcess({
    id: 'depth-explorer',
    label: 'depth explorer',
    description: 'every depth, normal and material model of windows-1 on one image, with the relight widget',
    cmd: ['bun', 'run', 'depth'],
    url: 'http://127.0.0.1:8292',
})
