import { describe, expect, it } from 'bun:test'
import type { ModuleDescription } from 'src/cli/serve/web/api.ts'
import { FormSt } from 'src/cli/serve/web/state/FormSt.ts'

const MOD: ModuleDescription = {
   module: 'wf',
   file: '/x/wf.cflow.ts',
   host: 'h',
   drafts: ['default'],
   vars: {
      prompt: { kind: 'prompt', payload: '', default: '', keywordsFrom: 'loras' },
      loras: {
         kind: 'loras',
         payload: '',
         default: {},
         options: ['a', 'b', 'c'],
         optionKeywords: { a: 'kw-a', b: 'kw-b', c: 'kw-c' },
         optionLabels: { a: 'Lora A' },
      },
   },
}

describe('trigger words shown above the prompt', () => {
   it('a paused lora adds none of its words, like the graph', () => {
      // why we think it is actually a bug, and not just meaning spec should change: the graph
      // skips a paused lora, so showing its words above the prompt announces text that is not sent
      const form = new FormSt('wf', 'default', MOD, {
         loras: { a: [1, 1], b: { strength: [0.8, 0.8], off: true }, c: false },
      })
      const prompt = form.vars.find((v) => v.name === 'prompt')
      expect(prompt).toBeDefined()
      if (prompt != null) expect(form.loraKeywordsFor(prompt)).toEqual(['kw-a'])
      form.dispose({ flush: false })
   })

   it('control: an on lora in the palette form still adds its words', () => {
      const form = new FormSt('wf', 'default', MOD, { loras: { b: { strength: [0.8, 0.8], mute: ['unrelated'] } } })
      const prompt = form.vars.find((v) => v.name === 'prompt')
      if (prompt != null) expect(form.loraKeywordsFor(prompt)).toEqual(['kw-b'])
      form.dispose({ flush: false })
   })
})

describe('trigger word groups above the prompt', () => {
   const GROUPED: ModuleDescription = {
      ...MOD,
      vars: {
         ...MOD.vars,
         loras: { ...MOD.vars.loras, optionKeywords: { a: 'flat colors, thick lines', b: 'pastel' } },
      },
   } as ModuleDescription

   it('one group per on lora: its name, then its words split at the commas, each on or off', () => {
      const form = new FormSt('wf', 'default', GROUPED, { loras: { a: { strength: [1, 1], mute: ['thick lines'] } } })
      const prompt = form.vars.find((v) => v.name === 'prompt')
      if (prompt != null)
         expect(form.loraKeywordGroups(prompt)).toEqual([
            {
               lora: 'a',
               label: 'Lora A',
               running: true,
               parts: [
                  { text: 'flat colors', on: true },
                  { text: 'thick lines', on: false },
               ],
            },
         ])
      form.dispose({ flush: false })
   })

   it('clicking a word mutes it on the lora, clicking again brings it back, strengths untouched', () => {
      const form = new FormSt('wf', 'default', GROUPED, { loras: { a: [0.7, 0.7] } })
      const prompt = form.vars.find((v) => v.name === 'prompt')
      const loras = form.vars.find((v) => v.name === 'loras')
      if (prompt == null || loras == null) throw new Error('vars missing')
      form.toggleKeywordPart(prompt, 'a', 'thick lines')
      expect(loras.value).toEqual({ a: { strength: [0.7, 0.7], mute: ['thick lines'] } })
      expect(form.loraKeywordsFor(prompt)).toEqual(['flat colors'])
      form.toggleKeywordPart(prompt, 'a', 'thick lines')
      expect(loras.value).toEqual({ a: [0.7, 0.7] })
      form.dispose({ flush: false })
   })
})

describe('a lora that stops running keeps its line', () => {
   const LANED: ModuleDescription = {
      ...MOD,
      vars: {
         ...MOD.vars,
         loras: { ...MOD.vars.loras, optionKeywords: { a: 'flat colors, thick lines', b: 'pastel' } },
      },
   } as ModuleDescription

   it('a lane switched off keeps its loras words on screen, marked not running, and sends none', () => {
      // why we think it is actually a bug, and not just meaning spec should change: switching a
      // lane off removed its lines above the prompt and shifted the whole form under the pointer
      const form = new FormSt('wf', 'default', LANED, {
         loras: {
            lanes: [
               { name: 'on', active: true, loras: { b: 1 } },
               { name: 'off', active: false, loras: { a: [0.5, 0.5] } },
            ],
         },
      })
      const prompt = form.vars.find((v) => v.name === 'prompt')
      if (prompt == null) throw new Error('prompt missing')
      expect(form.loraKeywordGroups(prompt).map((g) => [g.lora, g.running])).toEqual([
         ['a', false],
         ['b', true],
      ])
      expect(form.loraKeywordsFor(prompt)).toEqual(['pastel'])
      form.dispose({ flush: false })
   })

   it('editing the words of a lora in a lane that is off writes into that lane, nowhere else', () => {
      const form = new FormSt('wf', 'default', LANED, {
         loras: { lanes: [{ name: 'off', active: false, loras: { a: [0.5, 0.5] } }] },
      })
      const prompt = form.vars.find((v) => v.name === 'prompt')
      const loras = form.vars.find((v) => v.name === 'loras')
      if (prompt == null || loras == null) throw new Error('vars missing')
      form.toggleKeywordPart(prompt, 'a', 'thick lines')
      expect(loras.value).toEqual({
         lanes: [{ name: 'off', active: false, loras: { a: { strength: [0.5, 0.5], mute: ['thick lines'] } } }],
      })
      form.dispose({ flush: false })
   })
})
