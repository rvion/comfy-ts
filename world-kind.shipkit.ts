// comfy-ts's own kinds of thread objects (wiki tools/shipkit/threads-custom-kinds.md). A unit that declares a kind
// refuses every other repo kind: a new kind this repo posts on is declared here too.
// `world:<name>` is a folder of .comfy-ts/worlds/: its state names the files the version shows
// (`{ name, files }`), the world explorer's page draws it, both sides of a change share one camera
import { review } from 'rvlib-shipkit/src/shipkit-files.ts'

export default review({
   kinds: {
      world: {
         label: 'Worlds',
         icon: 'M10 3a7 7 0 1 0 0 14 7 7 0 1 0 0-14M3 10h14M10 3c-2.5 2-2.5 12 0 14M10 3c2.5 2 2.5 12 0 14',
         address: '<name>',
         key: (s) => (typeof s.name === 'string' ? s.name : null),
         view: { page: 'world' },
         diff: { draw: 'views' },
      },
   },
})
