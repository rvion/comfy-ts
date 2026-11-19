// .comfy-ts/hosts/<id>/host.json: the address `comfy-ts gen` saves, so code names a host by id
// alone. It holds the url only: an api key is never written to disk by comfy-ts.
import { join } from 'pathe'
import { type ParsedHostBase, parseHostBase } from 'src/host/hostUrl.ts'
import type { ComfyStorage } from 'src/storage/ComfyStorage.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'

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

/** the saved address of `id`, parsed; when there is none, the error text names the command that writes it */
export function readHostFile(
   storage: ComfyStorage,
   hostFolder: string,
   id: string,
): { base: ParsedHostBase; error: null } | { base: null; error: string } {
   const path = hostFilePath(hostFolder)
   const gen = `\`comfy-ts gen --host <url> --id ${id}\``
   const text = storage.readTextIfExists(path)
   if (text == null) {
      const fix =
         storage.kind === 'node'
            ? `run ${gen} once from this project (it saves the address), or pass the address: host({ id: '${id}', url: '<url>' })`
            : `this runtime has no saved hosts (${storage.kind} storage): pass the address, host({ id: '${id}', url: '<url>' })`
      return { base: null, error: `host '${id}': no address given and no ${path}. ${fix}` }
   }
   let json: unknown
   try {
      json = JSON.parse(text)
   } catch {
      return { base: null, error: `host '${id}': ${path} is not valid json. Write it again with ${gen}` }
   }
   const url = json != null && typeof json === 'object' && 'url' in json ? json.url : null
   if (typeof url !== 'string' || url === '')
      return { base: null, error: `host '${id}': ${path} has no "url" string. Write it again with ${gen}` }
   try {
      return { base: parseHostBase({ id, url }), error: null }
   } catch (e) {
      return { base: null, error: `${extractErrorMessage(e)} (read from ${path})` }
   }
}
