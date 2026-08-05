import { describe, expect, it } from 'bun:test'
import {
   buildRefineBody,
   parseModelsReply,
   readStreamDelta,
   splitSseBuffer,
   streamRefine,
} from 'src/cli/serve/web/openrouter.ts'
import { defaultPresets, nextPresetName, normalizeSettings } from 'src/cli/serve/web/state/EnhancerSt.ts'

/** a fake openrouter: SSE chunks split at arbitrary boundaries, like a real socket delivers them */
function stubFetch(p: { status?: number; chunks?: string[]; body?: string }): () => void {
   const real = globalThis.fetch
   const fake: typeof globalThis.fetch = Object.assign(
      (): Promise<Response> => {
         if (p.status != null && p.status !== 200) {
            return Promise.resolve(new Response(p.body ?? '', { status: p.status }))
         }
         const stream = new ReadableStream<Uint8Array>({
            start(controller) {
               for (const c of p.chunks ?? []) controller.enqueue(new TextEncoder().encode(c))
               controller.close()
            },
         })
         return Promise.resolve(new Response(stream, { status: 200 }))
      },
      { preconnect: real.preconnect },
   )
   globalThis.fetch = fake
   return () => {
      globalThis.fetch = real
   }
}

const REQ = { key: 'sk-test', model: 'x/y', system: 's', user: 'u', effort: 'off' } as const

describe('openrouter reply parsing (an external api drifts: shape-check, never trust)', () => {
   it('models: reasoning support comes from supported_parameters, junk entries drop', () => {
      const models = parseModelsReply({
         data: [
            { id: 'z/thinker', name: 'Z Thinker', supported_parameters: ['reasoning', 'tools'] },
            { id: 'a/plain', supported_parameters: ['tools'] },
            { name: 'no id at all' },
            'not an object',
         ],
      })
      expect(models).toEqual([
         { id: 'a/plain', name: 'a/plain', reasoning: false },
         { id: 'z/thinker', name: 'Z Thinker', reasoning: true },
      ])
   })

   it('models: a body that is not the expected shape yields an empty list instead of throwing', () => {
      expect(parseModelsReply(null)).toEqual([])
      expect(parseModelsReply({ data: 'nope' })).toEqual([])
   })

   it('effort off omits the reasoning field, any other effort sends it', () => {
      const base = { model: 'x/y', system: 's', user: 'u' } as const
      expect(buildRefineBody({ ...base, effort: 'off' }).reasoning).toBeUndefined()
      expect(buildRefineBody({ ...base, effort: 'high' }).reasoning).toEqual({ effort: 'high' })
      expect(buildRefineBody({ ...base, effort: 'off' }).messages).toEqual([
         { role: 'system', content: 's' },
         { role: 'user', content: 'u' },
      ])
   })
})

describe('sse framing', () => {
   it('a partial trailing line is held back until the next chunk completes it', () => {
      const first = splitSseBuffer('data: {"a":1}\ndata: {"b":')
      expect(first.events).toEqual(['{"a":1}'])
      expect(first.rest).toBe('data: {"b":')
      expect(splitSseBuffer(`${first.rest}2}\n`).events).toEqual(['{"b":2}'])
   })

   it('keep-alive comments and blank lines are not events', () => {
      expect(splitSseBuffer(': OPENROUTER PROCESSING\n\ndata: [DONE]\n').events).toEqual(['[DONE]'])
   })

   it('deltas split content from reasoning, [DONE] and unparsable payloads are silent', () => {
      expect(readStreamDelta(JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }))).toEqual({
         content: 'hi',
         reasoning: '',
      })
      expect(readStreamDelta(JSON.stringify({ choices: [{ delta: { reasoning: 'hmm' } }] }))).toEqual({
         content: '',
         reasoning: 'hmm',
      })
      expect(readStreamDelta('[DONE]')).toBeNull()
      expect(readStreamDelta('{not json')).toBeNull()
      expect(readStreamDelta(JSON.stringify({ choices: [{ delta: {} }] }))).toBeNull()
   })

   it('an error frame throws instead of ending as an empty rewrite', () => {
      expect(() => readStreamDelta(JSON.stringify({ error: { message: 'rate limited' } }))).toThrow('rate limited')
   })
})

describe('streamRefine', () => {
   it('accumulates content and reasoning across chunk boundaries and reports every delta', async () => {
      const restore = stubFetch({
         chunks: [
            'data: {"choices":[{"delta":{"reasoning":"thinking"}}]}\ndata: {"choices":[{"del',
            'ta":{"content":"cursed "}}]}\n',
            'data: {"choices":[{"delta":{"content":"blob"}}]}\ndata: [DONE]\n',
         ],
      })
      try {
         const seen: string[] = []
         const total = await streamRefine({
            ...REQ,
            signal: new AbortController().signal,
            onDelta: (d) => seen.push(`${d.reasoning}|${d.content}`),
         })
         expect(total).toEqual({ content: 'cursed blob', reasoning: 'thinking' })
         expect(seen).toEqual(['thinking|', '|cursed ', '|blob'])
      } finally {
         restore()
      }
   })

   it('an http failure names the status and the body head, never a silent empty rewrite', async () => {
      const restore = stubFetch({ status: 401, body: 'No auth credentials found' })
      try {
         await expect(
            streamRefine({ ...REQ, signal: new AbortController().signal, onDelta: () => {} }),
         ).rejects.toThrow(/401 No auth credentials found/)
      } finally {
         restore()
      }
   })

   it('a stream that carries only reasoning is a failure, not an empty prompt applied over yours', async () => {
      const restore = stubFetch({ chunks: ['data: {"choices":[{"delta":{"reasoning":"hm"}}]}\ndata: [DONE]\n'] })
      try {
         await expect(
            streamRefine({ ...REQ, signal: new AbortController().signal, onDelta: () => {} }),
         ).rejects.toThrow('returned no text')
      } finally {
         restore()
      }
   })

   it('a missing key fails before any request goes out', async () => {
      await expect(
         streamRefine({ ...REQ, key: '  ', signal: new AbortController().signal, onDelta: () => {} }),
      ).rejects.toThrow('no openrouter api key')
   })
})

describe('enhancer settings blob', () => {
   it('an empty/garbage blob still yields a usable library, the shipped one first', () => {
      const s = normalizeSettings({})
      expect(s.presets[0]?.name).toBe('refine-krea2-prompt')
      expect(s.presetId).toBe('refine-krea2-prompt')
      expect(s.effort).toBe('medium')
      expect(s.thinkingOnly).toBe(true)
      expect(normalizeSettings('garbage').presets).toEqual(defaultPresets())
   })

   it('stored presets win over the shipped ones, and a dangling presetId falls back', () => {
      const s = normalizeSettings({
         presets: [{ id: 'mine', name: 'refine-qwen-prompt', text: 'hello' }, { name: 'no id' }],
         presetId: 'deleted-one',
         model: 'x/y',
         effort: 'nonsense',
         thinkingOnly: false,
      })
      expect(s.presets).toEqual([{ id: 'mine', name: 'refine-qwen-prompt', text: 'hello' }])
      expect(s.presetId).toBe('mine')
      expect(s.model).toBe('x/y')
      expect(s.effort).toBe('medium')
      expect(s.thinkingOnly).toBe(false)
   })

   it('the api key round-trips (browser-only storage is the whole point) and non-string module pins drop', () => {
      const s = normalizeSettings({ apiKey: 'sk-or-v1-abc', presetByModule: { mod: 'mine', other: 7 } })
      expect(s.apiKey).toBe('sk-or-v1-abc')
      expect(s.presetByModule).toEqual({ mod: 'mine' })
   })

   it('preset names never collide: a duplicate gets a numbered suffix', () => {
      expect(nextPresetName('refine-krea2-prompt', [])).toBe('refine-krea2-prompt')
      expect(nextPresetName('a', ['a'])).toBe('a 2')
      expect(nextPresetName('a', ['a', 'a 2'])).toBe('a 3')
   })
})
