// the world explorer (examples/world-explorer) as a global process of the machine: the page that draws one world of
// .comfy-ts/worlds/ (panorama, mesh, splat, picture), framed by the hub as the `world` kind's view (world-kind.shipkit.ts)
import { globalProcess } from 'rvlib-shipkit/src/shipkit-files.ts'

export default globalProcess({
   id: 'world-explorer',
   label: 'world explorer',
   description:
      'the 3D worlds of .comfy-ts/worlds: drag around a panorama, walk a mesh, orbit a splat; the world kind of the threads',
   cmd: ['bun', 'run', 'world'],
   url: 'http://127.0.0.1:8293',
})
