// .comfy-ts/hosts/<id>/host.json: the address `comfy-ts gen` saves, so code names a host by id
// alone. It holds the url only: an api key is never written to disk by comfy-ts.
import { join } from 'pathe'
import type { ComfyStorage } from 'src/storage/ComfyStorage.ts'

export type HostFile = { url: string }

export const HOST_FILE_NAME = 'host.json'

/** true when the caller gave no address at all: the id alone asks for the saved one */
export function namesNoAddress(p: { url?: string; host?: string; port?: number; https?: boolean }): boolean {
   return p.url == null && p.host == null && p.port == null && p.https == null
}

export function hostFilePath(hostFolder: string): string {
   return join(hostFolder, HOST_FILE_NAME)
}

export function writeHostFile(storage: ComfyStorage, hostFolder: string, file: HostFile): string {
   const path = hostFilePath(hostFolder)
   storage.writeText(path, `${JSON.stringify(file, null, 3)}\n`)
   return path
}

/** the saved url for `id`; throws with the command that writes it when there is none */
export function readHostFile(storage: ComfyStorage, hostFolder: string, id: string): string {
   const path = hostFilePath(hostFolder)
   const text = storage.readTextIfExists(path)
   if (text == null) {
      const fix =
         storage.kind === 'node'
            ? `run \`comfy-ts gen --host <url> --id ${id}\` once from this project (it saves the address), or pass the address: host({ id: '${id}', url: '<url>' })`
            : `this runtime has no saved hosts (${storage.kind} storage): pass the address, host({ id: '${id}', url: '<url>' })`
      throw new Error(`host '${id}': no address given and no ${path}. ${fix}`)
   }
   let json: unknown
   try {
      json = JSON.parse(text)
   } catch {
      throw new Error(
         `host '${id}': ${path} is not valid json. Write it again with \`comfy-ts gen --host <url> --id ${id}\``,
      )
   }
   const url = json != null && typeof json === 'object' && 'url' in json ? json.url : null
   if (typeof url !== 'string' || url === '')
      throw new Error(
         `host '${id}': ${path} has no "url" string. Write it again with \`comfy-ts gen --host <url> --id ${id}\``,
      )
   return url
}
