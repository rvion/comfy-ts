// the host protocol (src/cli/serve/web/state/host.ts): a page embedding the panel can only
// learn what the panel says, and can only ask what the panel understands. Both parsers are
// pure, so this is where a malformed message is proven harmless.
import { describe, expect, it } from 'bun:test'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import {
   coerceHostValue,
   isEmbedded,
   parseFromHost,
   readUrlPrompt,
   resolveHostSelection,
} from 'src/cli/serve/web/state/host.ts'

describe('messages from the host', () => {
   it('host-actions keeps well-formed entries and drops the rest', () => {
      expect(
         parseFromHost({
            comfyTs: 'host-actions',
            actions: [
               { id: 'keep', label: 'send to chat', title: 'DM it' },
               { id: '', label: 'x' },
               'junk',
               { id: 'a' },
            ],
         }),
      ).toEqual({ comfyTs: 'host-actions', actions: [{ id: 'keep', label: 'send to chat', title: 'DM it' }] })
   })

   it('set-prompt needs a string', () => {
      expect(parseFromHost({ comfyTs: 'set-prompt', text: 'a fox' })).toEqual({ comfyTs: 'set-prompt', text: 'a fox' })
      expect(parseFromHost({ comfyTs: 'set-prompt', text: 3 })).toBeNull()
   })

   it('anything else on the window is not ours', () => {
      expect(parseFromHost(null)).toBeNull()
      expect(parseFromHost('hello')).toBeNull()
      expect(parseFromHost({ type: 'webpackOk' })).toBeNull()
      expect(parseFromHost({ comfyTs: 'result-action', id: 'x' })).toBeNull()
      expect(parseFromHost({ comfyTs: 'host-actions', actions: 'nope' })).toBeNull()
   })
})

describe('the url prompt', () => {
   it('reads ?prompt=, url-decoded, and nothing when absent or empty', () => {
      expect(readUrlPrompt('?workflow=x&prompt=a%20fox%20in%20the%20snow')).toBe('a fox in the snow')
      expect(readUrlPrompt('?prompt=')).toBeNull()
      expect(readUrlPrompt('')).toBeNull()
      expect(readUrlPrompt('?%%%')).toBeNull()
   })
})

describe('embedding', () => {
   it('headless is not embedded', () => {
      expect(isEmbedded()).toBe(false)
   })
})

describe('procedural control messages', () => {
   it('set-selection needs a non-empty module and a string draft', () => {
      expect(parseFromHost({ comfyTs: 'set-selection', module: 'wf', draft: 'two' })).toEqual({
         comfyTs: 'set-selection',
         module: 'wf',
         draft: 'two',
      })
      expect(parseFromHost({ comfyTs: 'set-selection', module: '', draft: 'two' })).toBeNull()
      expect(parseFromHost({ comfyTs: 'set-selection', module: 'wf' })).toBeNull()
      expect(parseFromHost({ comfyTs: 'set-selection', module: 3, draft: 'x' })).toBeNull()
   })

   it('set-values needs a plain object', () => {
      expect(parseFromHost({ comfyTs: 'set-values', values: { prompt: 'a fox' } })).toEqual({
         comfyTs: 'set-values',
         values: { prompt: 'a fox' },
      })
      expect(parseFromHost({ comfyTs: 'set-values', values: ['a'] })).toBeNull()
      expect(parseFromHost({ comfyTs: 'set-values', values: null })).toBeNull()
      expect(parseFromHost({ comfyTs: 'set-values' })).toBeNull()
   })

   it('get-state carries nothing', () => {
      expect(parseFromHost({ comfyTs: 'get-state', junk: 1 })).toEqual({ comfyTs: 'get-state' })
   })

   it('a state message is outbound only, never parsed as a request', () => {
      expect(parseFromHost({ comfyTs: 'state', module: 'a', draft: 'b', values: {} })).toBeNull()
   })
})

describe('where set-selection lands', () => {
   const MODULES = [
      { module: 'wf', drafts: ['default', 'two'] },
      { module: 'other', drafts: ['default'] },
   ]

   it('a known module and draft is taken as is', () => {
      expect(resolveHostSelection({ want: { module: 'wf', draft: 'two' }, modules: MODULES })).toEqual({
         module: 'wf',
         draft: 'two',
      })
   })

   it('an unknown draft on a known module opens its default', () => {
      expect(resolveHostSelection({ want: { module: 'wf', draft: 'gone' }, modules: MODULES })).toEqual({
         module: 'wf',
         draft: 'default',
      })
   })

   it('an unknown module changes nothing', () => {
      expect(resolveHostSelection({ want: { module: 'nope', draft: 'two' }, modules: MODULES })).toBeNull()
   })
})

describe('a host value goes through the same rules as an edit', () => {
   const d = (kind: VarDescriptor['kind'], extra: Partial<VarDescriptor> = {}): VarDescriptor => ({
      kind,
      payload: '',
      default: null,
      ...extra,
   })

   it('text-like kinds take a string only', () => {
      expect(coerceHostValue(d('prompt'), 'a fox', '')).toEqual({ ok: true, value: 'a fox' })
      expect(coerceHostValue(d('text'), 'x', '')).toEqual({ ok: true, value: 'x' })
      expect(coerceHostValue(d('image'), '/tmp/a.png', '')).toEqual({ ok: true, value: '/tmp/a.png' })
      expect(coerceHostValue(d('prompt'), 3, '')).toEqual({ ok: false })
   })

   it('numbers are finite, an int is truncated like the input box does', () => {
      expect(coerceHostValue(d('int'), 7.9, 1)).toEqual({ ok: true, value: 7 })
      expect(coerceHostValue(d('float'), 0.25, 1)).toEqual({ ok: true, value: 0.25 })
      expect(coerceHostValue(d('int'), Number.NaN, 1)).toEqual({ ok: false })
      expect(coerceHostValue(d('float'), '3', 1)).toEqual({ ok: false })
   })

   it('a seed number keeps the current mode; an object may set the mode', () => {
      const cur = { mode: '+', value: 5 }
      expect(coerceHostValue(d('seed'), 42.8, cur)).toEqual({ ok: true, value: { mode: '+', value: 42 } })
      expect(coerceHostValue(d('seed'), -3, cur)).toEqual({ ok: true, value: { mode: '+', value: 0 } })
      expect(coerceHostValue(d('seed'), { mode: '?' }, cur)).toEqual({ ok: true, value: { mode: '?', value: 5 } })
      expect(coerceHostValue(d('seed'), { mode: '=', value: 9 }, cur)).toEqual({
         ok: true,
         value: { mode: '=', value: 9 },
      })
      expect(coerceHostValue(d('seed'), { mode: 'x' }, cur)).toEqual({ ok: false })
      expect(coerceHostValue(d('seed'), 'nope', cur)).toEqual({ ok: false })
   })

   it('toggle is a boolean, choice is one of its choices', () => {
      expect(coerceHostValue(d('toggle'), true, false)).toEqual({ ok: true, value: true })
      expect(coerceHostValue(d('toggle'), 1, false)).toEqual({ ok: false })
      const choice = d('choice', { choices: ['a', 'b'] })
      expect(coerceHostValue(choice, 'b', 'a')).toEqual({ ok: true, value: 'b' })
      expect(coerceHostValue(choice, 'c', 'a')).toEqual({ ok: false })
   })

   it('size takes {width, height} or "WxH", floored', () => {
      expect(coerceHostValue(d('size'), { width: 832.5, height: 1216 }, null)).toEqual({
         ok: true,
         value: { width: 832, height: 1216 },
      })
      expect(coerceHostValue(d('size'), '768x1344', null)).toEqual({ ok: true, value: { width: 768, height: 1344 } })
      expect(coerceHostValue(d('size'), { width: 0, height: 5 }, null)).toEqual({ ok: false })
      expect(coerceHostValue(d('size'), 'big', null)).toEqual({ ok: false })
   })

   it('loras keep known ON entries with a valid strength, and drop the rest', () => {
      const loras = d('loras', { options: ['a.safetensors', 'b.safetensors', 'c.safetensors'] })
      expect(
         coerceHostValue(
            loras,
            { 'a.safetensors': 0.8, 'b.safetensors': [1, 0.5], 'c.safetensors': false, 'zzz.safetensors': 1 },
            {},
         ),
      ).toEqual({ ok: true, value: { 'a.safetensors': 0.8, 'b.safetensors': [1, 0.5] } })
      expect(coerceHostValue(loras, { 'a.safetensors': 'strong' }, {})).toEqual({ ok: false })
      expect(coerceHostValue(loras, ['a.safetensors'], {})).toEqual({ ok: false })
   })
})
