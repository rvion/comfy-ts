// typed fetch layer over the serve json api — the ONLY web-ui module that talks http
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'

export type ModuleDescription = {
   module: string
   file: string
   host: string
   drafts: string[]
   vars: Record<string, VarDescriptor>
}

export type IndexPayload = {
   workflows: ModuleDescription[]
   loadErrors?: Record<string, string>
}

export type GeneratedImage = { filename: string; url: string | null; absPath: string | null }

export type GenerateOk = {
   ok: true
   module: string
   draft: string
   promptId: string
   durationMs: number
   seeds: Record<string, number>
   images: GeneratedImage[]
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

export type LoraInfo = { name: string; displayName: string; triggerWords: string[] }

export function fetchLoraInfo(p: { host: string; name: string }): Promise<LoraInfo> {
   return jsonFetch(`/lora-info/${encodeURIComponent(p.host)}/${encodeURIComponent(p.name)}`)
}

export function loraPreviewSrc(p: { host: string; name: string }): string {
   return `/lora-preview/${encodeURIComponent(p.host)}/${encodeURIComponent(p.name)}`
}

/** server-side settings the panel can flip (saving is one switch for every client) */
export type ServeSettings = { saveToDisk: boolean }

export function fetchSettings(): Promise<ServeSettings> {
   return jsonFetch('/settings')
}

export function saveSettings(p: ServeSettings): Promise<ServeSettings> {
   return jsonFetch('/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
   })
}

/** every host the serve process knows, and where each module currently runs */
export type HostsPayload = {
   hosts: { id: string; url: string; modules: string[] }[]
   defaults: Record<string, string>
   overrides: Record<string, string>
}

export function fetchHosts(): Promise<HostsPayload> {
   return jsonFetch('/hosts')
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
