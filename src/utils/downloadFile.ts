// fetch-based (node:https replaced 2026-07-31, architecture item 13): the
// manager registry chain is in the web graph via ComfyRegistry, so this file
// must stay portable — fetch follows redirects itself, storage owns the write
import { getComfyStorage } from 'src/storage/ComfyStorage.ts'
import type { AbsolutePath } from 'src/types/index.ts'

export async function downloadFile(
   //
   url: string,
   outputPath: AbsolutePath | string,
   logPrefix = '  - ',
): Promise<true> {
   const res = await fetch(url)
   if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`)
   const bytes = new Uint8Array(await res.arrayBuffer())
   getComfyStorage().writeBytes(outputPath, bytes)
   console.log(`${logPrefix}${(bytes.length / 1024).toFixed(0)}kB (DONE)`)
   return true
}
