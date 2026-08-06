import { beforeAll, afterAll, describe, expect, it } from 'bun:test'
import { runInAction } from 'mobx'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { describeVar } from 'src/cli/serve/describeVar.ts'
import { v } from 'src/vars/ComfyVars.ts'
import { activePresetLabel, toPresetList } from 'src/vars/presets.ts'

const INSTRUCTIONS = {
   short: 'reply with one sentence',
   long: 'reply with one paragraph of 60 to 150 words',
}

describe('preset lists', () => {
   it('keeps the authored order and matches the live value back to its label', () => {
      const presets = toPresetList(INSTRUCTIONS)
      expect(presets.map((p) => p.label)).toEqual(['short', 'long'])
      expect(activePresetLabel(presets, 'reply with one sentence')).toBe('short')
      // trailing whitespace is not an edit: a textarea adds one newline and the menu would
      // otherwise stop showing which preset the text still is
      expect(activePresetLabel(presets, 'reply with one sentence\n')).toBe('short')
      expect(activePresetLabel(presets, 'something I typed')).toBeNull()
      expect(toPresetList(undefined)).toEqual([])
   })
})

describe('text + prompt vars carry presets', () => {
   it('exposes them on the var and in the descriptor', () => {
      const text = v.text(INSTRUCTIONS.short, { label: 'instruction', multiline: true, presets: INSTRUCTIONS })
      expect(text.presets.map((p) => p.label)).toEqual(['short', 'long'])
      expect(describeVar(text).textPresets).toEqual([
         { label: 'short', text: INSTRUCTIONS.short },
         { label: 'long', text: INSTRUCTIONS.long },
      ])

      const prompt = v.prompt('a cat', { presets: { cat: 'a cat', dog: 'a dog' } })
      expect(describeVar(prompt).textPresets?.map((p) => p.text)).toEqual(['a cat', 'a dog'])
   })

   it('a var without presets carries no key at all', () => {
      expect(describeVar(v.text('hello')).textPresets).toBeUndefined()
      expect(describeVar(v.prompt('hello')).textPresets).toBeUndefined()
   })

   it('a size var keeps its OWN presets field, which is a different shape', () => {
      const size = describeVar(v.size({ width: 1024, height: 1024 }))
      expect(size.textPresets).toBeUndefined()
      expect(size.presets?.[0]).toHaveProperty('width')
   })
})

describe('TUI preset overlay', () => {
   let stP: Promise<import('src/cli/tui/state/TuiSt.ts').TuiSt> | null = null
   let prior: unknown
   beforeAll(() => {
      prior = (globalThis as { comfyts?: unknown }).comfyts
      Reflect.deleteProperty(globalThis, 'comfyts')
   })
   afterAll(async () => {
      if (stP != null) (await stP).dispose()
      if (prior != null) (globalThis as { comfyts?: unknown }).comfyts = prior
      else Reflect.deleteProperty(globalThis, 'comfyts')
   })

   const build = (): Promise<import('src/cli/tui/state/TuiSt.ts').TuiSt> => {
      stP ??= (async () => {
         const { ComfyTS } = await import('src/state.ts')
         const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
         const root = mkdtempSync(join(tmpdir(), 'comfy-ts-presets-'))
         const comfy = new ComfyTS({ rootPath: root })
         const host = comfy.host({ id: 'preset-host', host: '127.0.0.1', port: 65491 })
         const wf = host.defineWorkflow({
            id: 'preset-test',
            vars: {
               instruction: v.text(INSTRUCTIONS.short, { presets: INSTRUCTIONS }),
               plain: v.text('no presets here'),
            },
            build: () => {},
         })
         return new TuiSt(wf)
      })()
      return stP.then((st) => {
         // the harness moves observables the app only moves inside actions
         runInAction(() => {
            st.mode = 'nav'
            st.selIx = 0
            st.picker.filter = ''
         })
         return st
      })
   }

   it('opens on the preset var, lands on the one the value still is, and replaces the text', async () => {
      const st = await build()
      expect(st.picker.presetVar).not.toBeNull()
      st.picker.beginPresets()
      expect(st.mode).toBe('overlay-preset')
      expect(st.picker.ix).toBe(0) // the value IS the 'short' preset
      st.picker.move(1)
      st.picker.commit()
      expect(st.mode).toBe('nav')
      expect(st.entries[0]?.[1].value).toBe(INSTRUCTIONS.long)
   })

   it('the filter searches the label AND the text', async () => {
      const st = await build()
      st.picker.beginPresets()
      st.picker.filterInput('paragraph')
      expect(st.picker.options).toEqual(['long'])
      st.picker.commit()
      expect(st.entries[0]?.[1].value).toBe(INSTRUCTIONS.long)
   })

   it('a text var with no presets never opens the overlay', async () => {
      const st = await build()
      runInAction(() => (st.selIx = 1))
      expect(st.picker.presetVar).toBeNull()
      st.picker.beginPresets()
      expect(st.mode).toBe('nav')
   })
})
