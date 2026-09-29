import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { findModules, workspaceOf } from 'src/cli/run/findModules.ts'
import { flagValue } from 'src/cli/run/flagValue.ts'
import { outputPaths, sidecarPath } from 'src/cli/run/outputPaths.ts'
import { pickModule } from 'src/cli/run/pickModule.ts'
import { parseRunArgs } from 'src/cli/run/runArgs.ts'

const FILES = [
   '/w/examples/rvion/10-anima-t2i.cflow.ts',
   '/w/examples/rvion/13-ace-step-15-xl-t2a.cflow.ts',
   '/w/examples/rvion/15-tts-voice-clone.cflow.ts',
   '/w/examples/rvion/16-tts-voice-design.cflow.ts',
   '/w/examples/comfy-cloud/anima-t2i.cflow.ts',
]

describe('comfy-ts run: which module a name means', () => {
   it('a key, the key without its number, a prefix, a unique part, and a folder that narrows', () => {
      expect(pickModule(FILES, '10-anima-t2i')).toEqual({ key: '10-anima-t2i', file: FILES[0]! })
      expect(pickModule(FILES, 'rvion/anima')).toEqual({ key: '10-anima-t2i', file: FILES[0]! })
      expect(pickModule(FILES, 'comfy-cloud/anima')).toEqual({ key: 'anima-t2i', file: FILES[4]! })
      expect(pickModule(FILES, 'ace-step')).toEqual({ key: '13-ace-step-15-xl-t2a', file: FILES[1]! })
      expect(pickModule(FILES, 'voice-design')).toEqual({ key: '16-tts-voice-design', file: FILES[3]! })
   })

   it('two modules for one name is an error naming both with their folder; an unknown name lists every module', () => {
      const amb = pickModule(FILES, 'anima')
      expect('error' in amb && amb.error).toContain('rvion/10-anima-t2i, comfy-cloud/anima-t2i')
      // an exact key wins over the longer keys it is part of: the cloud module is named anima-t2i
      expect(pickModule(FILES, 'anima-t2i')).toEqual({ key: 'anima-t2i', file: FILES[4]! })
      const tts = pickModule(FILES, 'tts')
      expect('error' in tts && tts.error).toContain('rvion/15-tts-voice-clone, rvion/16-tts-voice-design')
      const none = pickModule(FILES, 'nope')
      expect('error' in none && none.error).toContain("no module matches 'nope'")
   })
})

describe('comfy-ts run: a flag string as the value serve takes', () => {
   const f = (
      kind: Parameters<typeof flagValue>[0]['spec']['kind'],
      raw: string | true,
      select?: 'one' | 'zero-or-one' | 'many',
   ) => flagValue({ name: 'x', spec: { kind, select }, raw, cwd: '/here' })

   it('numbers stay strings for int and float, a seed is a number, ? a random one', () => {
      expect(f('int', '30')).toEqual({ value: '30' })
      expect(f('seed', '7')).toEqual({ value: 7 })
      // why we think it is actually a bug, and not just meaning spec should change: `--seed ?` is documented as a new variation, and serve rerolls a '?' mode only when the payload leaves the seed out, so the run repeated the draft's seed
      const fresh = f('seed', '?')
      expect('value' in fresh && typeof fresh.value).toBe('number')
      // control: two rolls differ, a typed seed stays that seed
      expect(f('seed', '?')).not.toEqual(fresh)
      expect(f('seed', '12')).toEqual({ value: 12 })
      expect('error' in f('seed', 'seven')).toBe(true)
   })

   it('a toggle from a word or a bare flag; choices as one, none, or a comma list', () => {
      expect(f('toggle', true)).toEqual({ value: true })
      expect(f('toggle', 'no')).toEqual({ value: false })
      expect('error' in f('toggle', 'maybe')).toBe(true)
      expect(f('choice', 'SFX')).toEqual({ value: 'SFX' })
      expect(f('choice', 'none', 'zero-or-one')).toEqual({ value: null })
      expect(f('choice', '7, 8', 'many')).toEqual({ value: ['7', '8'] })
   })

   it('a media path resolves against the cwd, an absolute path or a url goes through; loras are json', () => {
      expect(f('audio', 'voices/a.flac')).toEqual({ value: '/here/voices/a.flac' })
      expect(f('image', '/abs/in.png')).toEqual({ value: '/abs/in.png' })
      expect(f('image', 'https://x.dev/a.png')).toEqual({ value: 'https://x.dev/a.png' })
      expect(f('loras', '{"a.safetensors": 0.8}')).toEqual({ value: { 'a.safetensors': 0.8 } })
      expect('error' in f('loras', 'a.safetensors')).toBe(true)
      // control: a value flag with no value is refused, never taken as true
      expect('error' in f('text', true)).toBe(true)
   })
})

describe('comfy-ts run: where the outputs go', () => {
   const one = [{ filename: 'ComfyUI_temp_00001.flac' }]
   const two = [{ filename: 'a_00001.png' }, { filename: 'a_00002.png' }]
   const base = { module: '10-anima-t2i', promptId: '9429de52-7634', cwd: '/here', outIsDir: false }

   it('one output lands exactly at --out; several are numbered; a dir keeps the server names', () => {
      expect(outputPaths({ ...base, out: 'voices/sailor.flac', items: one })).toEqual([
         { path: '/here/voices/sailor.flac', note: null },
      ])
      expect(outputPaths({ ...base, out: 'img/knight.png', items: two }).map((d) => d.path)).toEqual([
         '/here/img/knight-1.png',
         '/here/img/knight-2.png',
      ])
      expect(outputPaths({ ...base, out: 'out/', outIsDir: true, items: two }).map((d) => d.path)).toEqual([
         '/here/out/a_00001.png',
         '/here/out/a_00002.png',
      ])
   })

   it('an extension that is not the output one is swapped and said; no --out names it after the module', () => {
      expect(outputPaths({ ...base, out: 'line.wav', items: one })).toEqual([
         { path: '/here/line.flac', note: 'the output is .flac, not .wav' },
      ])
      expect(outputPaths({ ...base, out: 'line', items: one })).toEqual([{ path: '/here/line.flac', note: null }])
      expect(outputPaths({ ...base, out: null, items: one })).toEqual([
         { path: '/here/10-anima-t2i-9429de52.flac', note: null },
      ])
      expect(sidecarPath('/here/voices/sailor.flac')).toBe('/here/voices/sailor.txt')
   })
})

describe('comfy-ts run: arguments', () => {
   it('the name, its own flags, and every other flag as a var in order, with = and bare forms', () => {
      expect(
         parseRunArgs(['rvion/anima', '--prompt', 'a knight', '--seed=7', '--removeBg', '--out', 'k.png', '--json']),
      ).toEqual({
         name: 'rvion/anima',
         draft: 'default',
         out: 'k.png',
         json: true,
         verbose: false,
         help: false,
         vars: [
            ['prompt', 'a knight'],
            ['seed', '7'],
            ['removeBg', true],
         ],
      })
      // a negative number is a value, not a flag
      const neg = parseRunArgs(['m', '--cfg', '-1'])
      expect('error' in neg ? null : neg.vars).toEqual([['cfg', '-1']])
      expect('error' in parseRunArgs(['a', 'b'])).toBe(true)
      expect('error' in parseRunArgs(['a', '--out'])).toBe(true)
   })
})

describe('comfy-ts run: discovery on disk', () => {
   let root: string
   beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'cli-run-'))
   })
   afterEach(() => rmSync(root, { recursive: true, force: true }))

   it('finds modules under the cwd but never in node_modules or a dot dir; a module roots at the folder holding .comfy-ts', () => {
      const put = (rel: string): void => {
         mkdirSync(join(root, rel, '..'), { recursive: true })
         writeFileSync(join(root, rel), '')
      }
      put('flows/a.cflow.ts')
      put('node_modules/pkg/b.cflow.ts')
      put('.cache/c.cflow.ts')
      put('flows/notes.ts')
      expect(findModules(root)).toEqual([join(root, 'flows/a.cflow.ts')])
      expect(workspaceOf(join(root, 'flows/a.cflow.ts'))).toBeNull()
      mkdirSync(join(root, '.comfy-ts'))
      expect(workspaceOf(join(root, 'flows/a.cflow.ts'))).toBe(root)
   })
})
