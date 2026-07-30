// shared Comfy Cloud host for every cloud example (agent/examples.md owns the
// pattern). NOT a .cflow file, so the TUI never lists it as a workflow.
// import-safe on a keyless machine: nothing here throws — standalone blocks
// call requireCloudKey() first, TUI runs fail with ONE typed 401 per attempt.
import { type ComfyHost, ComfyTS } from 'comfy-ts'

export const CLOUD_KEY_ENV = 'COMFY_CLOUD_API_KEY'

export function cloudApiKey(): string | undefined {
   const key = process.env[CLOUD_KEY_ENV]
   return key == null || key === '' ? undefined : key
}

/** standalone runs call this FIRST: fail fast, name the fix */
export function requireCloudKey(): string {
   const key = cloudApiKey()
   if (key == null)
      throw new Error(
         `[comfy-cloud examples] ${CLOUD_KEY_ENV} is not set — export your Comfy Cloud API key (https://cloud.comfy.org, paid tiers) before running`,
      )
   return key
}

/**
 * THE comfy-cloud host: the registry dedupes by id, so every example importing
 * this helper shares one instance and one ws. Schema comes from the cache
 * (offline import); run() connects lazily. sdkAutoWrite stays false — the
 * catalog home is the COMMITTED examples/comfy-cloud/sdk.d.ts (gen:sdk:cloud),
 * a live connect must never shadow it.
 */
export async function cloudHost(): Promise<ComfyHost<'comfy-cloud'>> {
   const comfy = ComfyTS.create()
   const host = comfy.host({
      id: 'comfy-cloud',
      url: 'https://cloud.comfy.org',
      apiKey: cloudApiKey(),
      sdkAutoWrite: false,
   })
   await host.loadSchemaFromCache()
   return host
}
