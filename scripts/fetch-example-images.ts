// fetch the bundled example input images (examples/images/) from picsum.photos
// THIS MANIFEST IS THE SOURCE OF TRUTH: one row per shipped image, exact size
// in the filename (agent/examples.md "Bundled input images"). Images are
// committed DATA — the script only runs by hand: bun run examples:images
// (add --force to refetch rows whose file already exists)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'
import sharp from 'sharp'

export interface ExampleImageSpec {
   /** filename under examples/images/ — MUST be `<subject>_<W>x<H>.jpg` with the exact encoded size */
   name: string
   /** picsum.photos stable image id (https://picsum.photos/id/<id>/info) */
   id: number
   width: number
   height: number
}

/** subjects labeled by eyeballing the fetched image; sizes cover the common latent buckets */
export const EXAMPLE_IMAGES: ExampleImageSpec[] = [
   { name: 'dog_512x512.jpg', id: 237, width: 512, height: 512 },
   { name: 'lioness_768x768.jpg', id: 1074, width: 768, height: 768 },
   { name: 'bear_1024x1024.jpg', id: 433, width: 1024, height: 1024 },
   { name: 'walrus_1344x768.jpg', id: 1084, width: 1344, height: 768 },
   { name: 'deer_768x1344.jpg', id: 1003, width: 768, height: 1344 },
   { name: 'pug_200x300.jpg', id: 1025, width: 200, height: 300 },
]

/** whole-folder weight budget (agent/examples.md): the tarball ships these */
export const EXAMPLE_IMAGES_BUDGET_BYTES = 1.5 * 1024 * 1024

export const EXAMPLE_IMAGES_DIR = join(import.meta.dir, '..', 'examples', 'images')

/** the filename encodes the size — parse it back so manifest typos are impossible to miss */
export function parseImageName(name: string): { subject: string; width: number; height: number } | null {
   const m = /^([a-z0-9-]+)_(\d+)x(\d+)\.jpg$/.exec(name)
   if (m == null) return null
   return { subject: m[1] ?? '', width: Number(m[2]), height: Number(m[3]) }
}

interface PicsumInfo {
   author: string
   url: string
}

async function fetchInfo(p: { id: number }): Promise<PicsumInfo> {
   const url = `https://picsum.photos/id/${p.id}/info`
   const res = await fetch(url)
   if (!res.ok) throw new Error(`[examples:images] 🔴 info fetch failed (${res.status} ${res.statusText}): ${url}`)
   const parsed: unknown = await res.json()
   if (parsed == null || typeof parsed !== 'object')
      throw new Error(`[examples:images] 🔴 info endpoint returned a non-object: ${url}`)
   const o = parsed as { author?: unknown; url?: unknown }
   if (typeof o.author !== 'string' || typeof o.url !== 'string')
      throw new Error(`[examples:images] 🔴 info endpoint missing author/url fields: ${url}`)
   return { author: o.author, url: o.url }
}

async function fetchOne(p: { spec: ExampleImageSpec; force: boolean }): Promise<void> {
   const outPath = join(EXAMPLE_IMAGES_DIR, p.spec.name)
   if (existsSync(outPath) && !p.force) {
      console.log(`[examples:images] ⏭️  ${p.spec.name} exists, skipped (--force to refetch)`)
      return
   }
   const url = `https://picsum.photos/id/${p.spec.id}/${p.spec.width}/${p.spec.height}`
   console.log(`[examples:images] ⏬ ${url}`)
   const res = await fetch(url)
   if (!res.ok) throw new Error(`[examples:images] 🔴 download failed (${res.status} ${res.statusText}): ${url}`)
   const raw = Buffer.from(await res.arrayBuffer())
   // re-encode: weight control + metadata stripped (sharp drops metadata unless asked to keep it)
   const encoded = await sharp(raw).jpeg({ quality: 80, mozjpeg: true }).toBuffer()
   const meta = await sharp(encoded).metadata()
   if (meta.width !== p.spec.width || meta.height !== p.spec.height)
      throw new Error(
         `[examples:images] 🔴 ${p.spec.name}: decoded ${meta.width}x${meta.height} does not match the filename — picsum drift?`,
      )
   writeFileSync(outPath, encoded)
   console.log(`[examples:images] 🟢 ${p.spec.name} (${encoded.length} bytes)`)
}

function renderReadme(p: { infos: Map<number, PicsumInfo> }): string {
   const rows = EXAMPLE_IMAGES.map((spec) => {
      const info = p.infos.get(spec.id)
      if (info == null) throw new Error(`[examples:images] 🔴 no info fetched for picsum id ${spec.id}`)
      return `| \`${spec.name}\` | ${spec.width}×${spec.height} | [${spec.id}](https://picsum.photos/id/${spec.id}/info) | [${info.author}](${info.url}) |`
   })
   return [
      '# Bundled example input images',
      '',
      'Default inputs for the i2i/i2v examples — they ship in the npm tarball so',
      'every example runs out of the box. The exact pixel size is in each filename.',
      '',
      'Source: [picsum.photos](https://picsum.photos), which serves Unsplash-sourced',
      'photos, free to use. Fetched and re-encoded (jpeg q80, metadata stripped) by',
      '`scripts/fetch-example-images.ts` — the manifest in that script is the source',
      'of truth; regeneration is deliberate (`bun run examples:images`).',
      '',
      '| file | size | picsum id | author |',
      '| ---- | ---- | --------- | ------ |',
      ...rows,
      '',
   ].join('\n')
}

async function main(): Promise<void> {
   const force = process.argv.includes('--force')
   mkdirSync(EXAMPLE_IMAGES_DIR, { recursive: true })
   for (const spec of EXAMPLE_IMAGES) await fetchOne({ spec, force })

   const infos = new Map<number, PicsumInfo>()
   for (const spec of EXAMPLE_IMAGES) infos.set(spec.id, await fetchInfo({ id: spec.id }))
   const readmePath = join(EXAMPLE_IMAGES_DIR, 'README.md')
   writeFileSync(readmePath, renderReadme({ infos }))
   // format the generated README so the ci gate stays green after a regen
   // (gen:manager precedent; run via `bun run examples:images` so oxfmt is on PATH)
   const fmt = Bun.spawnSync(['oxfmt', readmePath], { stdout: 'inherit', stderr: 'inherit' })
   if (fmt.exitCode !== 0) throw new Error(`[examples:images] 🔴 oxfmt failed on ${readmePath} (exit ${fmt.exitCode})`)
   console.log(`[examples:images] 🟢 README.md written`)

   const total = EXAMPLE_IMAGES.reduce((sum, spec) => sum + readFileSync(join(EXAMPLE_IMAGES_DIR, spec.name)).length, 0)
   console.log(`[examples:images] total ${total} bytes (budget ${EXAMPLE_IMAGES_BUDGET_BYTES})`)
   if (total > EXAMPLE_IMAGES_BUDGET_BYTES)
      throw new Error(
         `[examples:images] 🔴 folder exceeds the tarball budget: ${total} > ${EXAMPLE_IMAGES_BUDGET_BYTES}`,
      )
}

if (import.meta.main) await main()
