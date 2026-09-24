// the comfy-ts web panel over examples/rvion, as a global process of the
// machine: started, stopped and opened as its own window from the shipkit
// home page. `bun --watch` restarts it when a module changes.
import { globalProcess } from 'rvlib-shipkit/src/shipkit-files.ts'

export default globalProcess({
    id: 'comfy-panel',
    label: 'comfy panel',
    description: 'comfy-ts web panel over examples/rvion',
    cmd: ['bun', 'run', 'serve:rvion'],
    url: 'http://127.0.0.1:8288',
})
