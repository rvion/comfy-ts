// the world explorer's page in the hub (wiki tools/shipkit/project-pages.md): one world drawn in WebGL, the view of the
// `world` kind's versions (world-kind.shipkit.ts). Served by the world-explorer process, every path relative
import { page } from 'rvlib-shipkit/src/pages/unit.ts'

export default page({
   id: 'world',
   title: 'Worlds',
   icon: 'M10 3a7 7 0 1 0 0 14 7 7 0 1 0 0-14M3 10h14M10 3c-2.5 2-2.5 12 0 14M10 3c2.5 2 2.5 12 0 14',
   url: 'http://127.0.0.1:8293/',
   process: 'world-explorer',
   gl: true,
})
