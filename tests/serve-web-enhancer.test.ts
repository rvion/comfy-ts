import { describe, expect, it } from 'bun:test'
import {
   buildRefineBody,
   chatUrl,
   modelsUrl,
   parseModelsReply,
   readStreamDelta,
   splitSseBuffer,
   streamRefine,
   ThinkSplitter,
   type Endpoint,
} from 'src/cli/serve/web/llm.ts'
import { guessPreset, nextPresetName, normalizeSettings } from 'src/cli/serve/web/state/EnhancerSt.ts'
import { normalizeLlmConfig, withProvider } from 'src/cli/serve/llmConfigShape.ts'

/** a fake llm: SSE chunks split at arbitrary boundaries, like a real socket delivers them */
function stubFetch(p: {
   status?: number
   chunks?: string[]
   body?: string
   onRequest?: (init?: RequestInit) => void
}): () => void {
   const real = globalThis.fetch
   const fake: typeof globalThis.fetch = Object.assign(
      (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
         p.onRequest?.(init)
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

const CLOUD: Endpoint = { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', key: 'sk-test' }
const LOCAL: Endpoint = { provider: 'openwebui', baseUrl: 'http://localhost:3000', key: '' }
const REQ = { model: 'x/y', system: 's', user: 'u', effort: 'medium' } as const

describe('provider endpoints', () => {
   it('openrouter and open webui hang their openai-wire api at different paths', () => {
      expect(modelsUrl(CLOUD)).toBe('https://openrouter.ai/api/v1/models')
      expect(chatUrl(CLOUD)).toBe('https://openrouter.ai/api/v1/chat/completions')
      expect(modelsUrl(LOCAL)).toBe('http://localhost:3000/api/models')
      expect(chatUrl(LOCAL)).toBe('http://localhost:3000/api/chat/completions')
   })

   it('a trailing slash or an empty base url cannot produce a broken path', () => {
      expect(chatUrl({ ...LOCAL, baseUrl: 'http://box:8080///' })).toBe('http://box:8080/api/chat/completions')
      expect(chatUrl({ ...LOCAL, baseUrl: '  ' })).toBe('http://localhost:3000/api/chat/completions')
   })

   it('reasoning effort rides openrouter only — a local backend rejects the unknown field', () => {
      expect(buildRefineBody({ ...REQ, provider: 'openrouter' }).reasoning).toEqual({ effort: 'medium' })
      expect(buildRefineBody({ ...REQ, provider: 'openwebui' }).reasoning).toBeUndefined()
      expect(buildRefineBody({ ...REQ, effort: 'off', provider: 'openrouter' }).reasoning).toBeUndefined()
   })

   it('an openai-compatible server (llama.cpp, ollama, vllm) takes a base url that already carries /v1', () => {
      const LLAMA: Endpoint = { provider: 'openai', baseUrl: 'https://box.ts.net:8081/v1/', key: '' }
      expect(modelsUrl(LLAMA)).toBe('https://box.ts.net:8081/v1/models')
      expect(chatUrl(LLAMA)).toBe('https://box.ts.net:8081/v1/chat/completions')
      expect(chatUrl({ ...LLAMA, baseUrl: '' })).toBe('http://localhost:8080/v1/chat/completions')
   })

   it('thinking on an openai-compatible server rides the chat template switch, never `reasoning`', () => {
      const off = buildRefineBody({ ...REQ, effort: 'off', provider: 'openai' })
      expect(off.chat_template_kwargs).toEqual({ enable_thinking: false })
      expect(off.reasoning).toBeUndefined()
      expect(buildRefineBody({ ...REQ, provider: 'openai' }).chat_template_kwargs).toEqual({ enable_thinking: true })
      // open webui and openrouter never get the llama.cpp field
      expect(buildRefineBody({ ...REQ, effort: 'off', provider: 'openwebui' }).chat_template_kwargs).toBeUndefined()
      expect(buildRefineBody({ ...REQ, effort: 'off', provider: 'openrouter' }).chat_template_kwargs).toBeUndefined()
   })
})

describe('model list parsing (an external api drifts: shape-check, never trust)', () => {
   it('capability is unknown (null) when the provider reports no supported_parameters', () => {
      const cloud = parseModelsReply({
         data: [
            { id: 'z/thinker', name: 'Z Thinker', supported_parameters: ['reasoning', 'tools'] },
            { id: 'a/plain', supported_parameters: ['tools'] },
         ],
      })
      expect(cloud).toEqual([
         { id: 'a/plain', name: 'a/plain', reasoning: false },
         { id: 'z/thinker', name: 'Z Thinker', reasoning: true },
      ])
      // open webui's shape: no capabilities at all → null, so the thinking-only filter keeps them
      expect(parseModelsReply({ data: [{ id: 'qwen3:8b', name: 'qwen3' }] })).toEqual([
         { id: 'qwen3:8b', name: 'qwen3', reasoning: null },
      ])
   })

   it('junk entries drop and a body of the wrong shape yields an empty list, never a throw', () => {
      expect(parseModelsReply({ data: [{ name: 'no id' }, 'not an object'] })).toEqual([])
      expect(parseModelsReply(null)).toEqual([])
      expect(parseModelsReply({ data: 'nope' })).toEqual([])
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

   it('deltas split content from reasoning (both spellings), junk payloads are silent', () => {
      expect(readStreamDelta(JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }))).toEqual({
         content: 'hi',
         reasoning: '',
      })
      expect(readStreamDelta(JSON.stringify({ choices: [{ delta: { reasoning_content: 'hmm' } }] }))).toEqual({
         content: '',
         reasoning: 'hmm',
      })
      expect(readStreamDelta('[DONE]')).toBeNull()
      expect(readStreamDelta('{not json')).toBeNull()
   })

   it('an error frame throws instead of ending as an empty rewrite', () => {
      expect(() => readStreamDelta(JSON.stringify({ error: { message: 'rate limited' } }))).toThrow('rate limited')
   })
})

describe('ThinkSplitter (local models stream <think> inline in content)', () => {
   it('routes a think block to reasoning and keeps the rest as the prompt', () => {
      const s = new ThinkSplitter()
      expect(s.feed('<think>weighing it</think>a cursed blob')).toEqual({
         content: 'a cursed blob',
         reasoning: 'weighing it',
      })
   })

   it('a tag split across chunks is never leaked into the prompt', () => {
      const s = new ThinkSplitter()
      const a = s.feed('<thi')
      const b = s.feed('nk>hmm</thin')
      const c = s.feed('k>final text')
      expect(a.content + b.content + c.content).toBe('final text')
      expect(a.reasoning + b.reasoning + c.reasoning).toBe('hmm')
   })

   it('a stream that never closes its think tag keeps the text as reasoning, not as a prompt', () => {
      const s = new ThinkSplitter()
      const a = s.feed('<think>still thinking')
      const f = s.flush()
      expect(a.content + f.content).toBe('')
      expect(a.reasoning).toBe('still thinking')
   })

   it('a lone < that is not a tag survives to the prompt', () => {
      const s = new ThinkSplitter()
      const a = s.feed('a < b')
      expect(a.content + s.flush().content).toBe('a < b')
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
            endpoint: CLOUD,
            signal: new AbortController().signal,
            onDelta: (d) => seen.push(`${d.reasoning}|${d.content}`),
         })
         expect(total).toEqual({ content: 'cursed blob', reasoning: 'thinking' })
         expect(seen).toEqual(['thinking|', '|cursed ', '|blob'])
      } finally {
         restore()
      }
   })

   it('a local model thinking inline lands in the thinking pane, never in the prompt', async () => {
      const restore = stubFetch({
         chunks: [
            'data: {"choices":[{"delta":{"content":"<think>ok so"}}]}\n',
            'data: {"choices":[{"delta":{"content":" tentacles</think>a neon blob"}}]}\ndata: [DONE]\n',
         ],
      })
      try {
         const total = await streamRefine({
            ...REQ,
            endpoint: LOCAL,
            signal: new AbortController().signal,
            onDelta: () => {},
         })
         expect(total.content).toBe('a neon blob')
         expect(total.reasoning).toBe('ok so tentacles')
      } finally {
         restore()
      }
   })

   it('open webui without a key sends no Authorization header, openrouter always does', async () => {
      const seen: (RequestInit | undefined)[] = []
      const restore = stubFetch({
         chunks: ['data: {"choices":[{"delta":{"content":"x"}}]}\n'],
         onRequest: (i) => seen.push(i),
      })
      try {
         await streamRefine({ ...REQ, endpoint: LOCAL, signal: new AbortController().signal, onDelta: () => {} })
         expect(Object.keys(seen[0]?.headers ?? {})).not.toContain('Authorization')
      } finally {
         restore()
      }
   })

   it('an http failure names the status and the body head, never a silent empty rewrite', async () => {
      const restore = stubFetch({ status: 401, body: 'No auth credentials found' })
      try {
         await expect(
            streamRefine({ ...REQ, endpoint: CLOUD, signal: new AbortController().signal, onDelta: () => {} }),
         ).rejects.toThrow(/401 No auth credentials found/)
      } finally {
         restore()
      }
   })

   it('a stream that carries only reasoning is a failure, not an empty prompt applied over yours', async () => {
      const restore = stubFetch({ chunks: ['data: {"choices":[{"delta":{"reasoning":"hm"}}]}\ndata: [DONE]\n'] })
      try {
         await expect(
            streamRefine({ ...REQ, endpoint: LOCAL, signal: new AbortController().signal, onDelta: () => {} }),
         ).rejects.toThrow('returned no prompt text')
      } finally {
         restore()
      }
   })

   it('a missing openrouter key fails before any request goes out', async () => {
      await expect(
         streamRefine({
            ...REQ,
            endpoint: { ...CLOUD, key: '  ' },
            signal: new AbortController().signal,
            onDelta: () => {},
         }),
      ).rejects.toThrow('no openrouter api key')
   })
})

describe('enhancer settings blob (keys and selection only: the configs are files)', () => {
   it('an empty or garbage blob yields empty selections and no keys', () => {
      expect(normalizeSettings({})).toEqual({ keyByProvider: {}, configName: '', presetName: '', presetByModule: {} })
      expect(normalizeSettings('garbage').configName).toBe('')
   })

   it('keys stay per provider, junk values drop', () => {
      const s = normalizeSettings({ keyByProvider: { openrouter: 'sk-or', bogus: 7 }, configName: 'wm-9b' })
      expect(s.keyByProvider).toEqual({ openrouter: 'sk-or' })
      expect(s.configName).toBe('wm-9b')
   })

   it('preset names never collide: the name IS the filename', () => {
      expect(nextPresetName('refine-krea2-prompt', [])).toBe('refine-krea2-prompt')
      expect(nextPresetName('a', ['a'])).toBe('a 2')
      expect(nextPresetName('a', ['a', 'a 2'])).toBe('a 3')
   })
})

describe('llm config shape (a hand-editable file)', () => {
   it('an empty or garbage file yields the cloud defaults', () => {
      expect(normalizeLlmConfig({})).toEqual({
         provider: 'openrouter',
         baseUrl: 'https://openrouter.ai/api/v1',
         model: 'anthropic/claude-sonnet-5',
         effort: 'medium',
         thinkingOnly: true,
      })
      expect(normalizeLlmConfig('garbage').provider).toBe('openrouter')
      expect(normalizeLlmConfig([1]).provider).toBe('openrouter')
   })

   it('a local config round-trips, a bad field degrades alone', () => {
      const c = normalizeLlmConfig({
         provider: 'openai',
         baseUrl: ' https://box:8081/v1 ',
         model: 'qwen.gguf',
         effort: 'nonsense',
         thinkingOnly: false,
      })
      expect(c).toEqual({
         provider: 'openai',
         baseUrl: 'https://box:8081/v1',
         model: 'qwen.gguf',
         effort: 'medium',
         thinkingOnly: false,
      })
      expect(normalizeLlmConfig({ provider: 'openai', baseUrl: '' }).baseUrl).toBe('http://localhost:8080/v1')
   })

   it('switching provider resets the base url and the model, never crosses them', () => {
      const local = normalizeLlmConfig({ provider: 'openai', baseUrl: 'https://box/v1', model: 'q.gguf' })
      const cloud = withProvider(local, 'openrouter')
      expect(cloud.baseUrl).toBe('https://openrouter.ai/api/v1')
      expect(cloud.model).toBe('anthropic/claude-sonnet-5')
      expect(withProvider(local, 'openai')).toBe(local)
   })
})

describe('the master prompt a workflow opens on', () => {
   const names = ['basic-generic', 'refine-anima-prompt', 'refine-krea2-prompt-basic', 'refine-krea2-prompt']
   it('the one whose name shares a word with the module, the full one before a variant', () => {
      expect(guessPreset('10-anima-t2i', names)).toBe('refine-anima-prompt')
      expect(guessPreset('04-krea2-turbo-t2i', names)).toBe('refine-krea2-prompt')
   })

   it('none when no name shares a word: numbers and short words never count', () => {
      expect(guessPreset('08-qwen-image-21-t2i', names)).toBeNull()
      expect(guessPreset('01-txt2img', [])).toBeNull()
   })
})
