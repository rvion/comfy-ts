// the state of a `world:<name>` thread version, from the files its folder holds: `{ json: { name, files }, card? }`.
// The card (title, chips, sizes) is the hub's line under the still; `--card` adds it
//
// usage:  bun examples/world-explorer/world-state.ts <name> [--card]   → prints the state file's path
//   then: sk thread post world:<name> --title … --what … --after <path> --image .comfy-ts/worlds/<name>/thumb.webp
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'

const VIEWS: [file: string, view: string][] = [
   ['panorama.png', '360°'],
   ['world.glb', 'walk'],
   ['splat.ply', 'splat'],
   ['source.png', 'picture'],
]

const name = process.argv[2]
if (name == null || name.startsWith('-')) throw new Error('usage: world-state.ts <name> [--card]')
const dir = join(process.cwd(), '.comfy-ts/worlds', name)
if (!existsSync(dir)) throw new Error(`no world folder ${dir}`)
const present = new Set(readdirSync(dir))
const files = VIEWS.map(([f]) => f).filter((f) => present.has(f))
if (files.length === 0) throw new Error(`${dir} holds none of ${VIEWS.map(([f]) => f).join(', ')}`)

const mb = (f: string): string => `${(statSync(join(dir, f)).size / 1e6).toFixed(0)} MB`
const card = {
   kind: 'world',
   title: name,
   chips: VIEWS.filter(([f]) => present.has(f)).map(([, v]) => v),
   fields: [
      ...(present.has('world.glb') ? [{ label: 'mesh', text: mb('world.glb') }] : []),
      ...(present.has('splat.ply') ? [{ label: 'splat', text: mb('splat.ply') }] : []),
   ],
}
const state = { json: { name, files }, ...(process.argv.includes('--card') ? { card } : {}) }
const out = join(dir, 'state.json')
writeFileSync(out, JSON.stringify(state, null, 2))
console.log(out)
