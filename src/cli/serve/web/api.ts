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
