// browser → an OpenAI-wire LLM. Two providers: openrouter (cloud) and open webui
// (a local box). The second http module after api.ts, and the only one that leaves
// this origin. Keys are parameters, never module state: they live in localStorage
// (EnhancerSt) and never reach the serve process.
// Parsing is pure and DOM-free so tests/serve-web-enhancer.test.ts covers it.

export type ProviderId = 'openrouter' | 'openwebui'

export type Endpoint = { provider: ProviderId; baseUrl: string; key: string }

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
export const OPENWEBUI_BASE = 'http://localhost:3000'

export function defaultBaseUrl(provider: ProviderId): string {
   return provider === 'openrouter' ? OPENROUTER_BASE : OPENWEBUI_BASE
}

function trimSlash(url: string): string {
   return url.trim().replace(/\/+$/, '')
}

/** open webui hangs its OpenAI-compatible api under /api, openrouter's base already carries /v1 */
export function modelsUrl(e: Endpoint): string {
   const base = trimSlash(e.baseUrl) === '' ? defaultBaseUrl(e.provider) : trimSlash(e.baseUrl)
   return e.provider === 'openrouter' ? `${base}/models` : `${base}/api/models`
}

export function chatUrl(e: Endpoint): string {
   const base = trimSlash(e.baseUrl) === '' ? defaultBaseUrl(e.provider) : trimSlash(e.baseUrl)
   return e.provider === 'openrouter' ? `${base}/chat/completions` : `${base}/api/chat/completions`
}

/** reasoning: true = says so · false = says it cannot · null = the provider does not tell
 * (open webui reports no capabilities, and hiding every local model would be the wrong answer) */
export type LlmModel = { id: string; name: string; reasoning: boolean | null }

export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high'

/** an external api drifts: every field is shape-checked before it is kept (coding.md cast family 10) */
function obj(raw: unknown): Record<string, unknown> {
   return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

function str(raw: unknown): string {
   return typeof raw === 'string' ? raw : ''
}

export function parseModelsReply(raw: unknown): LlmModel[] {
   const data = obj(raw).data
   if (!Array.isArray(data)) return []
   const out: LlmModel[] = []
   for (const entry of data) {
      const m = obj(entry)
      const id = str(m.id)
      if (id === '') continue
      const params = m.supported_parameters
      const reasoning = Array.isArray(params) ? params.includes('reasoning') : null
      out.push({ id, name: str(m.name) === '' ? id : str(m.name), reasoning })
   }
   out.sort((a, b) => a.id.localeCompare(b.id))
   return out
}

async function failure(res: Response, what: string): Promise<Error> {
   // never fail silently, and never let a gateway's html body masquerade as json
   const body = await res.text().catch(() => '')
   return new Error(`llm ${what} failed: http ${res.status} ${body.slice(0, 300)}`)
}

/** a browser fetch that dies on CORS throws a bare TypeError with no detail — say what it
 * probably is, because "Failed to fetch" against a local box is otherwise unactionable */
function transportError(e: unknown, url: string): Error {
   if (e instanceof Error && e.name === 'AbortError') return e
   const msg = e instanceof Error ? e.message : String(e)
   return new Error(
      `could not reach ${url} (${msg}) — is it running, and does it allow this origin? open webui needs CORS_ALLOW_ORIGIN`,
   )
}

export async function fetchModels(e: Endpoint): Promise<LlmModel[]> {
   const url = modelsUrl(e)
   let res: Response
   try {
      res = await fetch(url, { headers: authHeaders(e) })
   } catch (err) {
      throw transportError(err, url)
   }
   if (!res.ok) throw await failure(res, 'model list')
   return parseModelsReply(await res.json())
}

function authHeaders(e: Endpoint): Record<string, string> {
   // open webui on a trusted local box may run without a key: send the header only when there is one
   return e.key.trim() === '' ? {} : { Authorization: `Bearer ${e.key.trim()}` }
}

export type RefineRequest = { model: string; system: string; user: string; effort: ReasoningEffort }

/** the chat body. `reasoning` rides OPENROUTER only: a local backend rejects the unknown field,
 * and its thinking models think on their own (see ThinkSplitter) */
export function buildRefineBody(p: RefineRequest & { provider: ProviderId }): Record<string, unknown> {
   const reasoning = p.provider === 'openrouter' && p.effort !== 'off' ? { reasoning: { effort: p.effort } } : {}
   return {
      model: p.model,
      stream: true,
      messages: [
         { role: 'system', content: p.system },
         { role: 'user', content: p.user },
      ],
      ...reasoning,
   }
}

/** SSE framing: complete lines come out, the trailing partial stays in `rest` for the next chunk */
export function splitSseBuffer(buffer: string): { events: string[]; rest: string } {
   const lines = buffer.split('\n')
   const rest = lines.pop() ?? ''
   const events: string[] = []
   for (const line of lines) {
      const trimmed = line.trim()
      // ": OPENROUTER PROCESSING" keep-alive comments are not events
      if (trimmed === '' || trimmed.startsWith(':')) continue
      if (trimmed.startsWith('data:')) events.push(trimmed.slice(5).trim())
   }
   return { events, rest }
}

export type StreamDelta = { content: string; reasoning: string }

/** one `data:` payload → what it adds. Cloud thinking models put the answer in `content`
 * and their work in `reasoning`; both are streamed, only content is the prompt */
export function readStreamDelta(payload: string): StreamDelta | null {
   if (payload === '' || payload === '[DONE]') return null
   let parsed: unknown
   try {
      parsed = JSON.parse(payload)
   } catch {
      return null
   }
   const root = obj(parsed)
   const err = obj(root.error)
   if (str(err.message) !== '') throw new Error(`llm stream error: ${str(err.message)}`)
   const choices = root.choices
   if (!Array.isArray(choices)) return null
   const delta = obj(obj(choices[0]).delta)
   const content = str(delta.content)
   // some backends spell it reasoning_content
   const reasoning = str(delta.reasoning) === '' ? str(delta.reasoning_content) : str(delta.reasoning)
   if (content === '' && reasoning === '') return null
   return { content, reasoning }
}

/**
 * local thinking models (qwen3, deepseek-r1 through ollama) stream their reasoning INLINE,
 * as `<think>…</think>` at the head of content. Left alone it lands in the prompt, so it is
 * routed to the thinking pane instead. Stateful because a tag can straddle two chunks.
 */
export class ThinkSplitter {
   private inside = false
   /** a partial tag held back until the next chunk decides what it is */
   private pending = ''

   feed(chunk: string): StreamDelta {
      let text = this.pending + chunk
      this.pending = ''
      let content = ''
      let reasoning = ''
      for (;;) {
         const tag = this.inside ? '</think>' : '<think>'
         const at = text.indexOf(tag)
         if (at === -1) break
         const before = text.slice(0, at)
         if (this.inside) reasoning += before
         else content += before
         text = text.slice(at + tag.length)
         this.inside = !this.inside
      }
      // a trailing '<' or '</thin' may be the start of a tag: hold it, do not emit it
      const cut = lastOpenTagStart(text)
      if (cut !== -1) {
         this.pending = text.slice(cut)
         text = text.slice(0, cut)
      }
      if (this.inside) reasoning += text
      else content += text
      return { content, reasoning }
   }

   /** end of stream: whatever was held back was never a tag, so it is real text */
   flush(): StreamDelta {
      const rest = this.pending
      this.pending = ''
      return this.inside ? { content: '', reasoning: rest } : { content: rest, reasoning: '' }
   }
}

/** index of a trailing fragment that could still become `<think>` or `</think>`, else -1 */
function lastOpenTagStart(text: string): number {
   const at = text.lastIndexOf('<')
   if (at === -1) return -1
   const tail = text.slice(at)
   return '<think>'.startsWith(tail) || '</think>'.startsWith(tail) ? at : -1
}

/** streamed refine. onDelta fires per chunk so a slow thinking model shows work, not a spinner */
export async function streamRefine(
   p: RefineRequest & { endpoint: Endpoint; signal: AbortSignal; onDelta: (d: StreamDelta) => void },
): Promise<StreamDelta> {
   if (p.endpoint.provider === 'openrouter' && p.endpoint.key.trim() === '')
      throw new Error('no openrouter api key — paste one in the enhancer settings')
   if (p.model.trim() === '') throw new Error('no model selected')
   const url = chatUrl(p.endpoint)
   let res: Response
   try {
      res = await fetch(url, {
         method: 'POST',
         headers: { ...authHeaders(p.endpoint), 'content-type': 'application/json' },
         body: JSON.stringify(buildRefineBody({ ...p, provider: p.endpoint.provider })),
         signal: p.signal,
      })
   } catch (e) {
      throw transportError(e, url)
   }
   if (!res.ok) throw await failure(res, 'refine')
   const reader = res.body?.getReader()
   if (reader == null) throw new Error('llm refine failed: the response carried no stream')
   const decoder = new TextDecoder()
   const splitter = new ThinkSplitter()
   const total: StreamDelta = { content: '', reasoning: '' }
   const emit = (d: StreamDelta): void => {
      if (d.content === '' && d.reasoning === '') return
      total.content += d.content
      total.reasoning += d.reasoning
      p.onDelta(d)
   }
   let buffer = ''
   for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const split = splitSseBuffer(buffer)
      buffer = split.rest
      for (const event of split.events) {
         const delta = readStreamDelta(event)
         if (delta == null) continue
         // inline <think> is split out of CONTENT; a provider-reported reasoning field rides along
         const parts = splitter.feed(delta.content)
         emit({ content: parts.content, reasoning: parts.reasoning + delta.reasoning })
      }
   }
   emit(splitter.flush())
   if (total.content.trim() === '') throw new Error('the model returned no prompt text — try another model')
   return total
}
