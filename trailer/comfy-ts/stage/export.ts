// the export beat's graph: the staged scenery module built offline and written as the autolayouted workflow.json the
// ComfyUI canvas opens, with the night and upscale branches on so the canvas shows the whole app
//   cd /tmp/my-project && bun <repo>/trailer/comfy-ts/stage/export.ts
import { writeFileSync } from 'node:fs'

const { scenery } = await import('/tmp/my-project/scenery.cflow.ts')
await scenery.host.loadSchemaFromCache()
scenery.vars.night.set(true)
scenery.vars.upscale.set(true)
const wf = await scenery.build({ dry: true })
writeFileSync('/tmp/my-project/scenery.workflow.json', JSON.stringify(await wf.toWorkflowJson(), null, 1))
console.log('wrote /tmp/my-project/scenery.workflow.json')
