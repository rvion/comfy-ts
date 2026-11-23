// the 3D files an output node can publish (ui key `3d`), and their mimes. PURE + dependency-free.
// a sibling of mediaKinds.ts on purpose: MediaKind drives the media VARS, and a 3D output is no var kind

import { extensionOf } from 'src/runner/mediaKinds.ts'

/** ply and spz have no registered mime: the `x-` forms are what three.js and the splat viewers accept */
export const MODEL_3D_MIMES: Readonly<Record<string, string>> = {
   glb: 'model/gltf-binary',
   gltf: 'model/gltf+json',
   ply: 'model/x-ply',
   spz: 'model/x-spz',
   obj: 'model/obj',
   stl: 'model/stl',
}

export function model3dMime(filename: string): string {
   return MODEL_3D_MIMES[extensionOf(filename)] ?? 'application/octet-stream'
}
