import { existsSync, readFileSync } from 'node:fs'
import { join } from 'pathe'
import pkgJson from '../package.json' with { type: 'json' }
import { ComfyHost, type ComfyHostData } from 'src/host/ComfyHost.ts'
import { parseHostBase, renderHttpBase } from 'src/host/hostUrl.ts'
import { ComfyRegistry } from 'src/manager/ComfyRegistry.ts'
import { type AbsolutePath, asAbsolutePath, type RelativePath } from 'src/types/index.ts'

/** the ONE settings-file location rule — run-tui reads it BEFORE any module
 * import creates the comfyts global, so the path logic cannot live on the instance only */
export function settingsPathFor(root: string): AbsolutePath {
   return asAbsolutePath(join(root, '.comfy-ts', 'settings.json'))
}

/** singleton */
export class ComfyTS {
   version = pkgJson.version

   constructor(p: { rootPath?: string } = {}) {
      // global registration: the rest of the lib resolves paths through `comfyts`
      const globalHack = globalThis as { comfyts?: ComfyTS }
      if (globalHack.comfyts != null) throw new Error('ComfyTS instance already created')
      globalHack.comfyts = this
      if (p.rootPath) this.rootPath = asAbsolutePath(p.rootPath)
      this.baseFolder = asAbsolutePath(join(this.rootPath, '.comfy-ts'))
      this.hostsFolder = asAbsolutePath(join(this.baseFolder, 'hosts'))
      this.outputPath = asAbsolutePath(join(this.baseFolder, 'outputs'))
   }

   /**
    * multi-module entrypoint: returns the existing global instance or creates
    * it. Workflow modules MUST use this (the TUI imports many of them into one
    * process); `new ComfyTS()` still throws on a second instance.
    */
   static create(p: { rootPath?: string } = {}): ComfyTS {
      const globalHack = globalThis as { comfyts?: ComfyTS }
      const existing = globalHack.comfyts
      if (existing == null) return new ComfyTS(p)
      if (p.rootPath != null && asAbsolutePath(p.rootPath) !== existing.rootPath)
         throw new Error(
            `ComfyTS.create({rootPath: '${p.rootPath}'}) conflicts with the existing instance rooted at '${existing.rootPath}'`,
         )
      return existing
   }

   /** every host created through host(), keyed by id — one instance (and one ws) per id */
   hosts: Map<string, ComfyHost> = new Map()

   host<const ID extends string>(data: ComfyHostData & { id: ID }): ComfyHost<ID> {
      const existing = this.hosts.get(data.id)
      if (existing != null) {
         // identity = the parsed base quad + apiKey PRESENCE (equivalent url and
         // host/port spellings unify; the key VALUE never appears in the error)
         const incoming = parseHostBase(data)
         const cur = existing.base
         const sameBase =
            cur.scheme === incoming.scheme &&
            cur.host === incoming.host &&
            cur.port === incoming.port &&
            cur.basePath === incoming.basePath
         const sameAuth = (existing.data.apiKey == null) === (data.apiKey == null)
         if (!sameBase || !sameAuth)
            throw new Error(
               `host id '${data.id}' already registered at ${renderHttpBase(cur)}${existing.data.apiKey != null ? ' (authed)' : ''} — refusing ${renderHttpBase(incoming)}${data.apiKey != null ? ' (authed)' : ''}`,
            )
         // cast: whitelist item 7 (agent/coding.md) — id equality checked just above
         return existing as ComfyHost<ID>
      }
      const created = new ComfyHost(data)
      this.hosts.set(data.id, created)
      return created
   }

   /**
    * A ComfyRegistry instance that provides access to all
    * known Comfy nodes, models, plugins, ...
    * lazy: constructing it parses ~3MB of ComfyUI-Manager JSON, only pay when used
    */
   private _registry: ComfyRegistry | null = null
   get registry(): ComfyRegistry {
      if (this._registry == null) this._registry = new ComfyRegistry({ check: false, genTypes: false })
      return this._registry
   }

   /** root path used to resolve things */
   rootPath: AbsolutePath = asAbsolutePath(process.cwd())

   /**
    * every repo using comfy-ts gets ONE `.comfy-ts/` folder:
    *    .comfy-ts/hosts/<id>/{object_info.json, embeddings.json, sdk.d.ts}
    *    .comfy-ts/outputs/...   generated images & workflows
    *    .comfy-ts/drafts/<workflow-id>/<draft>.json   TUI var snapshots (local, gitignored)
    */
   baseFolder: AbsolutePath
   hostsFolder: AbsolutePath
   outputPath: AbsolutePath

   resolveFromDrafts(relativePath: string): AbsolutePath {
      return asAbsolutePath(join(this.baseFolder, 'drafts', relativePath))
   }

   resolveFromCache(relativePath: string): AbsolutePath {
      return asAbsolutePath(join(this.baseFolder, 'cache', relativePath))
   }

   /** local TUI settings (preview mode, last draft per workflow) — gitignored */
   get settingsPath(): AbsolutePath {
      return settingsPathFor(this.rootPath)
   }

   resolveFromHosts(relativePath: string): AbsolutePath {
      return asAbsolutePath(join(this.hostsFolder, relativePath))
   }

   /**
    * Resolves a relative path against an absolute path.
    * @param from - The absolute path to resolve from.
    * @param relativePath - The relative path to resolve.
    * @returns The resolved absolute path.
    */
   resolve(from: AbsolutePath, relativePath: RelativePath): AbsolutePath {
      return asAbsolutePath(join(from, relativePath))
   }
   resolveFromOutput(relativePath: string): AbsolutePath {
      return asAbsolutePath(join(this.outputPath, relativePath))
   }

   readJSON_ = <T>(absPath: AbsolutePath, def?: T): T => {
      const exists = existsSync(absPath)
      if (!exists) {
         if (def != null) return def
         throw new Error(`file does not exist ${absPath}`)
      }
      const str = readFileSync(absPath, 'utf8')
      const json = JSON.parse(str)
      return json
   }

   // for automatic formating of produced ComfyUI workflow
   autolayoutOpts: {
      node_hsep: number
      node_vsep: number
      forceLeft: boolean
   } = {
      node_hsep: 50,
      node_vsep: 50,
      forceLeft: false,
   }
}

declare global {
   var comfyts: ComfyTS
}
