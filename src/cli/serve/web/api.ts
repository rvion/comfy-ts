// typed fetch layer over the serve json api — the ONLY web-ui module that talks http
import type { LlmConfigEntry } from 'src/cli/serve/llmConfigShape.ts'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'

export type ModuleDescription = {
   module: string
   file: string
   host: string
   drafts: string[]
   vars: Record<string, VarDescriptor>
   /** names of the workflow's live previews (POST /preview/<module>) */
   previews?: string[]
   /** search tags: what the graph outputs (image, audio, video, text), llm, edit, then free tags */
   tags?: string[]
}

export type IndexPayload = {
   workflows: ModuleDescription[]
   loadErrors?: Record<string, string>
}

export type GeneratedImage = { filename: string; url: string | null; absPath: string | null }

/** a STRING output (PreviewAny). An llm graph produces these and no images at all */
export type GeneratedText = { nodeKey: string | null; text: string }

/** an audio file (SaveAudio*, PreviewAudio): the panel plays it in an <audio> player */
export type GeneratedAudio = { filename: string; mime: string; url: string | null; absPath: string | null }

export type GenerateOk = {
   ok: true
   module: string
   draft: string
   promptId: string
   durationMs: number
   seeds: Record<string, number>
   images: GeneratedImage[]
   texts?: GeneratedText[]
   audios?: GeneratedAudio[]
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
   const res = await fetch(url, init)
   const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
   if (!res.ok || body == null) throw new Error(body?.error ?? `http ${res.status} on ${url}`)
   return body
}

export function fetchIndex(): Promise<IndexPayload> {
   return jsonFetch('/drafts')
}

export function fetchDraftValues(p: { module: string; draft: string }): Promise<{ values: Record<string, unknown> }> {
   return jsonFetch(`/drafts/${encodeURIComponent(p.module)}/${encodeURIComponent(p.draft)}`)
}

export function postGenerate(p: {
   module: string
   draft: string
   payload: Record<string, unknown>
}): Promise<GenerateOk> {
   return jsonFetch(`/generate/${encodeURIComponent(p.module)}/${encodeURIComponent(p.draft)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p.payload),
   })
}

/** the workflow's previews for these values: nothing runs, nothing is written */
export function fetchPreviews(p: {
   module: string
   values: Record<string, unknown>
   signal?: AbortSignal
}): Promise<{ previews: Record<string, string> }> {
   return jsonFetch(`/preview/${encodeURIComponent(p.module)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p.values),
      signal: p.signal,
   })
}

export function saveDraft(
   p: { module: string; draft: string; values: Record<string, unknown> },
   opts: { keepalive?: boolean } = {},
): Promise<{ ok: true; drafts: string[] }> {
   return jsonFetch(`/drafts/${encodeURIComponent(p.module)}/${encodeURIComponent(p.draft)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p.values),
      // keepalive survives page teardown — the beforeunload flush rides it
      keepalive: opts.keepalive === true,
   })
}

export function deleteDraft(p: { module: string; draft: string }): Promise<{ ok: true; drafts: string[] }> {
   return jsonFetch(`/drafts/${encodeURIComponent(p.module)}/${encodeURIComponent(p.draft)}`, { method: 'DELETE' })
}

export type RunStatus = {
   running: boolean
   status: string
   percent: number | null
   /** the executing node and its OWN counter: generated tokens on a text node, sampler steps
    * on a KSampler. The only live signal a text graph has */
   node?: string | null
   nodeProgress?: { value: number; max: number } | null
   /** a node's live display text while it runs — a streaming generator's partial answer */
   progressText?: string | null
   hasPreview: boolean
   previewSeq: number | null
}

export function fetchRunStatus(p: { module: string }): Promise<RunStatus> {
   return jsonFetch(`/run/${encodeURIComponent(p.module)}`)
}

export function runPreviewSrc(p: { module: string; tick: number }): string {
   // tick busts the browser cache: same url, new latent every poll
   return `/run/${encodeURIComponent(p.module)}/preview?t=${p.tick}`
}

export type LoraInfo = {
   name: string
   displayName: string
   triggerWords: string[]
   /** false when the lora manager mirror has never heard of this file */
   known?: boolean
   baseModel?: string | null
   folder?: string | null
   filePath?: string | null
   fileSize?: number | null
   tags?: string[]
   notes?: string
   civitaiUrl?: string | null
   civitaiVersion?: string | null
}

export function fetchLoraInfo(p: { host: string; name: string }): Promise<LoraInfo> {
   return jsonFetch(`/lora-info/${encodeURIComponent(p.host)}/${encodeURIComponent(p.name)}`)
}

/** the live half of a lora's story: civitai's description and the example images the
 * extension keeps. Separate from fetchLoraInfo because this one talks to the host */
export type LoraAbout = {
   known: boolean
   description: string | null
   examples: string[]
   examplesReason: string | null
}

export function fetchLoraAbout(p: { host: string; name: string }): Promise<LoraAbout> {
   return jsonFetch(`/lora-about/${encodeURIComponent(p.host)}/${encodeURIComponent(p.name)}`)
}

export function loraPreviewSrc(p: { host: string; name: string }): string {
   return `/lora-preview/${encodeURIComponent(p.host)}/${encodeURIComponent(p.name)}`
}

/** server-side settings the panel can flip (they apply to every client, curl included).
 * effectivePrefix is derived server-side: the stored folder, or the module key by default */
export type ServeSettings = {
   saveToDisk: boolean
   hostOverride: Record<string, string>
   savePrefix: Record<string, string>
   effectivePrefix: Record<string, string>
}

export function fetchSettings(): Promise<ServeSettings> {
   return jsonFetch('/settings')
}

export function saveSettings(p: { saveToDisk?: boolean; savePrefix?: Record<string, string> }): Promise<ServeSettings> {
   return jsonFetch('/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
   })
}

/** every host the serve process knows, and where each module currently runs */
export type HostsPayload = {
   hosts: { id: string; url: string; httpUrl: string; modules: string[] }[]
   defaults: Record<string, string>
   overrides: Record<string, string>
}

export function fetchHosts(): Promise<HostsPayload> {
   return jsonFetch('/hosts')
}

export type HostAction = 'interrupt' | 'clear-queue' | 'restart' | 'refresh-loras' | 'refresh-schema'

export function pingHost(p: { host: string }): Promise<{ up: boolean }> {
   return jsonFetch(`/hosts/${encodeURIComponent(p.host)}/ping`)
}

export function postHostAction(p: { host: string; action: HostAction }): Promise<{ ok: true; note: string }> {
   return jsonFetch(`/hosts/${encodeURIComponent(p.host)}/${p.action}`, { method: 'POST' })
}

export type HostDrift = { host: string; checked: boolean; changed: boolean; summary: string }

export function fetchHostDrift(p: { host: string; full: boolean }): Promise<HostDrift> {
   return jsonFetch(`/hosts/${encodeURIComponent(p.host)}/drift${p.full ? '?full=1' : ''}`)
}

export function postLoraCivitai(p: { host: string; lora: string }): Promise<{ ok: true; note: string }> {
   return jsonFetch(`/hosts/${encodeURIComponent(p.host)}/lora-civitai/${encodeURIComponent(p.lora)}`, {
      method: 'POST',
   })
}

export function fetchHostLogs(p: { host: string }): Promise<{ lines: string[] }> {
   return jsonFetch(`/hosts/${encodeURIComponent(p.host)}/logs`)
}

export function setModuleHost(p: { module: string; host: string | null }): Promise<{
   ok: true
   module: string
   host: string
   overrides: Record<string, string>
}> {
   return jsonFetch(`/hosts/${encodeURIComponent(p.module)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: p.host }),
   })
}

/** master prompts of the enhancer, files under `.comfy-ts/prompt-enhancers/` (server-owned) */
export type PromptEnhancer = { name: string; text: string }

export function fetchPromptEnhancers(): Promise<{ enhancers: PromptEnhancer[] }> {
   return jsonFetch('/prompt-enhancers')
}

export function savePromptEnhancer(p: PromptEnhancer): Promise<{ ok: true; enhancers: PromptEnhancer[] }> {
   return jsonFetch(`/prompt-enhancers/${encodeURIComponent(p.name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: p.text }),
   })
}

export function deletePromptEnhancer(p: { name: string }): Promise<{ ok: true; enhancers: PromptEnhancer[] }> {
   return jsonFetch(`/prompt-enhancers/${encodeURIComponent(p.name)}`, { method: 'DELETE' })
}

/** the enhancer's LLM configs, files under `.comfy-ts/llm-configs/` (server-owned) */
export function fetchLlmConfigs(): Promise<{ configs: LlmConfigEntry[] }> {
   return jsonFetch('/llm-configs')
}

export function saveLlmConfig(p: LlmConfigEntry): Promise<{ ok: true; configs: LlmConfigEntry[] }> {
   return jsonFetch(`/llm-configs/${encodeURIComponent(p.name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p.config),
   })
}

export function deleteLlmConfig(p: { name: string }): Promise<{ ok: true; configs: LlmConfigEntry[] }> {
   return jsonFetch(`/llm-configs/${encodeURIComponent(p.name)}`, { method: 'DELETE' })
}

export async function uploadFile(p: { file: File }): Promise<{ path: string; url: string | null }> {
   const bytes = new Uint8Array(await p.file.arrayBuffer())
   let bin = ''
   for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
   return jsonFetch('/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: p.file.name, dataBase64: btoa(bin) }),
   })
}

export type TagHit = { name: string; category: number | null; count: number; alias?: string }

/** completion hits from the tag list a prompt var declares; a missing list throws its reason */
export function fetchTags(p: {
   module: string
   varName: string
   q: string
   limit?: number
   signal?: AbortSignal
}): Promise<{ hits: TagHit[] }> {
   const q = new URLSearchParams({ q: p.q, limit: String(p.limit ?? 20) })
   return jsonFetch(`/tags/${encodeURIComponent(p.module)}/${encodeURIComponent(p.varName)}?${q}`, { signal: p.signal })
}
