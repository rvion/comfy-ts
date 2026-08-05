// browser → openrouter. The second http module after api.ts, and the ONLY one
// that leaves this machine. The key is a parameter on every call: it lives in
// localStorage (EnhancerSt) and never reaches the serve process or the disk.
// Parsing is pure and DOM-free so tests/serve-web-enhancer.test.ts covers it.

const BASE = 'https://openrouter.ai/api/v1'

export type OpenRouterModel = { id: string; name: string; reasoning: boolean }

export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high'

/** an external api drifts: every field is shape-checked before it is kept (coding.md cast family 10) */
function obj(raw: unknown): Record<string, unknown> {
   return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

function str(raw: unknown): string {
   return typeof raw === 'string' ? raw : ''
}

/** `supported_parameters` carrying "reasoning" is what makes a model a THINKING model here */
export function parseModelsReply(raw: unknown): OpenRouterModel[] {
   const data = obj(raw).data
   if (!Array.isArray(data)) return []
   const out: OpenRouterModel[] = []
   for (const entry of data) {
      const m = obj(entry)
      const id = str(m.id)
      if (id === '') continue
      const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : []
      out.push({ id, name: str(m.name) === '' ? id : str(m.name), reasoning: params.includes('reasoning') })
   }
   out.sort((a, b) => a.id.localeCompare(b.id))
   return out
}

async function failure(res: Response, what: string): Promise<Error> {
   // never fail silently, and never let a gateway's html body masquerade as json
   const body = await res.text().catch(() => '')
   return new Error(`openrouter ${what} failed: http ${res.status} ${body.slice(0, 300)}`)
}

export async function fetchModels(p: { key: string }): Promise<OpenRouterModel[]> {
   if (p.key.trim() === '') throw new Error('no openrouter api key — paste one in the enhancer settings')
   const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${p.key.trim()}` } })
   if (!res.ok) throw await failure(res, 'model list')
   return parseModelsReply(await res.json())
}

export type RefineRequest = {
   model: string
   system: string
   user: string
   effort: ReasoningEffort
}

/** the chat body. `reasoning` is OMITTED at effort 'off': a model without thinking support rejects it */
export function buildRefineBody(p: RefineRequest): Record<string, unknown> {
   return {
      model: p.model,
      stream: true,
      messages: [
         { role: 'system', content: p.system },
         { role: 'user', content: p.user },
      ],
      ...(p.effort === 'off' ? {} : { reasoning: { effort: p.effort } }),
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

/** one `data:` payload → what it adds. Thinking models put the visible answer in `content`
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
   if (str(err.message) !== '') throw new Error(`openrouter stream error: ${str(err.message)}`)
   const choices = root.choices
   if (!Array.isArray(choices)) return null
   const delta = obj(obj(choices[0]).delta)
   const content = str(delta.content)
   const reasoning = str(delta.reasoning)
   if (content === '' && reasoning === '') return null
   return { content, reasoning }
}

/** streamed refine. onDelta fires per chunk so a slow thinking model shows work, not a spinner */
export async function streamRefine(
   p: RefineRequest & { key: string; signal: AbortSignal; onDelta: (d: StreamDelta) => void },
): Promise<StreamDelta> {
   if (p.key.trim() === '') throw new Error('no openrouter api key — paste one in the enhancer settings')
   if (p.model.trim() === '') throw new Error('no model selected')
   const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildRefineBody(p)),
      signal: p.signal,
   })
   if (!res.ok) throw await failure(res, 'refine')
   const reader = res.body?.getReader()
   if (reader == null) throw new Error('openrouter refine failed: the response carried no stream')
   const decoder = new TextDecoder()
   const total: StreamDelta = { content: '', reasoning: '' }
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
         total.content += delta.content
         total.reasoning += delta.reasoning
         p.onDelta(delta)
      }
   }
   if (total.content.trim() === '') throw new Error('openrouter refine returned no text — try another model')
   return total
}
