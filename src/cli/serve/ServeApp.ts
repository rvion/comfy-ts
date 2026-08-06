// `comfy-ts serve` request handling, transport-free: run-serve owns node:http,
// tests call handle() directly with an injected starter. Full contract:
// agent/architecture.md item 12.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { nanoid } from 'nanoid'
import { basename, dirname, extname, join, resolve } from 'pathe'
import { applyVarPayload } from 'src/cli/serve/applyVarPayload.ts'
import { describeVar, type VarDescriptor } from 'src/cli/serve/describeVar.ts'
import { deletePromptEnhancer, listPromptEnhancers, writePromptEnhancer } from 'src/cli/serve/promptEnhancers.ts'
import { managerOnlyLoraOptions } from 'src/cli/serve/managerOnlyLoras.ts'
import { validStoreName } from 'src/cli/serve/safeName.ts'
import { readServeSettings, writeServeSettings, type ServeSettings } from 'src/cli/serve/serveSettings.ts'
import { assembleLogChunks } from 'src/cli/tui/state/LogsSt.ts'
import { draftsDirForFile, listDraftsForFile } from 'src/cli/tui/state/DraftsSt.ts'
import {
   buildLoraMirror,
   getLoraDisplayName,
   getLoraInfo,
   getLoraPreviewUrl,
   getLoraTriggerWords,
   refreshLoraInfoCacheIfChanged,
   reloadLoraInfoCache,
   writeLoraMirror,
} from 'src/host/loraInfoCache.ts'
import {
   fetchLoraDescription,
   fetchLoraExampleImages,
   fetchLoraList,
   fetchLoraPreviewBytes,
   lmBaseModel,
   lmCivitai,
   lmFilePath,
   lmFileSize,
   lmSha256,
   lmFolder,
   lmNotes,
   lmTags,
   loraKey,
   loraPreviewMapFrom,
} from 'src/host/loraManagerApi.ts'
import { getLoraKeyword } from 'src/vars/loraKeywords.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { ImageVar, LorasVar, PromptVar, SeedVar } from 'src/vars/ComfyVars.ts'
import type { DefinedWorkflow } from 'src/vars/DefinedWorkflow.ts'
import { bang } from 'src/utils/bang.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'

export type ServeModule = { key: string; file: string; dw: DefinedWorkflow }

/** structural face of ComfyExecution — tests inject a fake starter.
 * absPath is null for in-memory images (a ws-saver run with saving off) */
export type ServeExecution = {
   done: Promise<unknown>
   status: string
   /** buffer is the ONLY copy for an in-memory image (saving off); reading it on a
    * SAVED image would hit the disk, so it is only touched when absPath is null */
   images: { absPath: string | null; filename: string; buffer?: Uint8Array }[]
   data: { id: string; error?: unknown }
   /** live global progress (ComfyExecution has it; fakes may omit) — the /run/<module> poll reads it */
   progressGlobal?: { percent: number }
}

export type ServeStarter = (
   mod: ServeModule,
   opts: { saveToDisk: boolean; savePrefix: string; host?: ComfyHost },
) => Promise<ServeExecution>

export type ServeRequest = { method: string; url: string; accept?: string; body?: string }
export type ServeReply = {
   status: number
   contentType: string
   body: string | Uint8Array
   /** extra response headers, lowercase keys — the transport writes them verbatim */
   headers?: Record<string, string>
}

/** the panel is REBUILT per serve process, so a cached copy is always the wrong one. With no
 * cache header at all a browser applies heuristic freshness and reuses app.js across reloads,
 * which makes every fix look like it never landed */
const NO_STORE = { 'cache-control': 'no-store, must-revalidate' }

/** connect + fresh graph from current var values + send; done is awaited OUTSIDE the module mutex.
 * serve OPTS INTO local saving (library default is memory-only, architecture.md
 * item 14): the /outputs/ routes serve files, grouped per module */
const realStarter: ServeStarter = async (mod, opts) => {
   // the override substitutes the host the graph is BUILT against too (DefinedWorkflow.build's
   // own rule): a node missing there must surface as a workflow problem, not a silent run
   const host = opts.host ?? mod.dw.host
   await host.connect()
   const wf = await mod.dw.build({ advance: true, host })
   // saving is a SETTING now (GET/PUT /settings): off keeps outputs in memory and the
   // reply points at /images/<promptId>/<ix> instead of a file url
   return await wf.start({ save: opts.saveToDisk ? { prefix: opts.savePrefix } : false })
}

const CONTENT_TYPES: Record<string, string> = {
   '.png': 'image/png',
   '.jpg': 'image/jpeg',
   '.jpeg': 'image/jpeg',
   '.webp': 'image/webp',
   '.gif': 'image/gif',
   '.mp4': 'video/mp4',
   '.webm': 'video/webm',
   '.json': 'application/json',
   '.txt': 'text/plain',
}

/** magic-byte sniff for the preview proxy — fetchLoraPreviewBytes already guarantees an image */
function sniffImageContentType(bytes: Uint8Array): string {
   if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
   if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
   if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
   if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp' // RIFF container
   return 'application/octet-stream'
}

function json(status: number, payload: unknown): ServeReply {
   return { status, contentType: 'application/json', body: JSON.stringify(payload, null, 2) }
}

const USAGE = [
   'GET  / in a browser — web control panel (every var as a form control)',
   'GET  /drafts — every served workflow, its drafts and var descriptors',
   'GET  /drafts/<module>/<draft> — one draft with its stored values',
   'POST /generate/<module>/<draft> with { ...vars } — run, blocking',
   'POST /generate/<draft> — unqualified, when unambiguous',
   'PUT  /drafts/<module>/<draft> with { ...vars } — save (or duplicate to a new name) a draft',
   'DELETE /drafts/<module>/<draft> — delete that draft file',
   'GET  /run/<module> — live run status · /run/<module>/preview — latent preview bytes',
   'POST /upload with {"name","dataBase64"} — store a browser file for an image var',
   'GET  /lora-info/<hostId>/<lora> — display name + trigger words (local mirror)',
   'GET  /lora-preview/<hostId>/<lora> — preview image bytes',
   'GET  /lora-about/<hostId>/<lora> — civitai description + example images (live from the extension)',
   'GET  /prompt-enhancers — the web ui master prompts (.comfy-ts/prompt-enhancers/*.md)',
   'PUT  /prompt-enhancers/<name> with {"text"} — write one · DELETE /prompt-enhancers/<name> — remove it',
   'GET  /settings — { saveToDisk } · PUT /settings with {"saveToDisk"} — write outputs to disk, or keep them in memory',
   'GET  /hosts — every host this process knows · PUT /hosts/<module> with {"host"} — run that workflow elsewhere',
   'POST /hosts/<hostId>/<interrupt|clear-queue|restart|refresh-loras|refresh-schema> — act on a ComfyUI host',
   'GET  /hosts/<hostId>/ping — is that host answering right now (restart watch)',
   'GET  /hosts/<hostId>/logs — the last lines of that host console',
   'GET  /images/<promptId>/<ix> — an in-memory output (saving off), while the process lives',
   'GET  /outputs/<path> — generated files',
]

/** the html shell; the app itself is ONE bundle at /web/app.js */
const WEB_SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>comfy-ts serve</title>
<style>html{background:#101217;color:#e8eaf0}</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="/web/app.js"></script>
</body>
</html>
`

export class ServeApp {
   private starter: ServeStarter
   /** last SERVED seed per `module/draft/var` — '+'/'-' modes continue from it.
    * draftBase remembers which DRAFT value the continuation grew from: when the
    * draft's seed changes (the web form autosaves a typed value), the typed
    * value wins and the continuation restarts there */
   private seedState = new Map<string, { last: number; draftBase: number }>()
   /** per-module promise chain: vars are shared mutable state, apply→send is exclusive */
   private chains = new Map<string, Promise<unknown>>()
   /** the bundle is built at most once per process, first browser hit pays it */
   private webJsCache: Promise<string | null> | null = null
   /** saving + host overrides are live settings (the web ui flips them). LAZY: a ServeApp can
    * be constructed before a comfyts instance is registered, and reading the file then would
    * throw at construction time */
   private settingsCache: ServeSettings | null = null
   private get settings(): ServeSettings {
      this.settingsCache ??= readServeSettings()
      return this.settingsCache
   }
   private set settings(next: ServeSettings) {
      this.settingsCache = next
   }
   /** in-memory outputs of runs made with saving OFF: the ONLY copy, so the gallery has
    * something to show. Capped and FIFO — a long session must not grow without bound */
   private memoryImages = new Map<string, { bytes: Uint8Array; contentType: string }>()

   constructor(
      public modules: ServeModule[],
      private opts: {
         starter?: ServeStarter
         outputRoot?: string
         loadErrors?: Record<string, string>
         /** web ui bundle provider (run-serve wires loadOrBuildWebJs); absent = api only */
         webJs?: () => Promise<string | null>
      } = {},
   ) {
      this.starter = opts.starter ?? realStarter
   }

   private get outputRoot(): string {
      return this.opts.outputRoot ?? comfyts.outputPath
   }

   // #region routing ----------------------------------------------------------
   async handle(req: ServeRequest): Promise<ServeReply> {
      try {
         const path = (req.url.split('?')[0] ?? '/').split('#')[0] ?? '/'
         let segs: string[]
         try {
            segs = path
               .split('/')
               .filter((s) => s !== '')
               .map(decodeURIComponent)
         } catch {
            return json(400, { error: `bad url encoding: ${path}` })
         }
         if (req.method === 'GET') {
            // a browser lands on the control panel; every other client keeps the json index.
            // the bundle resolves BEFORE the shell ships: a shell whose /web/app.js 404s is
            // a blank dark page, the json index is a usable answer
            if (segs.length === 0 && this.opts.webJs != null && req.accept?.includes('text/html') === true) {
               this.webJsCache ??= this.opts.webJs()
               if ((await this.webJsCache) != null)
                  return { status: 200, contentType: 'text/html; charset=utf-8', body: WEB_SHELL, headers: NO_STORE }
            }
            if (segs.length === 0 || (segs[0] === 'drafts' && segs.length === 1)) return this.replyIndex()
            if (segs[0] === 'web' && segs[1] === 'app.js' && segs.length === 2) return await this.replyWebJs()
            if (segs[0] === 'drafts' && segs.length === 3 && segs[1] != null && segs[2] != null)
               return this.replyDraft(segs[1], segs[2])
            if (segs[0] === 'run' && segs.length === 2 && segs[1] != null) return this.replyRunStatus(segs[1])
            if (segs[0] === 'run' && segs.length === 3 && segs[1] != null && segs[2] === 'preview')
               return this.replyRunPreview(segs[1])
            if (segs[0] === 'lora-info' && segs.length === 3 && segs[1] != null && segs[2] != null)
               return this.replyLoraInfo(segs[1], segs[2])
            if (segs[0] === 'lora-preview' && segs.length === 3 && segs[1] != null && segs[2] != null)
               return await this.replyLoraPreview(segs[1], segs[2])
            if (segs[0] === 'lora-about' && segs.length === 3 && segs[1] != null && segs[2] != null)
               return await this.replyLoraAbout(segs[1], segs[2])
            if (segs[0] === 'prompt-enhancers' && segs.length === 1) return this.replyPromptEnhancers()
            if (segs[0] === 'settings' && segs.length === 1) return this.replySettings()
            if (segs[0] === 'hosts' && segs.length === 1) return this.replyHosts()
            if (segs[0] === 'hosts' && segs.length === 3 && segs[1] != null && segs[2] === 'logs')
               return await this.replyHostLogs(segs[1])
            if (segs[0] === 'hosts' && segs.length === 3 && segs[1] != null && segs[2] === 'ping')
               return await this.replyHostPing(segs[1])
            if (segs[0] === 'images' && segs.length === 3 && segs[1] != null && segs[2] != null)
               return this.replyMemoryImage(`${segs[1]}/${segs[2]}`)
            if (segs[0] === 'outputs') return this.replyOutput(segs.slice(1))
            return json(404, { error: `no route: GET ${path}`, usage: USAGE })
         }
         if (req.method === 'POST' && segs[0] === 'generate') {
            const target = this.resolveDraft(segs.slice(1))
            if ('error' in target) return json(target.status, { error: target.error })
            return await this.generate(target.mod, target.draft, req)
         }
         if (req.method === 'POST' && segs[0] === 'upload' && segs.length === 1) return this.replyUpload(req)
         if (req.method === 'PUT' && segs[0] === 'drafts' && segs.length === 3 && segs[1] != null && segs[2] != null)
            return await this.replySaveDraft(segs[1], segs[2], req)
         if (req.method === 'DELETE' && segs[0] === 'drafts' && segs.length === 3 && segs[1] != null && segs[2] != null)
            return await this.replyDeleteDraft(segs[1], segs[2])
         if (req.method === 'PUT' && segs[0] === 'settings' && segs.length === 1) return this.replySaveSettings(req)
         if (req.method === 'PUT' && segs[0] === 'hosts' && segs.length === 2 && segs[1] != null)
            return this.replySetHost(segs[1], req)
         if (req.method === 'POST' && segs[0] === 'hosts' && segs.length === 3 && segs[1] != null && segs[2] != null)
            return await this.replyHostAction(segs[1], segs[2])
         if (req.method === 'PUT' && segs[0] === 'prompt-enhancers' && segs.length === 2 && segs[1] != null)
            return this.replySavePromptEnhancer(segs[1], req)
         if (req.method === 'DELETE' && segs[0] === 'prompt-enhancers' && segs.length === 2 && segs[1] != null)
            return this.replyDeletePromptEnhancer(segs[1])
         return json(404, { error: `no route: ${req.method} ${path}`, usage: USAGE })
      } catch (e) {
         console.error('[serve] request crashed:', e)
         return json(500, { error: extractErrorMessage(e) })
      }
   }

   moduleByKey(key: string): ServeModule | null {
      return this.modules.find((m) => m.key === key) ?? null
   }

   /** 'default' always exists (spec defaults); files under .comfy-ts/drafts/<module>/ add the rest */
   draftsFor(mod: ServeModule): string[] {
      const onDisk = listDraftsForFile(mod.file)
      return ['default', ...onDisk.filter((n) => n !== 'default')]
   }

   /** THE draft-name gate, shared by every route that turns a url segment into a path
    * (safeName.ts owns the rule — the prompt-enhancer routes call the same function) */
   private validDraftName(raw: string): string | null {
      return validStoreName(raw)
   }

   /** absolute path of a draft file, or null when the name is not one we accept */
   private draftPath(mod: ServeModule, draft: string): string | null {
      const name = this.validDraftName(draft)
      return name == null ? null : join(draftsDirForFile(mod.file), `${name}.json`)
   }

   private draftExists(mod: ServeModule, draft: string): boolean {
      const path = this.draftPath(mod, draft)
      if (path == null) return false
      return draft === 'default' || existsSync(path)
   }

   private resolveDraft(segs: string[]): { mod: ServeModule; draft: string } | { error: string; status: number } {
      if (segs.length === 2 && segs[0] != null && segs[1] != null) {
         const mod = this.moduleByKey(segs[0])
         if (mod == null)
            return {
               status: 404,
               error: `unknown module '${segs[0]}' — modules: ${this.modules.map((m) => m.key).join(', ')}`,
            }
         if (!this.draftExists(mod, segs[1]))
            return {
               status: 404,
               error: `module '${mod.key}' has no draft '${segs[1]}' — drafts: ${this.draftsFor(mod).join(', ')}`,
            }
         return { mod, draft: segs[1] }
      }
      if (segs.length === 1 && segs[0] != null) {
         const draft = segs[0]
         if (this.modules.length === 1 && this.modules[0] != null) {
            const mod = this.modules[0]
            if (!this.draftExists(mod, draft))
               return {
                  status: 404,
                  error: `no draft '${draft}' — drafts: ${this.draftsFor(mod).join(', ')}`,
               }
            return { mod, draft }
         }
         const hits = this.modules.filter((m) => this.draftExists(m, draft))
         if (hits.length === 1 && hits[0] != null) return { mod: hits[0], draft }
         if (hits.length === 0) return { status: 404, error: `no module has a draft '${draft}'` }
         return {
            status: 400,
            error: `draft '${draft}' is ambiguous — use: ${hits.map((m) => `/generate/${m.key}/${draft}`).join(' or ')}`,
         }
      }
      return { status: 400, error: 'use POST /generate/<module>/<draft> or /generate/<draft>' }
   }

   // #region introspection ----------------------------------------------------
   private describeModule(mod: ServeModule): Record<string, unknown> {
      refreshLoraInfoCacheIfChanged()
      const hostId = mod.dw.host.data.id
      const vars: Record<string, VarDescriptor> = {}
      for (const [name, varDef] of mod.dw.entries()) {
         const desc = describeVar(varDef)
         // the raw enum values stay the payload keys; the mirror's names are for humans
         if (desc.kind === 'loras' && desc.options != null) {
            const labels: Record<string, string> = {}
            for (const option of desc.options) {
               const label = getLoraDisplayName(option, hostId)
               if (label !== option) labels[option] = label
            }
            if (Object.keys(labels).length > 0) desc.optionLabels = labels
            // the UNION: a lora the manager mirror knows but ComfyUI's enum does not. It is on
            // disk, so it usually runs — the picker offers it, flagged, rather than hiding it
            // compare on the NORMALIZED key: an enum value keeps its case, extension and
            // windows separators, so `krea2\\x.safetensors` and the mirror's `krea2/x` are the
            // same lora. Comparing raw strings marked 200 of 281 loras as new
            // the workflow's OWN narrowing applies to the mirror too: a var declared
            // `v.loras(/krea-?2/i)` got the whole catalog back through the union, because the
            // filter was treated as a property of the enum rather than the var's contract
            const extras = managerOnlyLoraOptions({
               hostId,
               options: desc.options,
               filter: (varDef as LorasVar<string>).optionsFilter,
            })
            if (extras.length > 0) {
               desc.managerOnlyOptions = extras
               desc.options = [...desc.options, ...extras]
               for (const extra of extras) {
                  const label = getLoraDisplayName(extra, hostId)
                  if (label !== extra) (desc.optionLabels ??= {})[extra] = label
               }
            }
            // what a prompt with loraKeywordsFrom will PREPEND, per option: the panel shows
            // the injection instead of leaving you to discover it in the generated image
            const keywords: Record<string, string> = {}
            for (const option of desc.options) {
               const kw = getLoraKeyword(option, hostId)
               if (kw !== '') keywords[option] = kw
            }
            if (Object.keys(keywords).length > 0) desc.optionKeywords = keywords
         }
         vars[name] = desc
      }
      // a prompt knows its lora SOURCE by identity only; naming it needs both vars, which is
      // exactly what this loop has. Without it the panel cannot preview the keyword prefix
      for (const [name, varDef] of mod.dw.entries()) {
         if (varDef.kind !== 'prompt') continue
         const source = (varDef as PromptVar).promptOpts.loraKeywordsFrom
         if (source == null) continue
         // identity across two unrelated faces (AnyVar vs ActiveLoraSource): compare as unknown,
         // the LorasVar instance IS both
         const sourceName = mod.dw.entries().find(([, other]) => (other as unknown) === (source as unknown))?.[0]
         const desc = vars[name]
         if (sourceName != null && desc != null) desc.keywordsFrom = sourceName
      }
      return {
         module: mod.key,
         file: mod.file,
         host: mod.dw.host.data.id,
         drafts: this.draftsFor(mod),
         routes: this.draftsFor(mod).map(
            (d) => `POST /generate/${encodeURIComponent(mod.key)}/${encodeURIComponent(d)}`,
         ),
         vars,
      }
   }

   private replyIndex(): ServeReply {
      return json(200, {
         server: 'comfy-ts serve',
         usage: USAGE,
         workflows: this.modules.map((m) => this.describeModule(m)),
         ...(this.opts.loadErrors != null && Object.keys(this.opts.loadErrors).length > 0
            ? { loadErrors: this.opts.loadErrors }
            : {}),
      })
   }

   private replyDraft(modKey: string, draft: string): ServeReply {
      const mod = this.moduleByKey(modKey)
      if (mod == null) return json(404, { error: `unknown module '${modKey}'` })
      if (!this.draftExists(mod, draft))
         return json(404, {
            error: `module '${modKey}' has no draft '${draft}' — drafts: ${this.draftsFor(mod).join(', ')}`,
         })
      return json(200, { ...this.describeModule(mod), draft, values: this.draftValues(mod, draft) })
   }

   /** stored values (toJSON shapes); 'default' without a file falls back to descriptor defaults */
   private draftValues(mod: ServeModule, draft: string): Record<string, unknown> {
      const path = this.draftPath(mod, draft)
      if (path != null && existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [name, varDef] of mod.dw.entries()) out[name] = describeVar(varDef).default
      return out
   }

   // #region outputs ----------------------------------------------------------
   private replyOutput(segs: string[]): ServeReply {
      const abs = resolve(this.outputRoot, ...segs)
      // traversal guard: the resolved path must stay under the output root
      if (abs !== this.outputRoot && !abs.startsWith(this.outputRoot + '/'))
         return json(400, { error: 'path escapes the outputs root' })
      if (!existsSync(abs) || !statSync(abs).isFile())
         return json(404, { error: `no such output file: /${segs.join('/')}` })
      const contentType = CONTENT_TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream'
      return { status: 200, contentType, body: new Uint8Array(readFileSync(abs)) }
   }

   private async replyWebJs(): Promise<ServeReply> {
      if (this.opts.webJs == null) return json(404, { error: 'web ui not enabled on this server' })
      this.webJsCache ??= this.opts.webJs()
      const js = await this.webJsCache
      if (js == null) return json(404, { error: 'web ui bundle unavailable — see the server log' })
      return { status: 200, contentType: 'text/javascript; charset=utf-8', body: js, headers: NO_STORE }
   }

   /** browser file → local file an image var can point at (downloadInput family) */
   private replyUpload(req: ServeRequest): ServeReply {
      let parsed: unknown
      try {
         parsed = JSON.parse(req.body ?? '')
      } catch (e) {
         return json(400, { error: `body is not valid json: ${extractErrorMessage(e)}` })
      }
      const o = (parsed ?? {}) as { name?: unknown; dataBase64?: unknown }
      if (typeof o.name !== 'string' || o.name === '' || typeof o.dataBase64 !== 'string' || o.dataBase64 === '')
         return json(400, { error: 'upload expects {"name":"<filename>","dataBase64":"<base64 bytes>"}' })
      const bytes = Buffer.from(o.dataBase64, 'base64')
      if (bytes.length === 0) return json(400, { error: 'dataBase64 decoded to zero bytes' })
      const safe = basename(o.name).replace(/[^\w.-]+/g, '_') || 'upload'
      const abs = join(this.outputRoot, 'serve-inputs', `${nanoid(6)}-${safe}`)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, bytes)
      console.log(`[serve] upload → ${abs} (${bytes.length} bytes)`)
      return json(200, { ok: true, path: abs, url: this.outputUrl(abs) })
   }

   // #region drafts write (the web ui's autosave + duplicate ride this) --------
   private async replySaveDraft(modKey: string, rawDraft: string, req: ServeRequest): Promise<ServeReply> {
      const mod = this.moduleByKey(modKey)
      if (mod == null) return json(404, { error: `unknown module '${modKey}'` })
      const draft = this.validDraftName(rawDraft)
      if (draft == null)
         return json(400, { error: `invalid draft name '${rawDraft}' — letters/digits then letters, digits, ". -_"` })
      let parsed: unknown
      try {
         parsed = JSON.parse(req.body ?? '')
      } catch (e) {
         return json(400, { error: `body is not valid json: ${extractErrorMessage(e)}` })
      }
      if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed))
         return json(400, { error: 'body must be a json object: { "<var>": value, … }' })
      const values = parsed as Record<string, unknown>
      const known = new Set(mod.dw.entries().map(([k]) => k))
      const unknown = Object.keys(values).filter((k) => !known.has(k))
      if (unknown.length > 0)
         return json(400, { error: `unknown var(s) ${unknown.join(', ')} — vars: ${[...known].join(', ')}` })
      // values are written VERBATIM (toJSON shapes, loadJSON re-validates on read) —
      // under the module mutex, so a save cannot interleave a generate's draft read
      const path = bang(this.draftPath(mod, draft), 'draft name validated just above')
      await this.exclusive(mod.key, () => {
         mkdirSync(dirname(path), { recursive: true })
         writeFileSync(path, JSON.stringify(values, null, 2))
         return Promise.resolve()
      })
      return json(200, { ok: true, module: mod.key, draft, drafts: this.draftsFor(mod) })
   }

   /** delete the draft FILE. `default` is deletable like any other: the implicit `default`
    * draft (spec values, no file) survives it, which is exactly the reset. Missing file is
    * still a 200 — the caller asked for it to be gone, and it is */
   private async replyDeleteDraft(modKey: string, rawDraft: string): Promise<ServeReply> {
      const mod = this.moduleByKey(modKey)
      if (mod == null) return json(404, { error: `unknown module '${modKey}'` })
      const path = this.draftPath(mod, rawDraft)
      if (path == null) return json(400, { error: `invalid draft name '${rawDraft}'` })
      await this.exclusive(mod.key, () => {
         if (existsSync(path)) rmSync(path)
         return Promise.resolve()
      })
      console.log(`[serve] draft deleted: ${mod.key}/${rawDraft.trim()}`)
      return json(200, { ok: true, module: mod.key, draft: rawDraft.trim(), drafts: this.draftsFor(mod) })
   }

   // #region hosts (run a workflow somewhere else, the TUI's host override) ----
   /** every host this process registered: the modules' own, plus anything they created */
   private knownHosts(): { id: string; url: string; httpUrl: string; modules: string[] }[] {
      const byId = new Map<string, { id: string; url: string; httpUrl: string; modules: string[] }>()
      for (const [id, host] of comfyts.hosts)
         byId.set(id, {
            id,
            url: `${host.base.host}:${host.base.port}`,
            // the browser needs the REAL base to open the host's own pages (lora manager)
            httpUrl: host.getServerHostHTTP(),
            modules: [],
         })
      for (const mod of this.modules) {
         const entry = byId.get(mod.dw.host.data.id)
         if (entry != null) entry.modules.push(mod.key)
      }
      return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
   }

   /** the host a run goes to: the override if it still exists, else the module's own.
    * A stale override (a host id that is gone) must never silently swallow the run */
   private runHostFor(mod: ServeModule): ComfyHost | null {
      const wanted = this.settings.hostOverride[mod.key]
      if (wanted == null || wanted === mod.dw.host.data.id) return null
      return comfyts.hosts.get(wanted) ?? null
   }

   /** the host actions the TUI's host panel has, minus re-codegen: regenerating the sdk
    * rewrites a .d.ts for your EDITOR, while the running modules keep the builder they were
    * imported with — a button that changes nothing in this process would be a lie */
   private async replyHostAction(hostId: string, action: string): Promise<ServeReply> {
      const host = comfyts.hosts.get(hostId)
      if (host == null)
         return json(404, { error: `unknown host '${hostId}' — known: ${[...comfyts.hosts.keys()].join(', ')}` })
      try {
         if (action === 'interrupt') {
            await host.interrupt()
            return json(200, { ok: true, host: hostId, action, note: 'interrupt requested' })
         }
         if (action === 'clear-queue') {
            await host.clearQueue()
            return json(200, { ok: true, host: hostId, action, note: 'pending prompts dropped' })
         }
         if (action === 'refresh-loras') return await this.refreshLoraMirror(hostId, host)
         if (action === 'refresh-schema') {
            // refetch object_info and rewrite sdk.d.ts. HONEST about the limit: the modules in
            // THIS process keep the options they were defined with, so a var's list only widens
            // after a serve restart — the file on disk is what a re-import and your editor read
            await host.fetchAndUpdateSchema()
            const nodes = host.schema.nodes.length
            const loras = host.schema.getLoras().length
            return json(200, {
               ok: true,
               host: hostId,
               action,
               note: `schema refetched: ${nodes} node types, ${loras} loras — restart serve to widen the var lists`,
            })
         }
         if (action === 'restart') {
            // the server dropping the connection mid-reboot IS the expected shape, so a
            // failure here still means "asked" — the ws reconnects when it comes back
            await host.manager.restartComfyUI().catch(() => null)
            return json(200, { ok: true, host: hostId, action, note: 'reboot requested — it reconnects when back' })
         }
         return json(400, {
            error: `unknown host action '${action}' — interrupt | clear-queue | restart | refresh-loras | refresh-schema`,
         })
      } catch (e) {
         return json(502, { error: `host '${hostId}' refused '${action}': ${extractErrorMessage(e)}` })
      }
   }

   /** re-sweep ComfyUI-Lora-Manager and rewrite the mirror — what `comfy-ts loras` does, with
    * its refusals kept: a partial or unreachable sweep NEVER overwrites, because writing it
    * would delete loras from the mirror that are alive on the host */
   private async refreshLoraMirror(hostId: string, host: ComfyHost): Promise<ServeReply> {
      const sweep = await fetchLoraList(host)
      if (sweep.status === 'absent')
         return json(400, {
            error: `${hostId} has no ComfyUI-Lora-Manager: the extension is not installed there. Mirror left untouched.`,
         })
      if (sweep.status === 'unreachable')
         return json(502, { error: `${hostId} unreachable — ${sweep.reason}. Mirror left untouched.` })
      if (sweep.status === 'partial')
         return json(502, {
            error: `the sweep broke off after ${sweep.items.length} loras (${sweep.reason}). Writing that would drop every lora past it, so the mirror is left untouched.`,
         })
      const mirror = buildLoraMirror({
         hostId,
         hostUrl: host.getServerHostHTTP(),
         fetchedAt: new Date().toISOString(),
         items: sweep.items,
      })
      writeLoraMirror(mirror)
      // the in-process cache reads the file by mtime, so every surface sees the new names
      reloadLoraInfoCache()
      console.log(`[serve] lora mirror refreshed for ${hostId}: ${mirror.count} loras`)
      return json(200, {
         ok: true,
         host: hostId,
         action: 'refresh-loras',
         count: mirror.count,
         note: `${mirror.count} loras synced`,
      })
   }

   /** is the host answering RIGHT NOW: what the panel polls while a restart is in flight, so
    * "restarting…" ends on a fact rather than on a guess */
   private async replyHostPing(hostId: string): Promise<ServeReply> {
      const host = comfyts.hosts.get(hostId)
      if (host == null) return json(404, { error: `unknown host '${hostId}'` })
      try {
         const res = await host.fetch('/system_stats', {})
         return json(200, { host: hostId, up: res.ok, status: res.status })
      } catch (e) {
         return json(200, { host: hostId, up: false, reason: extractErrorMessage(e) })
      }
   }

   /** the ComfyUI console, the TUI's logs panel over http — through the SAME assembly the TUI
    * uses (assembleLogChunks): entries are write CHUNKS, so lines are folded there, ANSI is
    * stripped, tqdm redraws collapse to their last state, and the cp1252 mojibake a windows
    * host emits is repaired. Re-implementing any of that here would drift from the TUI */
   private async replyHostLogs(hostId: string): Promise<ServeReply> {
      const host = comfyts.hosts.get(hostId)
      if (host == null) return json(404, { error: `unknown host '${hostId}'` })
      try {
         const raw = await host.fetchRawLogs()
         const lines: string[] = []
         const partial = assembleLogChunks({ lines, partial: '', entries: raw.entries })
         // the tail has no newline yet (a live progress bar): show it, it is the current state
         if (partial.trim() !== '') lines.push(partial)
         return json(200, { host: hostId, lines: lines.slice(-200) })
      } catch (e) {
         return json(502, { error: `could not read the logs of '${hostId}': ${extractErrorMessage(e)}` })
      }
   }

   private replyHosts(): ServeReply {
      return json(200, {
         hosts: this.knownHosts(),
         defaults: Object.fromEntries(this.modules.map((m) => [m.key, m.dw.host.data.id])),
         overrides: this.settings.hostOverride,
      })
   }

   private replySetHost(modKey: string, req: ServeRequest): ServeReply {
      const mod = this.moduleByKey(modKey)
      if (mod == null) return json(404, { error: `unknown module '${modKey}'` })
      let parsed: unknown
      try {
         parsed = JSON.parse(req.body ?? '')
      } catch (e) {
         return json(400, { error: `body is not valid json: ${extractErrorMessage(e)}` })
      }
      const wanted = parsed != null && typeof parsed === 'object' ? (parsed as { host?: unknown }).host : null
      if (wanted != null && typeof wanted !== 'string')
         return json(400, { error: 'body must be { "host": "<host id>" } or { "host": null } to reset' })
      const next = { ...this.settings.hostOverride }
      if (wanted == null || wanted === mod.dw.host.data.id) delete next[mod.key]
      else {
         if (!comfyts.hosts.has(wanted))
            return json(400, {
               error: `unknown host '${wanted}' — known: ${[...comfyts.hosts.keys()].join(', ')}`,
            })
         next[mod.key] = wanted
      }
      this.settings = { ...this.settings, hostOverride: next }
      try {
         writeServeSettings(this.settings)
      } catch (e) {
         return json(500, { error: `host applied for this session but not saved: ${extractErrorMessage(e)}` })
      }
      const target = next[mod.key] ?? mod.dw.host.data.id
      console.log(`[serve] ${mod.key} runs on ${target}${next[mod.key] != null ? ' (override)' : ''}`)
      return json(200, { ok: true, module: mod.key, host: target, overrides: this.settings.hostOverride })
   }

   // #region settings + in-memory outputs --------------------------------------
   /** the last N in-memory outputs stay reachable; older ones are dropped, because with
    * saving off these buffers are the only copy and nothing else will free them */
   private readonly MEMORY_IMAGE_CAP = 60

   private rememberMemoryImage(key: string, bytes: Uint8Array, filename: string): void {
      const contentType = CONTENT_TYPES[extname(filename).toLowerCase()] ?? sniffImageContentType(bytes)
      this.memoryImages.set(key, { bytes, contentType })
      while (this.memoryImages.size > this.MEMORY_IMAGE_CAP) {
         const oldest = this.memoryImages.keys().next()
         if (oldest.done === true) break
         this.memoryImages.delete(oldest.value)
      }
   }

   private replyMemoryImage(key: string): ServeReply {
      const hit = this.memoryImages.get(key)
      if (hit == null)
         return json(404, {
            error: `no in-memory image '${key}' — it expired (only the last ${this.MEMORY_IMAGE_CAP} are kept) or the server restarted. Turn saving on to keep outputs.`,
         })
      return { status: 200, contentType: hit.contentType, body: hit.bytes }
   }

   /** the subfolder under outputs/ a module's images land in. Falls back to the module key,
    * which is what every serve run used before the prefix was choosable */
   private savePrefixFor(modKey: string): string {
      const stored = this.settings.savePrefix[modKey]?.trim() ?? ''
      return stored === '' ? modKey : stored
   }

   /** a prefix becomes a PATH under outputs/: segments are name-gated, so it cannot climb out */
   private validSavePrefix(raw: string): string | null {
      const clean = raw.trim().replaceAll('\\', '/')
      if (clean === '') return ''
      const segments = clean.split('/').filter((s) => s !== '')
      if (segments.length === 0 || segments.some((s) => validStoreName(s) == null)) return null
      return segments.join('/')
   }

   private replySaveSettings(req: ServeRequest): ServeReply {
      let parsed: unknown
      try {
         parsed = JSON.parse(req.body ?? '')
      } catch (e) {
         return json(400, { error: `body is not valid json: ${extractErrorMessage(e)}` })
      }
      if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed))
         return json(400, {
            error: 'body must be { "saveToDisk"?: true | false, "savePrefix"?: { "<module>": "path" } }',
         })
      const wanted = parsed as { saveToDisk?: unknown; savePrefix?: unknown }
      let next = this.settings
      if (wanted.saveToDisk != null) {
         if (typeof wanted.saveToDisk !== 'boolean') return json(400, { error: '"saveToDisk" must be true or false' })
         next = { ...next, saveToDisk: wanted.saveToDisk }
      }
      if (wanted.savePrefix != null) {
         if (typeof wanted.savePrefix !== 'object' || Array.isArray(wanted.savePrefix))
            return json(400, { error: '"savePrefix" must be { "<module>": "path" }' })
         const prefixes = { ...next.savePrefix }
         for (const [modKey, raw] of Object.entries(wanted.savePrefix as Record<string, unknown>)) {
            if (this.moduleByKey(modKey) == null) return json(404, { error: `unknown module '${modKey}'` })
            if (typeof raw !== 'string') return json(400, { error: `prefix for '${modKey}' must be a string` })
            const clean = this.validSavePrefix(raw)
            if (clean == null)
               return json(400, {
                  error: `invalid prefix '${raw}' — folder names only, "a/b" allowed, no ".." and no absolute path`,
               })
            // empty means "back to the default", so the stored map keeps only real choices
            if (clean === '') delete prefixes[modKey]
            else prefixes[modKey] = clean
         }
         next = { ...next, savePrefix: prefixes }
      }
      const saveToDisk = next.saveToDisk
      this.settings = next
      try {
         writeServeSettings(this.settings)
      } catch (e) {
         // the live setting still applies; say the persistence failed rather than lying
         return json(500, { error: `setting applied for this session but not saved: ${extractErrorMessage(e)}` })
      }
      console.log(`[serve] outputs ${saveToDisk ? 'SAVE to disk' : 'stay in MEMORY'}`)
      return this.replySettings()
   }

   /** the stored settings PLUS the prefix each module actually uses, so the ui can show the
    * effective folder without re-deriving the fallback rule */
   private replySettings(): ServeReply {
      return json(200, {
         ...this.settings,
         effectivePrefix: Object.fromEntries(this.modules.map((m) => [m.key, this.savePrefixFor(m.key)])),
      })
   }

   // #region prompt enhancers (the web ui's master prompts, as .md files) ------
   /** the folder is seeded on the first read, so `refine-krea2-prompt.md` exists to be edited */
   private replyPromptEnhancers(): ServeReply {
      try {
         return json(200, { enhancers: listPromptEnhancers() })
      } catch (e) {
         return json(500, { error: `prompt-enhancers folder unreadable: ${extractErrorMessage(e)}` })
      }
   }

   private replySavePromptEnhancer(rawName: string, req: ServeRequest): ServeReply {
      const name = validStoreName(rawName)
      if (name == null)
         return json(400, { error: `invalid enhancer name '${rawName}' — letters/digits then letters, digits, ". -_"` })
      let parsed: unknown
      try {
         parsed = JSON.parse(req.body ?? '')
      } catch (e) {
         return json(400, { error: `body is not valid json: ${extractErrorMessage(e)}` })
      }
      if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed))
         return json(400, { error: 'body must be { "text": "<master prompt>" }' })
      const text = (parsed as Record<string, unknown>).text
      if (typeof text !== 'string') return json(400, { error: 'body must be { "text": "<master prompt>" }' })
      try {
         writePromptEnhancer(name, text)
      } catch (e) {
         return json(500, { error: `could not write enhancer '${name}': ${extractErrorMessage(e)}` })
      }
      return json(200, { ok: true, name, enhancers: listPromptEnhancers() })
   }

   private replyDeletePromptEnhancer(rawName: string): ServeReply {
      const name = validStoreName(rawName)
      if (name == null) return json(400, { error: `invalid enhancer name '${rawName}'` })
      try {
         deletePromptEnhancer(name)
      } catch (e) {
         return json(500, { error: `could not delete enhancer '${name}': ${extractErrorMessage(e)}` })
      }
      console.log(`[serve] prompt enhancer deleted: ${name}`)
      return json(200, { ok: true, name, enhancers: listPromptEnhancers() })
   }

   // #region live run state (web ui polling: progress + latent preview) --------
   private liveRuns = new Map<string, ServeExecution>()
   /** seq counts frames so the poller refetches only on a NEW one, not every tick */
   private latentPreviews = new Map<string, { bytes: Uint8Array; mime: string; seq: number }>()
   private latentSeq = 0
   /** promptId → module: `onLatentPreview` is ONE slot per host and two modules can share a
    * host, so frames are routed by the prompt they belong to, never by "the last run started" */
   private promptOwner = new Map<string, string>()
   private latentHosts = new Set<ComfyHost>()

   private runningModules(): string[] {
      return [...this.liveRuns.entries()]
         .filter(([, e]) => e.status !== 'Success' && e.status !== 'Failure')
         .map(([key]) => key)
   }

   /** one dispatcher per host, installed once and left in place (idempotent) */
   private wireLatents(host: ComfyHost): void {
      if (this.latentHosts.has(host)) return
      this.latentHosts.add(host)
      host.onLatentPreview = (p) => {
         const owner = p.promptID != null ? this.promptOwner.get(p.promptID) : undefined
         // an unattributable frame (no promptID yet, e.g. before start() returned) is only
         // safe to show when exactly ONE run is live; otherwise drop it rather than lie
         const running = this.runningModules()
         const key = owner ?? (running.length === 1 ? running[0] : undefined)
         if (key == null) return
         this.latentPreviews.set(key, { bytes: p.bytes, mime: p.mime, seq: ++this.latentSeq })
      }
   }

   private replyRunStatus(modKey: string): ServeReply {
      const mod = this.moduleByKey(modKey)
      if (mod == null) return json(404, { error: `unknown module '${modKey}'` })
      const exec = this.liveRuns.get(mod.key)
      const running = exec != null && exec.status !== 'Success' && exec.status !== 'Failure'
      return json(200, {
         running,
         status: exec?.status ?? 'idle',
         percent: running ? (exec.progressGlobal?.percent ?? null) : null,
         hasPreview: this.latentPreviews.has(mod.key),
         previewSeq: this.latentPreviews.get(mod.key)?.seq ?? null,
      })
   }

   private replyRunPreview(modKey: string): ServeReply {
      const mod = this.moduleByKey(modKey)
      if (mod == null) return json(404, { error: `unknown module '${modKey}'` })
      const preview = this.latentPreviews.get(mod.key)
      if (preview == null) return json(404, { error: 'no latent preview yet' })
      return {
         status: 200,
         contentType: preview.mime !== '' ? preview.mime : sniffImageContentType(preview.bytes),
         body: preview.bytes,
      }
   }

   // #region lora hover data ---------------------------------------------------
   private hostById(hostId: string): ComfyHost | null {
      return this.modules.map((m) => m.dw.host).find((h) => h.data.id === hostId) ?? null
   }

   private hostIds(): string {
      return [...new Set(this.modules.map((m) => m.dw.host.data.id))].join(', ')
   }

   /** mirror-backed text for the hover pane, no network */
   private replyLoraInfo(hostId: string, lora: string): ServeReply {
      if (this.hostById(hostId) == null)
         return json(404, { error: `unknown host '${hostId}' — hosts: ${this.hostIds()}` })
      refreshLoraInfoCacheIfChanged()
      // everything the mirror holds that a human wants when they click a card. Read through the
      // lm* accessors, never off the raw json: the extension's field names are its business
      const item = getLoraInfo(lora, hostId)
      const civitai = item == null ? null : lmCivitai(item)
      return json(200, {
         name: lora,
         displayName: getLoraDisplayName(lora, hostId),
         triggerWords: getLoraTriggerWords(lora, hostId),
         known: item != null,
         baseModel: item == null ? null : lmBaseModel(item),
         folder: item == null ? null : lmFolder(item),
         filePath: item == null ? null : lmFilePath(item),
         fileSize: item == null ? null : lmFileSize(item),
         tags: item == null ? [] : lmTags(item),
         notes: item == null ? '' : lmNotes(item),
         civitaiUrl: civitai?.modelId == null ? null : `https://civitai.com/models/${civitai.modelId}`,
         civitaiVersion: civitai?.name ?? null,
      })
   }

   /** what the mirror does NOT hold: civitai's description and the example images, both live
    * from the extension. A SEPARATE route from /lora-info on purpose — that one is mirror-only
    * and instant, this one talks to the host and is fetched when a details panel opens */
   private async replyLoraAbout(hostId: string, lora: string): Promise<ServeReply> {
      const host = this.hostById(hostId)
      if (host == null) return json(404, { error: `unknown host '${hostId}' — hosts: ${this.hostIds()}` })
      refreshLoraInfoCacheIfChanged()
      const item = getLoraInfo(lora, hostId)
      if (item == null) return json(200, { known: false, description: null, examples: [], examplesReason: null })
      const filePath = lmFilePath(item)
      const sha = lmSha256(item)
      const [description, examples] = await Promise.all([
         filePath == null ? Promise.resolve(null) : fetchLoraDescription(host, filePath),
         sha == null ? Promise.resolve({ files: [], reason: null }) : fetchLoraExampleImages(host, sha),
      ])
      return json(200, {
         known: true,
         description,
         examples: examples.files,
         examplesReason: examples.reason,
      })
   }

   /** preview url resolution misses per host, so an absent lora-manager costs ONE sweep, not one
    * per hover. An UNREACHABLE host evicts itself: the host coming back must not stay 404 forever */
   private previewSweeps = new Map<string, Promise<{ status: string; map: Map<string, string> | null }>>()

   private async replyLoraPreview(hostId: string, lora: string): Promise<ServeReply> {
      const host = this.hostById(hostId)
      if (host == null) return json(404, { error: `unknown host '${hostId}' — hosts: ${this.hostIds()}` })
      refreshLoraInfoCacheIfChanged()
      let url = getLoraPreviewUrl(lora, hostId)
      if (url == null) {
         // the TUI's fallback: unsynced mirror (or a lora it never saw) → ask the live host once
         let sweep = this.previewSweeps.get(hostId)
         if (sweep == null) {
            sweep = fetchLoraList(host).then((r) => {
               if (r.status === 'unreachable') {
                  this.previewSweeps.delete(hostId)
                  return { status: r.status, map: null }
               }
               return { status: r.status, map: r.status === 'absent' ? null : loraPreviewMapFrom(r.items) }
            })
            this.previewSweeps.set(hostId, sweep)
         }
         const swept = await sweep
         url = swept.map?.get(loraKey(lora)) ?? null
         // each miss has its OWN cause (the LorasSt rule): the wrong advice sends the user hunting
         if (url == null && swept.status === 'unreachable')
            return json(404, { error: `host '${hostId}' is unreachable — no preview to fetch` })
         if (url == null && swept.status === 'absent')
            return json(404, { error: `lora-manager extension not detected on '${hostId}'` })
      }
      if (url == null)
         return json(404, { error: `no preview known for '${lora}' (run: comfy-ts loras --id ${hostId})` })
      const bytes = await fetchLoraPreviewBytes(host, url)
      // one 404 for two causes on purpose: unreachable host and no-image both mean "nothing to show"
      if (bytes == null)
         return json(404, { error: `no image preview for '${lora}' (host '${hostId}' unreachable, or not an image)` })
      return { status: 200, contentType: sniffImageContentType(bytes), body: bytes }
   }

   private outputUrl(absPath: string): string | null {
      if (!absPath.startsWith(this.outputRoot + '/')) return null
      const rel = absPath.slice(this.outputRoot.length + 1)
      return '/outputs/' + rel.split('/').map(encodeURIComponent).join('/')
   }

   // #region generate ---------------------------------------------------------
   private async generate(mod: ServeModule, draft: string, req: ServeRequest): Promise<ServeReply> {
      let payload: Record<string, unknown> = {}
      if (req.body != null && req.body.trim() !== '') {
         let parsed: unknown
         try {
            parsed = JSON.parse(req.body)
         } catch (e) {
            return json(400, { error: `body is not valid json: ${extractErrorMessage(e)}` })
         }
         if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed))
            return json(400, { error: 'body must be a json object: { "<var>": value, … }' })
         payload = parsed as Record<string, unknown>
      }

      const t0 = Date.now()
      const seeds: Record<string, number> = {}
      const started = await this.exclusive(mod.key, () => this.prepareAndStart(mod, draft, payload, seeds))
      if ('error' in started) return json(started.status, { error: started.error })

      const execution = started.execution
      this.liveRuns.set(mod.key, execution)
      this.promptOwner.set(execution.data.id, mod.key)
      console.log(`[serve] → ${mod.key}/${draft} (prompt ${execution.data.id})`)
      try {
         await execution.done
      } finally {
         this.promptOwner.delete(execution.data.id)
      }
      const durationMs = Date.now() - t0

      if (execution.status === 'Failure') {
         console.error(`[serve] 🔴 ${mod.key}/${draft} failed after ${durationMs}ms`)
         return json(500, {
            ok: false,
            module: mod.key,
            draft,
            promptId: execution.data.id,
            durationMs,
            error: execution.data.error ?? 'execution failed',
         })
      }

      console.log(
         `[serve] 🟢 ${mod.key}/${draft} done in ${(durationMs / 1000).toFixed(1)}s · ${execution.images.length} image(s)`,
      )

      // saving off → the buffer is the only copy: keep it addressable so the gallery (and
      // curl) still get an image instead of a null url
      const memoryKeys = new Map<number, string>()
      for (const [ix, img] of execution.images.entries()) {
         if (img.absPath != null || img.buffer == null) continue
         const key = `${encodeURIComponent(execution.data.id)}/${ix}`
         this.rememberMemoryImage(key, img.buffer, img.filename)
         memoryKeys.set(ix, key)
      }

      // Accept: image/* → first image's bytes directly (curl -o, <img src>)
      const first = execution.images[0]
      if (req.accept?.includes('image/') && first != null) {
         if (first.absPath != null) {
            const contentType = CONTENT_TYPES[extname(first.absPath).toLowerCase()] ?? 'application/octet-stream'
            return { status: 200, contentType, body: new Uint8Array(readFileSync(first.absPath)) }
         }
         const inMemory = this.memoryImages.get(memoryKeys.get(0) ?? '')
         if (inMemory != null) return { status: 200, contentType: inMemory.contentType, body: inMemory.bytes }
      }

      return json(200, {
         ok: true,
         module: mod.key,
         draft,
         promptId: execution.data.id,
         durationMs,
         seeds,
         savedToDisk: this.settings.saveToDisk,
         images: execution.images.map((img, ix) => ({
            filename: img.filename,
            url:
               img.absPath != null
                  ? this.outputUrl(img.absPath)
                  : memoryKeys.has(ix)
                    ? `/images/${memoryKeys.get(ix) ?? ''}`
                    : null,
            absPath: img.absPath,
         })),
      })
   }

   /** everything that touches the module's SHARED vars, under the module mutex */
   private async prepareAndStart(
      mod: ServeModule,
      draft: string,
      payload: Record<string, unknown>,
      seeds: Record<string, number>,
   ): Promise<{ execution: ServeExecution } | { error: string; status: number }> {
      // 1. reset, then load the draft FRESH from disk (TUI edits between requests apply)
      for (const [, varDef] of mod.dw.entries()) varDef.reset()
      const draftPath = this.draftPath(mod, draft)
      if (draftPath == null) return { status: 404, error: `no draft '${draft}'` }
      if (existsSync(draftPath)) {
         try {
            const values = JSON.parse(readFileSync(draftPath, 'utf8')) as Record<string, unknown>
            for (const [k, varDef] of mod.dw.entries()) if (k in values) varDef.loadJSON(values[k])
         } catch (e) {
            return { status: 500, error: `draft file unreadable: ${draftPath} — ${extractErrorMessage(e)}` }
         }
      }

      // the DRAFT's seed values, before payload overrides: the +/- continuation
      // compares against what the draft file says, not what a payload injected
      const draftSeedValues = new Map<string, number>()
      for (const [k, varDef] of mod.dw.entries())
         if (varDef.kind === 'seed') draftSeedValues.set(k, (varDef as SeedVar).value)

      // 2. payload overrides (image urls download first, so the var gets a local path)
      const varMap = new Map(mod.dw.entries())
      for (const [k, rawValue] of Object.entries(payload)) {
         const varDef = varMap.get(k)
         if (varDef == null)
            return { status: 400, error: `unknown var '${k}' — vars: ${[...varMap.keys()].join(', ')}` }
         let value = rawValue
         // kind, never instanceof: consumer and cli hold different class copies (VarKind
         // owns the WHY); casts are the kind-narrowing family, agent/coding.md whitelist 6
         if (varDef.kind === 'image' && typeof rawValue === 'string' && /^https?:\/\//.test(rawValue)) {
            try {
               value = await this.downloadInput(rawValue)
            } catch (e) {
               return { status: 400, error: `var '${k}': ${extractErrorMessage(e)}` }
            }
         }
         // a lora the mirror knows but the enum does not is a legal choice here too, else the
         // picker would offer something the api then refuses
         const err = applyVarPayload(varDef, value, {
            // narrowed by the var's OWN filter, exactly like the picker: what the ui offers and
            // what the api accepts must be the same set, or one of them is lying
            // the SAME function the picker used: it derives the separator from this var's own
            // enum, so a backslash host cannot be offered `a/b` and then refused it
            extraLoraOptions:
               varDef.kind === 'loras'
                  ? managerOnlyLoraOptions({
                       hostId: mod.dw.host.data.id,
                       options: (varDef as LorasVar<string>).options,
                       filter: (varDef as LorasVar<string>).optionsFilter,
                    })
                  : undefined,
         })
         if (err != null) return { status: 400, error: err }
      }

      // 3. image vars must point at real files BEFORE anything is queued
      for (const [k, varDef] of varMap) {
         if (varDef.kind !== 'image') continue
         const img = varDef as ImageVar
         if (img.isSet() && !existsSync(img.absPath()))
            return { status: 400, error: `image var '${k}': file not found: ${img.absPath()}` }
      }

      // 4. seed policy (architecture item 12): payload wins; '?' rerolls;
      //    '+'/'-' continue from the last SERVED value; '=' keeps the draft value
      for (const [k, varDef] of varMap) {
         if (varDef.kind !== 'seed') continue
         const seedVar = varDef as SeedVar
         const stateKey = `${mod.key}/${draft}/${k}`
         const draftValue = draftSeedValues.get(k) ?? seedVar.value
         if (!(k in payload)) {
            if (seedVar.mode === '?') seedVar.randomize()
            else if (seedVar.mode === '+' || seedVar.mode === '-') {
               const prev = this.seedState.get(stateKey)
               // continue only while the draft still holds the value the chain grew from
               if (prev != null && prev.draftBase === draftValue)
                  seedVar.set(prev.last + (seedVar.mode === '+' ? 1 : -1))
            }
         }
         this.seedState.set(stateKey, { last: seedVar.value, draftBase: draftValue })
         seeds[k] = seedVar.value
      }

      // 5. send (build + POST /prompt); the wait for outputs happens OUTSIDE the mutex.
      // latent frames feed the web ui's /run/<module>/preview poll (ExecSt's pattern);
      // the previous run's preview must not linger over the new one
      this.latentPreviews.delete(mod.key)
      this.wireLatents(mod.dw.host)
      try {
         return {
            execution: await this.starter(mod, {
               saveToDisk: this.settings.saveToDisk,
               savePrefix: this.savePrefixFor(mod.key),
               host: this.runHostFor(mod) ?? undefined,
            }),
         }
      } catch (e) {
         // name, not instanceof: same two-copies problem as the var classes
         if (e instanceof Error && e.name === 'ImageVarEmptyError') return { status: 400, error: e.message }
         // the ComfyUI host is upstream of this bridge: 502, not "serve crashed".
         // The connect deadline (ConnectOptions.timeoutMs) is what makes this
         // reachable at all — it used to hang here and block the module mutex
         if (e instanceof Error && e.name === 'ComfyHostUnreachableError') return { status: 502, error: e.message }
         return { status: 500, error: extractErrorMessage(e) }
      }
   }

   /** serialize fn per module key; the stored chain never rejects */
   private exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const prev = this.chains.get(key) ?? Promise.resolve()
      const next = prev.then(fn)
      this.chains.set(
         key,
         next.catch(() => {}),
      )
      return next
   }

   /** payload image urls land as local files under outputs/serve-inputs/ */
   private async downloadInput(url: string): Promise<string> {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`download failed (http ${res.status}): ${url}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const name = basename(new URL(url).pathname) || 'input'
      const abs = join(this.outputRoot, 'serve-inputs', `${nanoid(6)}-${name}`)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, bytes)
      return abs
   }
}
