// one LLM config of the prompt enhancer: where the model runs and how it is asked. PURE (the
// browser bundle and serve both read it), every field runtime-checked, since the file is
// hand-editable. No api key here: keys stay in the browser (architecture item 13)
import { defaultBaseUrl, type ProviderId, type ReasoningEffort } from 'src/cli/serve/web/llm.ts'

export type LlmConfig = {
   provider: ProviderId
   baseUrl: string
   model: string
   effort: ReasoningEffort
   /** hide models that report no reasoning support */
   thinkingOnly: boolean
}

export type LlmConfigEntry = { name: string; config: LlmConfig }

export function isProvider(raw: unknown): raw is ProviderId {
   return raw === 'openrouter' || raw === 'openwebui' || raw === 'openai'
}

export function isEffort(raw: unknown): raw is ReasoningEffort {
   return raw === 'off' || raw === 'low' || raw === 'medium' || raw === 'high'
}

/** explicit model ids, never an alias: behaviour and cost stay reproducible */
const DEFAULT_MODEL: Record<ProviderId, string> = {
   openrouter: 'anthropic/claude-sonnet-5',
   openwebui: '',
   openai: '',
}

/** a stored file → a usable config: a half-written or hand-broken field degrades to its
 * default, never breaks the modal */
export function normalizeLlmConfig(raw: unknown): LlmConfig {
   const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
   const provider = isProvider(o.provider) ? o.provider : 'openrouter'
   return {
      provider,
      baseUrl: typeof o.baseUrl === 'string' && o.baseUrl.trim() !== '' ? o.baseUrl.trim() : defaultBaseUrl(provider),
      model: typeof o.model === 'string' ? o.model : DEFAULT_MODEL[provider],
      effort: isEffort(o.effort) ? o.effort : 'medium',
      thinkingOnly: o.thinkingOnly !== false,
   }
}

/** switching provider resets what belongs to the old one: an openrouter model id sent to a
 * local box, or a local base url sent to openrouter, is never what anyone means */
export function withProvider(c: LlmConfig, provider: ProviderId): LlmConfig {
   if (provider === c.provider) return c
   return { ...c, provider, baseUrl: defaultBaseUrl(provider), model: DEFAULT_MODEL[provider] }
}
