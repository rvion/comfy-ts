import { beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import type { RunSettings } from 'src/runner/ComfyWorkflow.ts'
import { ComfyTS } from 'src/state.ts'

// ONE ComfyTS per process (global singleton) — all offline tests share it
let comfy: ComfyTS
let host: ComfyHost<'test-host'>

beforeAll(() => {
   comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-test-')) })
   host = comfy.host({ id: 'test-host', host: '127.0.0.1', port: 65500 })
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   host.schema.update({ spec, embeddings: [] })
})

describe('offline workflow building', () => {
   it('builds a txt2img graph and emits valid prompt json', () => {
      const wf = host.workflow({ id: 'test' })
      const b = wf.builder
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
      const pos = b.CLIPTextEncode({ clip: ckpt, text: 'a house' })
      const neg = b.CLIPTextEncode({ clip: ckpt, text: 'bad quality' })
      const latent = b.EmptyLatentImage({ width: 512, height: 512, batch_size: 1 })
      const sampled = b.KSampler({
         model: ckpt,
         positive: pos,
         negative: neg,
         latent_image: latent,
         sampler_name: 'euler',
         scheduler: 'normal',
         seed: 42,
         steps: 8,
         cfg: 7,
         denoise: 1,
      })
      const img = b.VAEDecode({ samples: sampled, vae: ckpt })
      b.PreviewImage({ images: img })

      expect(wf.size).toBe(7)

      const prompt = wf.toApiJson('use_stringified_numbers_only')
      const nodes = Object.values(prompt)
      // every node serialized with class_type + inputs
      for (const n of nodes) {
         expect(typeof n.class_type).toBe('string')
         expect(typeof n.inputs).toBe('object')
      }
      // KSampler got its model edge wired to the checkpoint node
      const ks = nodes.find((n) => n.class_type === 'KSampler')
      expect(ks).toBeDefined()
      expect(Array.isArray(ks?.inputs.model)).toBe(true)
      // defaults from the schema fill omitted optionals with defined defaults
      expect(ks?.inputs.seed).toBe(42)
   })

   it('exports a litegraph workflow.json with laid-out nodes', async () => {
      const wf = host.workflow({ id: 'test-export' })
      const b = wf.builder
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
      const latent = b.EmptyLatentImage({ width: 64, height: 64, batch_size: 1 })
      b.VAEDecode({ samples: latent, vae: ckpt })

      const lite = await wf.toWorkflowJson()
      expect(lite.nodes.length).toBe(3)
      expect(lite.links.length).toBeGreaterThan(0)
   })

   it('records a problem instead of crashing on missing required inputs', () => {
      const wf = host.workflow({ id: 'test-problems' })
      wf.builder.CLIPTextEncode({ text: 'no clip provided' })
      expect(wf.problems.length).toBeGreaterThan(0)
   })
})

describe('api.json import', () => {
   it('imports a prompt json into a live workflow', () => {
      const source = host.workflow({ id: 'import-source' })
      const b = source.builder
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
      b.VAEDecode({ samples: b.EmptyLatentImage({ width: 64, height: 64, batch_size: 1 }), vae: ckpt })
      const apiJson = source.toApiJson('use_stringified_numbers_only')

      const imported = host.importApiJson(apiJson, { id: 'import-target' })
      expect(imported.size).toBe(source.size)
      expect(imported.toApiJson('use_stringified_numbers_only')).toEqual(apiJson)
   })
})

describe('workflow.json (litegraph) import', () => {
   it('round-trips: build -> export workflow.json -> import -> same api json', async () => {
      const source = host.workflow({ id: 'lite-source' })
      const b = source.builder
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
      const samples = b.KSampler({
         model: ckpt,
         positive: b.CLIPTextEncode({ clip: ckpt, text: 'hello' }),
         negative: b.CLIPTextEncode({ clip: ckpt, text: 'bye' }),
         latent_image: b.EmptyLatentImage({ width: 64, height: 64, batch_size: 1 }),
         seed: 5,
         steps: 4,
         cfg: 7,
         sampler_name: 'euler',
         scheduler: 'normal',
         denoise: 1,
      })
      b.PreviewImage({ images: b.VAEDecode({ samples, vae: ckpt }) })

      const liteJson = await source.toWorkflowJson()
      const imported = host.importWorkflowJson(liteJson, { id: 'lite-imported' })
      expect(imported.size).toBe(source.size)
      expect(imported.toApiJson('use_stringified_numbers_only')).toEqual(
         source.toApiJson('use_stringified_numbers_only'),
      )
   })
})

describe('tui state tree (headless logic)', () => {
   it('navigates, edits, adjusts vars', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({
         id: 'tui-test',
         vars: {
            prompt: v.text('hello\nworld'),
            steps: v.int(8, { min: 1, max: 40 }),
            on: v.toggle(false),
            ratio: v.choice(['a', 'b'] as const, 'a'),
         },
         build: () => {},
      })
      const st = new TuiSt(wf)
      expect(st.entries.length).toBe(4)

      // toggle via activate (⏎/→ — ←→ stepping is gone, ← focuses the tree)
      st.selIx = 2
      st.activate()
      expect(wf.vars.on.value).toBe(true)
      st.activate()
      expect(wf.vars.on.value).toBe(false)

      // int set() clamps (max 40)
      wf.vars.steps.set(999)
      expect(wf.vars.steps.value).toBe(40)

      // enter on a choice opens the picker overlay
      st.selIx = 3
      st.activate()
      expect(st.mode).toBe('overlay-choice')
      st.picker.move(1)
      st.picker.commit()
      expect(st.mode).toBe('nav')
      expect(wf.vars.ratio.value).toBe('b')

      // inline number editing rejects garbage, stays in edit mode
      st.selIx = 1
      st.editor.beginInline()
      st.editor.buffer = 'garbage'
      st.editor.commitInline()
      expect(st.editor.invalid).toBe(true)
      expect(st.mode).toBe('edit')

      // seed nav keys: +/-/=/? set the mode (number untouched), * rerolls
      const wf2 = host.defineWorkflow({ id: 'tui-seed-test', vars: { seed: v.seed(42) }, build: () => {} })
      const st2 = new TuiSt(wf2)
      expect(st2.navKey('+')).toBe(true)
      expect(wf2.vars.seed.mode).toBe('+')
      expect(wf2.vars.seed.value).toBe(42)
      expect(st2.navKey('?')).toBe(true)
      expect(wf2.vars.seed.mode).toBe('?')
      expect(st2.navKey('*')).toBe(true)
      expect(st2.navKey('0')).toBe(false) // 0 reset is gone — `= 0` via the editor
      st2.dispose()
      st.dispose()
   })
})

describe('tui overlays', () => {
   it('text overlay edits real multiline, pickers filter, loras overlay ticks', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({
         id: 'tui-overlay-test',
         vars: {
            prompt: v.text('line one\nline two'),
            ratio: v.choice(['1:1 (Square)', '2:3 (Portrait)', '16:9 (Widescreen)'] as const, '1:1 (Square)'),
            size: v.size(),
            loras: v.loras(['a.safetensors', 'b.safetensors', 'c.safetensors'], {
               'a.safetensors': 1,
               'c.safetensors': [0.8, 0.6],
            }),
         },
         build: () => {},
      })
      const st = new TuiSt(wf)
      const ed = st.editor

      // ---- text overlay: raw newlines, no escaping ----
      st.selIx = 0
      st.activate()
      expect(st.mode).toBe('overlay-text')
      expect(ed.buffer).toBe('line one\nline two')
      // cursor starts at end; up goes to same col on line one
      ed.cursorUp()
      ed.lineHome()
      ed.input('X')
      ed.newline()
      ed.commitMultiline()
      expect(st.mode).toBe('nav')
      expect(wf.vars.prompt.value).toBe('X\nline one\nline two')
      // pasted multiline stays real newlines in overlay mode
      st.activate()
      ed.input('\r\nend')
      expect(ed.buffer.endsWith('\nend')).toBe(true)
      ed.cancel()
      expect(wf.vars.prompt.value).toBe('X\nline one\nline two')

      // ---- choice overlay: type-to-filter (fuzzy subsequence) ----
      st.selIx = 1
      st.activate()
      expect(st.mode).toBe('overlay-choice')
      expect(st.picker.options.length).toBe(3)
      st.picker.filterInput('wide')
      expect(st.picker.options).toEqual(['16:9 (Widescreen)'])
      for (let i = 0; i < 4; i++) st.picker.filterBackspace()
      // fuzzy: non-contiguous subsequence still matches
      st.picker.filterInput('19wsn')
      expect(st.picker.options).toEqual(['16:9 (Widescreen)'])
      st.picker.commit()
      expect(wf.vars.ratio.value).toBe('16:9 (Widescreen)')

      // ---- size overlay: preset pick, then custom WxH via the filter ----
      st.selIx = 2
      st.activate()
      expect(st.mode).toBe('overlay-size')
      st.picker.filterInput('wide')
      st.picker.commit()
      expect(wf.vars.size.value).toEqual({ width: 1344, height: 768 })
      st.activate()
      st.picker.filterInput('640x480')
      expect(st.picker.options).toEqual([])
      st.picker.commit()
      expect(st.mode).toBe('nav')
      expect(wf.vars.size.value).toEqual({ width: 640, height: 480 })

      // ---- loras overlay: tick/untick + strength stepping + bulk ----
      st.selIx = 3
      st.activate()
      expect(st.mode).toBe('overlay-loras')
      expect(wf.vars.loras.display()).toBe('(2/3) a, c')
      // untick 'a', remembers strength; re-tick restores it
      st.loras.toggle()
      expect(wf.vars.loras.value['a.safetensors']).toBe(false)
      st.loras.toggle()
      expect(wf.vars.loras.value['a.safetensors']).toBe(1)
      // step strength on the tuple entry
      st.loras.move(2)
      st.loras.adjust(0.05)
      expect(wf.vars.loras.value['c.safetensors']).toEqual([0.85, 0.65])
      // filter + bulk: tick everything matching 'b'
      st.loras.filterInput('b')
      st.loras.setAll(true)
      expect(wf.vars.loras.value['b.safetensors']).toBe(true)
      st.loras.filterBackspace()
      st.loras.setAll(false)
      expect(wf.vars.loras.display()).toBe('(0/3) none')
      ed.cancel()
      expect(st.mode).toBe('nav')
      st.dispose()
   })
})

describe('tui drafts', () => {
   it('creates, autosaves (debounced), and reloads named drafts', async () => {
      const { mkdtempSync, readFileSync } = await import('node:fs')
      const { tmpdir } = await import('node:os')
      const { join } = await import('pathe')
      const { asAbsolutePath } = await import('src/types/index.ts')
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')

      // hermetic: point the .comfy-ts base at a temp dir for this test
      const prevBase = comfyts.baseFolder
      comfyts.baseFolder = asAbsolutePath(mkdtempSync(join(tmpdir(), 'comfy-ts-drafts-')))
      try {
         const wf = host.defineWorkflow({
            id: 'drafts-test',
            vars: { prompt: v.text('original'), steps: v.int(8) },
            build: () => {},
         })
         const st = new TuiSt(wf)

         // create draft-1 from current values (row 0 opens the name prompt)
         st.drafts.begin()
         expect(st.mode).toBe('overlay-drafts')
         st.drafts.commit()
         expect(st.mode).toBe('edit')
         expect(st.editor.isCustom).toBe(true)
         st.editor.input('draft-1')
         st.editor.commitInline()
         expect(st.drafts.active).toBe('draft-1')
         const draftPath = join(comfyts.baseFolder, 'drafts', 'drafts-test', 'draft-1.json')
         expect(JSON.parse(readFileSync(draftPath, 'utf8')).prompt).toBe('original')

         // edit a var → autosave kicks in after the 300ms debounce
         wf.vars.prompt.set('edited')
         await new Promise((r) => setTimeout(r, 450))
         expect(JSON.parse(readFileSync(draftPath, 'utf8')).prompt).toBe('edited')

         // drift away, then reload the draft → values restored
         wf.vars.prompt.set('drifted')
         wf.vars.steps.set(20)
         st.drafts.begin()
         expect(st.drafts.list).toEqual(['draft-1'])
         st.drafts.commit()
         expect(wf.vars.prompt.value).toBe('edited')
         expect(wf.vars.steps.value).toBe(8)
         st.dispose()
      } finally {
         comfyts.baseFolder = prevBase
      }
   })
})

describe('ansi image preview', () => {
   it('renders half-block truecolor cells, never protocol escapes', async () => {
      const { default: sharp } = await import('sharp')
      const { imageBufferToAnsi } = await import('src/utils/ansiImage.ts')
      const png = await sharp({
         create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
         .png()
         .toBuffer()
      const out = await imageBufferToAnsi(png, { width: 4, height: 2 })
      expect(out).toContain('▄')
      expect(out).toContain('\x1b[48;2;')
      expect(out.split('\n').length).toBe(2)
      // the whole point: no iTerm/kitty image protocol (ink would destroy it)
      expect(out).not.toContain('\x1b]1337')
   })
})

describe('tui line editor', () => {
   it('cursor insert, word jumps, word delete, kills', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({
         id: 'tui-edit-test',
         vars: { prompt: v.text('hello brave new world') },
         build: () => {},
      })
      const st = new TuiSt(wf)
      const ed = st.editor
      ed.beginInline()
      expect(ed.cursor).toBe(21) // at end

      // word left twice -> before 'new'
      ed.wordLeft()
      ed.wordLeft()
      expect(ed.buffer.slice(ed.cursor)).toBe('new world')

      // insert at cursor
      ed.input('shiny ')
      expect(ed.buffer).toBe('hello brave shiny new world')

      // alt+backspace deletes 'shiny '
      ed.deleteWordBack()
      expect(ed.buffer).toBe('hello brave new world')

      // word right jumps past 'new'
      ed.wordRight()
      expect(ed.buffer.slice(0, ed.cursor)).toBe('hello brave new')

      // line ends + kills
      ed.lineHome()
      expect(ed.cursor).toBe(0)
      ed.wordRight()
      ed.killToStart()
      expect(ed.buffer).toBe(' brave new world')
      ed.lineEnd()
      ed.wordLeft()
      ed.killToEnd()
      expect(ed.buffer).toBe(' brave new ')

      // cursor-position backspace
      ed.lineHome()
      ed.cursorRight()
      ed.backspace()
      expect(ed.buffer).toBe('brave new ')
      ed.commitInline()
      expect(wf.vars.prompt.value).toBe('brave new ')
      st.dispose()
   })
})

describe('tui line editor: escaping + code points', () => {
   it('round-trips literal backslash-n and real newlines', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({
         id: 'tui-escape-test',
         vars: { t: v.text('a\\nb\nc') }, // literal backslash-n AND a real newline
         build: () => {},
      })
      const st = new TuiSt(wf)
      st.editor.beginInline()
      st.editor.commitInline()
      expect(wf.vars.t.value).toBe('a\\nb\nc') // unchanged round-trip
      st.dispose()
   })

   it('pasted multiline text is escaped into the inline buffer', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({ id: 'tui-paste-test', vars: { t: v.text('') }, build: () => {} })
      const st = new TuiSt(wf)
      st.editor.beginInline()
      st.editor.input('line1\r\nline2')
      expect(st.editor.buffer).toBe('line1\\nline2')
      st.editor.commitInline()
      expect(wf.vars.t.value).toBe('line1\nline2')
      st.dispose()
   })

   it('emoji survive cursor editing (code points, not UTF-16 units)', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({ id: 'tui-emoji-test', vars: { t: v.text('a🐑b') }, build: () => {} })
      const st = new TuiSt(wf)
      st.editor.beginInline()
      expect(st.editor.cursor).toBe(3) // a, 🐑, b = 3 code points
      st.editor.cursorLeft() // after 🐑
      st.editor.backspace() // delete the sheep, not half a surrogate
      st.editor.commitInline()
      expect(wf.vars.t.value).toBe('ab')
      st.dispose()
   })
})

describe('seed advance through DefinedWorkflow', () => {
   it("build({advance}) uses this run's seed then steps it; bare build() never advances", async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const seen: number[] = []
      const wf = host.defineWorkflow({
         id: 'seed-adv',
         vars: { seed: v.seed(5), text: v.text('x') },
         build: (b, vars) => {
            seen.push(vars.seed)
            const ck = b.CheckpointLoaderSimple({ ckpt_name: 'x' })
            b.PreviewImage({
               images: b.VAEDecode({
                  samples: b.KSampler({
                     model: ck,
                     positive: b.CLIPTextEncode({ clip: ck, text: vars.text }),
                     negative: b.CLIPTextEncode({ clip: ck, text: '' }),
                     latent_image: b.EmptyLatentImage({ width: 64, height: 64, batch_size: 1 }),
                     seed: vars.seed,
                     steps: 1,
                     cfg: 1,
                     sampler_name: 'euler',
                     scheduler: 'normal',
                     denoise: 1,
                  }),
                  vae: ck,
               }),
            })
         },
      })
      wf.vars.seed.parse('+')
      await wf.build({ advance: true })
      await wf.build({ advance: true })
      await wf.build({ advance: true })
      expect(seen).toEqual([5, 6, 7]) // graph got each run's seed, not the advanced one
      expect(wf.vars.seed.value).toBe(8) // moved to next after the third
      await wf.build() // copy/export path
      expect(wf.vars.seed.value).toBe(8) // unchanged
   })
})

describe('prompt editor line ops', () => {
   it('line home/end, ⌥↑↓ line swap, comment toggle', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({ id: 'ed-lines', vars: { prompt: v.prompt('aaa\nbbb\nccc') }, build: () => {} })
      const st = new TuiSt(wf)
      const ed = st.editor
      ed.beginMultiline() // cursor at buffer end (11)
      ed.lineHome()
      expect(ed.cursor).toBe(8) // start of 'ccc', not buffer start
      ed.lineEnd()
      expect(ed.cursor).toBe(11)

      // pressing again when ALREADY at the bound hops to the neighbour line's bound
      ed.lineEnd()
      expect(ed.cursor).toBe(11) // last line: nowhere to hop
      ed.lineHome()
      expect(ed.cursor).toBe(8)
      ed.lineHome()
      expect(ed.cursor).toBe(4) // start of 'bbb'
      ed.lineHome()
      expect(ed.cursor).toBe(0) // start of 'aaa'
      ed.lineHome()
      expect(ed.cursor).toBe(0) // first line: nowhere to hop
      ed.lineEnd()
      expect(ed.cursor).toBe(3) // end of 'aaa'
      ed.lineEnd()
      expect(ed.cursor).toBe(7) // end of 'bbb'
      ed.lineHome()
      expect(ed.cursor).toBe(4)
      ed.lineEnd()
      ed.lineEnd()
      expect(ed.cursor).toBe(11) // back on 'ccc' for the line-swap block

      ed.moveLine(-1)
      expect(ed.buffer).toBe('aaa\nccc\nbbb')
      expect(ed.cursor).toBe(7) // cursor rode along to end of 'ccc'
      ed.moveLine(-1)
      expect(ed.buffer).toBe('ccc\naaa\nbbb')
      ed.moveLine(-1) // already on top: no-op
      expect(ed.buffer).toBe('ccc\naaa\nbbb')
      ed.moveLine(1)
      expect(ed.buffer).toBe('aaa\nccc\nbbb')
      expect(ed.cursor).toBe(7)

      ed.toggleComment() // cursor on 'ccc'
      expect(ed.buffer).toBe('aaa\n// ccc\nbbb')
      expect(ed.cursor).toBe(10)
      ed.toggleComment()
      expect(ed.buffer).toBe('aaa\nccc\nbbb')
      expect(ed.cursor).toBe(7)
      st.dispose()
   })
})

describe('lora keywords → prompt prefix', () => {
   it('prefixes ACTIVE loras keywords, dedupes, skips empties; empty keyword clears', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { getLoraKeyword, setLoraKeyword } = await import('src/vars/loraKeywords.ts')
      setLoraKeyword('kw/a.safetensors', 'styleA')
      setLoraKeyword('kw/b.safetensors', 'styleB')
      setLoraKeyword('kw/c.safetensors', 'styleA') // same keyword as a → dedupes
      const loras = v.loras(['kw/a.safetensors', 'kw/b.safetensors', 'kw/c.safetensors', 'kw/d.safetensors'], {
         'kw/a.safetensors': 1,
         'kw/c.safetensors': true,
      })
      const prompt = v.prompt('// note to self\na cat\n- blurry', { loraKeywordsFrom: loras })
      expect(prompt.injectedKeywords()).toEqual(['styleA']) // the TUI previews exactly this
      expect(prompt.outValue()).toEqual({ positive: 'styleA, a cat', negative: 'blurry' }) // b inactive, c dedupes, d no keyword
      loras.toggleItem('kw/b.safetensors')
      expect(prompt.outValue().positive).toBe('styleA, styleB, a cat')
      setLoraKeyword('kw/a.safetensors', '') // empty clears the entry
      expect(getLoraKeyword('kw/a.safetensors')).toBe('')
      expect(prompt.outValue().positive).toBe('styleB, styleA, a cat') // c still carries styleA (order follows the lora list)
      // persisted on disk under comfyts.baseFolder
      const saved = JSON.parse(readFileSync(join(comfyts.baseFolder, 'lora-keywords.json'), 'utf8'))
      expect(saved['kw/b.safetensors']).toBe('styleB')
      expect(saved['kw/a.safetensors']).toBeUndefined()
   })
})

describe('vars as a lambda', () => {
   it('receives `v` (no import), resolves once; cross-referencing vars share one scope', async () => {
      const { setLoraKeyword } = await import('src/vars/loraKeywords.ts')
      setLoraKeyword('lam/x.safetensors', 'lambdaKW')
      const wf = host.defineWorkflow({
         id: 'vars-lambda',
         vars: (v) => {
            const loras = v.loras(['lam/x.safetensors', 'lam/y.safetensors'], { 'lam/x.safetensors': 1 })
            return { prompt: v.prompt('a dog', { loraKeywordsFrom: loras }), loras, seed: v.seed(1) }
         },
         build: () => {},
      })
      // resolved ONCE: repeated access returns the SAME instances
      expect(wf.vars.prompt).toBe(wf.vars.prompt)
      expect(wf.entries().length).toBe(3)
      // the inline cross-reference works end to end
      expect(wf.vars.prompt.outValue()).toEqual({ positive: 'lambdaKW, a dog', negative: '' })
      // typed values flow into build()
      const { varValues } = await import('src/vars/ComfyVars.ts')
      expect(varValues(wf.vars).seed).toBe(1)
   })

   it('v.loras(regex) resolves against the host at define time; unbound access is loud', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const lv = v.loras(/krea-?2/i)
      expect(() => lv.names).toThrow() // regex source without a host: throw, never silence
      // structural stub host: bindHost only needs schema.getLoras
      const stubLoras = ['krea2/a.safetensors', 'xl/b.safetensors', 'KREA-2/c.safetensors']
      lv.bindHost({ schema: { getLoras: (re?: RegExp) => stubLoras.filter((n) => re == null || re.test(n)) } })
      expect(lv.names).toEqual(['krea2/a.safetensors', 'KREA-2/c.safetensors'])
      // end to end: defineWorkflow binds automatically (fixture has zero loras)
      const wf = host.defineWorkflow({ id: 'regex-loras', vars: (vv) => ({ loras: vv.loras(/any/) }), build: () => {} })
      expect(wf.vars.loras.names).toEqual([])
      expect(host.schema.getLoras(/x/)).toEqual([])
   })
})

describe('tui queued runs', () => {
   it('drives progress, latents and outputs for EVERY queued run, not just the first', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const { ComfyExecution } = await import('src/runner/ComfyExecution.ts')
      const { PromptID_ark } = await import('src/runner/ComfyWsApi.ts')

      const wf = host.defineWorkflow({ id: 'tui-queue-test', vars: { seed: v.seed(1) }, build: () => {} })
      const st = new TuiSt(wf)

      // fake the send: each run() hands back an execution WE finish, so two can be in flight
      const pending: { finish: () => void; progress: (percent: number) => void }[] = []
      wf.run = (settings: RunSettings = {}): Promise<ComfyExecution> =>
         new Promise((resolve) => {
            const ix = pending.length + 1
            const id = PromptID_ark.assert(`p${ix}`)
            const execution = new ComfyExecution(host.workflow({ id: `q${ix}` }), {
               id,
               executed: true,
               graphID: `q${ix}`,
               status: 'Success',
            })
            pending.push({
               finish: () => resolve(execution),
               progress: (percent) =>
                  settings.onProgress?.({
                     percent,
                     isDone: false,
                     countDone: 0,
                     countTotal: 1,
                     promptId: id,
                     nodeName: 'KSampler',
                     elapsedMs: 1000,
                  }),
            })
         })

      void st.exec.run()
      expect(pending.length).toBe(1)
      expect(st.exec.running).toBe(true)
      expect(host.onLatentPreview).not.toBeNull()

      // 'r' during a run: queued on the server, same machinery
      void st.exec.run()
      expect(pending.length).toBe(2)
      expect(st.exec.inFlight).toBe(2)

      pending[0]?.progress(50)
      expect(st.exec.progress?.promptId).toBe('p1')

      pending[0]?.finish()
      await new Promise((r) => setTimeout(r, 0))
      expect(st.exec.runCount).toBe(1)
      // the queued prompt is still coming: latents must keep flowing, the bar must not stay at run 1
      expect(st.exec.running).toBe(true)
      expect(host.onLatentPreview).not.toBeNull()
      expect(st.exec.progress).toBeNull()

      // the server starts the queued prompt
      pending[1]?.progress(10)
      expect(st.exec.progress?.promptId).toBe('p2')
      pending[1]?.finish()
      await new Promise((r) => setTimeout(r, 0))
      expect(st.exec.runCount).toBe(2)
      expect(st.exec.running).toBe(false)
      expect(host.onLatentPreview).toBeNull()
      st.dispose()
   })
})

describe('tui tree ↔ vars focus round trip', () => {
   it('← lands on the ACTIVE DRAFT row, → on a draft row goes back to the vars panel', async () => {
      const { asAbsolutePath } = await import('src/types/index.ts')
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const { mkdtempSync } = await import('node:fs')
      const { tmpdir } = await import('node:os')
      const { join } = await import('pathe')

      const prevBase = comfyts.baseFolder
      comfyts.baseFolder = asAbsolutePath(mkdtempSync(join(tmpdir(), 'comfy-ts-tree-')))
      try {
         const file = 'examples/tree-focus.cflow.ts'
         const wf = host.defineWorkflow({ id: 'tree-focus', vars: { seed: v.seed(1) }, build: () => {} })
         const st = new TuiSt(wf, { workflowFiles: [file], currentFile: file })
         st.drafts.createNamed('night')
         expect(st.drafts.active).toBe('night')

         // ← from the vars list: the cursor sits where you actually are (the draft), not on the workflow root
         st.tree.focus()
         expect(st.mode).toBe('tree')
         expect(st.tree.selected).toMatchObject({ kind: 'draft', draft: 'night' })

         // → on a draft row: nothing left to unfold, so it continues into the vars panel
         st.tree.unfold()
         expect(st.mode).toBe('nav')

         // → on a workflow row still unfolds (and stays in the tree)
         st.tree.focus()
         st.tree.fold() // draft row → jumps to the parent workflow row, folded
         expect(st.tree.selected).toMatchObject({ kind: 'workflow', file })
         st.tree.unfold()
         expect(st.mode).toBe('tree')
         expect(st.tree.rows.some((r) => r.kind === 'draft' && r.draft === 'night')).toBe(true)
         st.dispose()
      } finally {
         comfyts.baseFolder = prevBase
      }
   })
})

describe('tui settings persistence', () => {
   it('remembers preview mode and the last draft per workflow across TuiSt instances', async () => {
      const { asAbsolutePath } = await import('src/types/index.ts')
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const { mkdtempSync } = await import('node:fs')
      const { tmpdir } = await import('node:os')
      const { join } = await import('pathe')

      const prevBase = comfyts.baseFolder
      comfyts.baseFolder = asAbsolutePath(mkdtempSync(join(tmpdir(), 'comfy-ts-settings-')))
      try {
         const wf = host.defineWorkflow({ id: 'set-test', vars: { seed: v.seed(1) }, build: () => {} })

         const st1 = new TuiSt(wf)
         st1.settings.setPreviewMode('ansi')
         st1.drafts.createNamed('night') // writes night.json AND remembers it active
         expect(st1.drafts.active).toBe('night')
         // force a synchronous settings write (the reaction is debounced)
         const { writeFileSync } = await import('node:fs')
         writeFileSync(
            comfyts.settingsPath,
            JSON.stringify({ previewMode: st1.settings.previewMode, lastDraft: st1.settings.lastDraft }),
         )
         st1.dispose()

         const st2 = new TuiSt(wf)
         expect(st2.settings.previewMode).toBe('ansi')
         // the night draft file exists, so reopening the workflow reopens it
         expect(st2.drafts.active).toBe('night')
         st2.dispose()
      } finally {
         comfyts.baseFolder = prevBase
      }
   })
})
