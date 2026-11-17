import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import {
   addHostCache,
   formatFindings,
   hostNameFindings,
   inventoryFindings,
   MAX_HOST_MODEL_NAMES,
   MAX_UNKNOWN_MODEL_NAMES,
   modelNamesInText,
   readHostCaches,
   readLocalPublicNames,
   trackedPublicNames,
   type HostNames,
} from 'tests/hostInventory.ts'
import { packedFiles, readTexts, REPO_ROOT, shippedTexts, type ShippedText } from 'tests/shippedFiles.ts'

/**
 * No shipped file carries the model inventory of a host (rules and reasons: tests/hostInventory.ts).
 * Every sample below is synthetic, built from parts so this file never lists a real name, and
 * never enough names to trip the inventory rule on itself.
 */
const lora = (stem: string): string => `zq-${stem}.safetensors`
const ckpt = (i: number): string => `zq-merge-${i}.safetensors`
const PUBLIC_CKPT = `public-base-xl.${'safetensors'}`
const HOST_LORAS = [
   lora('ink-wash-look'),
   lora('hero-portrait'),
   lora('moody-light'),
   `zq my private look.${'safetensors'}`,
   lora('ab'),
]

function syntheticHost(): HostNames {
   const host: HostNames = { hostIds: [], models: new Set(), loras: new Set() }
   const objectInfo = {
      LoraLoader: {
         input: { required: { lora_name: [HOST_LORAS.map((n, i) => (i % 2 === 0 ? `styles/${n}` : `chars\\${n}`))] } },
      },
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [[PUBLIC_CKPT, ...[1, 2, 3, 4, 5].map(ckpt)]] } } },
   }
   addHostCache(host, 'fakebox', objectInfo, null)
   return host
}

const doc = (file: string, text: string): ShippedText => ({ file, text })
const run = (texts: ShippedText[], late: () => Set<string> = () => new Set()) =>
   hostNameFindings(texts, syntheticHost(), new Set([PUBLIC_CKPT]), late)

describe('the guard FAILS on a captured inventory (synthetic host)', () => {
   it('a captured LoraLoader combo in a fixture', () => {
      const captured = JSON.stringify(syntheticHostCombo())
      const f = run([doc('tests/fixtures/object_info-captured.json', captured)])
      expect(f).toHaveLength(1)
      expect(f[0]?.names.length).toBe(HOST_LORAS.length)
   })

   it('one host only lora in a doc line: by full name, by stem in a prompt, with spaces', () => {
      expect(run([doc('agent/notes.md', `load \`${HOST_LORAS[0]}\` for the look`)])).toHaveLength(1)
      expect(run([doc('agent/notes.md', 'prompt: a castle, <lora:zq-hero-portrait:0.8>')])).toHaveLength(1)
      expect(run([doc('agent/notes.md', '"lora": "zq my private look:1"')])).toHaveLength(1)
   })

   it('a host only lora in examples/ too: authored or not, a lora name never ships', () => {
      expect(run([doc('examples/rvion/99-x.cflow.ts', `lora_name: '${HOST_LORAS[2]}'`)])).toHaveLength(1)
   })

   it('a file named after a lora: the path counts', () => {
      expect(run([doc('tests/fixtures/zq-moody-light.png', '')])).toHaveLength(1)
   })

   it('a short lora stem counts with its extension', () => {
      expect(run([doc('tests/x.test.ts', `'${HOST_LORAS[4]}'`)])).toHaveLength(1)
   })

   it(`more than ${MAX_HOST_MODEL_NAMES} host only checkpoints in one file outside examples/`, () => {
      const names = [1, 2, 3, 4].map(ckpt)
      const f = run([doc('tests/fixtures/ws-frames-captured.json', JSON.stringify({ ckpt_name: names }))])
      expect(f).toHaveLength(1)
      expect(f[0]?.names.length).toBe(4)
   })

   it('a file in a packed but untracked place, read through the real loaders from disk', () => {
      const root = mkdtempSync(join(tmpdir(), 'comfy-ts-host-inventory-'))
      try {
         writeFileSync(join(root, 'package.json'), JSON.stringify({ files: ['dist', 'README.md'] }))
         mkdirSync(join(root, 'dist'))
         writeFileSync(join(root, 'dist', 'bundle.js'), `const seen = ["${HOST_LORAS[1]}"]`)
         writeFileSync(join(root, 'dist', 'clean.js'), `const model = "${PUBLIC_CKPT}"`)
         mkdirSync(join(root, '.comfy-ts', 'hosts', 'fakebox'), { recursive: true })
         writeFileSync(
            join(root, '.comfy-ts', 'hosts', 'fakebox', 'object_info.json'),
            JSON.stringify(syntheticHostCombo()),
         )
         mkdirSync(join(root, '.comfy-ts', 'hosts', 'comfy-cloud'), { recursive: true })
         writeFileSync(
            join(root, '.comfy-ts', 'hosts', 'comfy-cloud', 'object_info.json'),
            JSON.stringify({ LoraLoader: { input: { required: { lora_name: [[HOST_LORAS[3]]] } } } }),
         )
         const host = readHostCaches(root)
         expect(host.hostIds).toEqual(['fakebox'])
         const texts = readTexts(root, packedFiles(root))
         expect(texts.map((t) => t.file).sort()).toEqual(['dist/bundle.js', 'dist/clean.js'])
         const f = hostNameFindings(texts, host, new Set(), () => readLocalPublicNames(root))
         expect(f.map((x) => x.file)).toEqual(['dist/bundle.js'])
      } finally {
         rmSync(root, { recursive: true, force: true })
      }
   })

   it(`cache free: more than ${MAX_UNKNOWN_MODEL_NAMES} model names no public catalog carries`, () => {
      const names = Array.from({ length: MAX_UNKNOWN_MODEL_NAMES + 1 }, (_, i) => ckpt(i))
      const f = inventoryFindings([doc('tests/fixtures/captured.json', JSON.stringify(names))], new Set())
      expect(f).toHaveLength(1)
      expect(inventoryFindings([doc('x.json', JSON.stringify(names.slice(1)))], new Set())).toEqual([])
   })

   it('the message names the file, the count and masked samples, and never a whole name', () => {
      const f = run([doc('tests/fixtures/object_info-captured.json', JSON.stringify(syntheticHostCombo()))])
      const msg = formatFindings(f)
      expect(msg).toContain('tests/fixtures/object_info-captured.json')
      expect(msg).toContain(`${HOST_LORAS.length} lora file names`)
      expect(msg).toContain('zq-i…(')
      expect(msg).toContain('PUBLIC_MODEL_NAMES')
      for (const n of HOST_LORAS) expect(msg).not.toContain(n.replace('.safetensors', ''))
   })
})

describe('the guard PASSES the legitimate lookalikes', () => {
   it('a public model the host also has', () => {
      expect(run([doc('agent/notes.md', `ckpt_name: '${PUBLIC_CKPT}'`)])).toEqual([])
   })

   it('a host only name a late public source carries, read only when a file would fail', () => {
      let reads = 0
      const late = () => {
         reads++
         return new Set([HOST_LORAS[0] ?? ''])
      }
      expect(run([doc('a.md', 'nothing here')], late)).toEqual([])
      expect(reads).toBe(0)
      expect(run([doc('a.md', `\`${HOST_LORAS[0]}\``)], late)).toEqual([])
      expect(reads).toBe(1)
   })

   it('a lora stem inside a longer model name, and a short stem alone', () => {
      expect(run([doc('a.md', `unet_name: 'wan9_zq-moody-light_14b_fp8.${'safetensors'}'`)])).toEqual([])
      expect(run([doc('a.md', 'the zq-ab preset')])).toEqual([])
   })

   it(`up to ${MAX_HOST_MODEL_NAMES} host only checkpoints outside examples/, any number inside`, () => {
      const three = JSON.stringify([1, 2, 3].map(ckpt))
      const five = JSON.stringify([1, 2, 3, 4, 5].map(ckpt))
      expect(run([doc('agent/notes.md', three)])).toEqual([])
      expect(run([doc('examples/rvion/99-x.cflow.ts', five)])).toEqual([])
   })

   it('the synthetic lora fixture and a handful of names are not an inventory', () => {
      const fixture = shippedTexts().filter((t) => t.file === 'tests/fixtures/lm-loras-list.synthetic.json')
      expect(fixture).toHaveLength(1)
      expect(inventoryFindings(fixture, new Set())).toEqual([])
   })

   it('a name with spaces is one name, and prose around it is not part of it', () => {
      const found = modelNamesInText(
         `see "zq my private look.${'safetensors'}" and then load zq-a.${'safetensors'} next`,
      )
      expect(found.wide).toContain(`zq my private look.${'safetensors'}`)
      expect([...found.tokens].sort()).toEqual([`look.${'safetensors'}`, `zq-a.${'safetensors'}`])
   })
})

function syntheticHostCombo(): unknown {
   return { LoraLoader: { input: { required: { lora_name: [HOST_LORAS] } } } }
}

const realHost = readHostCaches(REPO_ROOT)
const noHost = realHost.hostIds.length === 0
if (noHost)
   console.warn(
      'no-host-inventory: SKIPPED the private host names rule, no `.comfy-ts/hosts/<id>/object_info.json` here (a clone, CI). The cache free inventory rule still ran.',
   )

describe('everything git tracks and npm packs, as it stands', () => {
   it('runs from the repo it guards, or it scans nothing and passes green', () => {
      const files = shippedTexts().map((t) => t.file)
      expect(files).toContain('package.json')
      expect(files.some((f) => f.startsWith('src/'))).toBe(true)
   })

   it('no file lists an inventory of model names no public catalog carries', () => {
      const texts = shippedTexts()
      const msg = formatFindings(inventoryFindings(texts, trackedPublicNames(texts).tokens))
      expect(msg).toBe('')
   })

   it.skipIf(noHost)(
      `no file carries the names of a private host (${realHost.hostIds.length} host caches here)`,
      () => {
         const texts = shippedTexts()
         const findings = hostNameFindings(texts, realHost, trackedPublicNames(texts).basenames, () =>
            readLocalPublicNames(REPO_ROOT),
         )
         expect(formatFindings(findings)).toBe('')
      },
   )
})
