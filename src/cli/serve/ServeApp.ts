// `comfy-ts serve` request handling, transport-free: run-serve owns node:http,
// tests call handle() directly with an injected starter. Full contract:
// agent/architecture.md item 12.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { nanoid } from 'nanoid'
import { basename, dirname, extname, join, resolve } from 'pathe'
import { applyVarPayload } from 'src/cli/serve/applyVarPayload.ts'
import { describeVar, type VarDescriptor } from 'src/cli/serve/describeVar.ts'
import { draftsDirForFile, listDraftsForFile } from 'src/cli/tui/state/DraftsSt.ts'
import { ImageVar, ImageVarEmptyError, SeedVar } from 'src/vars/ComfyVars.ts'
import type { DefinedWorkflow } from 'src/vars/DefinedWorkflow.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'

export type ServeModule = { key: string; file: string; dw: DefinedWorkflow }

/** structural face of ComfyExecution — tests inject a fake starter */
export type ServeExecution = {
   done: Promise<unknown>
   status: string
   images: { absPath: string; filename: string }[]
   data: { id: string; error?: unknown }
}

export type ServeStarter = (mod: ServeModule) => Promise<ServeExecution>

export type ServeRequest = { method: string; url: string; accept?: string; body?: string }
export type ServeReply = { status: number; contentType: string; body: string | Uint8Array }

/** connect + fresh graph from current var values + send; done is awaited OUTSIDE the module mutex */
const realStarter: ServeStarter = async (mod) => {
   await mod.dw.host.connect()
   const wf = await mod.dw.build({ advance: true })
   return await wf.start({})
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

function json(status: number, payload: unknown): ServeReply {
   return { status, contentType: 'application/json', body: JSON.stringify(payload, null, 2) }
}

const USAGE = [
   'GET  /drafts — every served workflow, its drafts and var descriptors',
   'GET  /drafts/<module>/<draft> — one draft with its stored values',
   'POST /generate/<module>/<draft> with { ...vars } — run, blocking',
   'POST /generate/<draft> — unqualified, when unambiguous',
   'GET  /outputs/<path> — generated files',
]

export class ServeApp {
   private starter: ServeStarter
   /** last SERVED seed per `module/draft/var` — '+'/'-' modes continue from it */
   private seedState = new Map<string, number>()
   /** per-module promise chain: vars are shared mutable state, apply→send is exclusive */
   private chains = new Map<string, Promise<unknown>>()

   constructor(
      public modules: ServeModule[],
      private opts: { starter?: ServeStarter; outputRoot?: string; loadErrors?: Record<string, string> } = {},
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
            if (segs.length === 0 || (segs[0] === 'drafts' && segs.length === 1)) return this.replyIndex()
            if (segs[0] === 'drafts' && segs.length === 3 && segs[1] != null && segs[2] != null)
               return this.replyDraft(segs[1], segs[2])
            if (segs[0] === 'outputs') return this.replyOutput(segs.slice(1))
            return json(404, { error: `no route: GET ${path}`, usage: USAGE })
         }
         if (req.method === 'POST' && segs[0] === 'generate') {
            const target = this.resolveDraft(segs.slice(1))
            if ('error' in target) return json(target.status, { error: target.error })
            return await this.generate(target.mod, target.draft, req)
         }
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

   private draftExists(mod: ServeModule, draft: string): boolean {
      return draft === 'default' || existsSync(join(draftsDirForFile(mod.file), `${draft}.json`))
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
      const vars: Record<string, VarDescriptor> = {}
      for (const [name, varDef] of mod.dw.entries()) vars[name] = describeVar(varDef)
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
      const path = join(draftsDirForFile(mod.file), `${draft}.json`)
      if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
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
      console.log(`[serve] → ${mod.key}/${draft} (prompt ${execution.data.id})`)
      await execution.done
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

      // Accept: image/* → first image's bytes directly (curl -o, <img src>)
      const first = execution.images[0]
      if (req.accept?.includes('image/') && first != null) {
         const contentType = CONTENT_TYPES[extname(first.absPath).toLowerCase()] ?? 'application/octet-stream'
         return { status: 200, contentType, body: new Uint8Array(readFileSync(first.absPath)) }
      }

      return json(200, {
         ok: true,
         module: mod.key,
         draft,
         promptId: execution.data.id,
         durationMs,
         seeds,
         images: execution.images.map((img) => ({
            filename: img.filename,
            url: this.outputUrl(img.absPath),
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
      const draftPath = join(draftsDirForFile(mod.file), `${draft}.json`)
      if (existsSync(draftPath)) {
         try {
            const values = JSON.parse(readFileSync(draftPath, 'utf8')) as Record<string, unknown>
            for (const [k, varDef] of mod.dw.entries()) if (k in values) varDef.loadJSON(values[k])
         } catch (e) {
            return { status: 500, error: `draft file unreadable: ${draftPath} — ${extractErrorMessage(e)}` }
         }
      }

      // 2. payload overrides (image urls download first, so the var gets a local path)
      const varMap = new Map(mod.dw.entries())
      for (const [k, rawValue] of Object.entries(payload)) {
         const varDef = varMap.get(k)
         if (varDef == null)
            return { status: 400, error: `unknown var '${k}' — vars: ${[...varMap.keys()].join(', ')}` }
         let value = rawValue
         if (varDef instanceof ImageVar && typeof rawValue === 'string' && /^https?:\/\//.test(rawValue)) {
            try {
               value = await this.downloadInput(rawValue)
            } catch (e) {
               return { status: 400, error: `var '${k}': ${extractErrorMessage(e)}` }
            }
         }
         const err = applyVarPayload(varDef, value)
         if (err != null) return { status: 400, error: err }
      }

      // 3. image vars must point at real files BEFORE anything is queued
      for (const [k, varDef] of varMap) {
         if (varDef instanceof ImageVar && varDef.isSet() && !existsSync(varDef.absPath()))
            return { status: 400, error: `image var '${k}': file not found: ${varDef.absPath()}` }
      }

      // 4. seed policy (architecture item 12): payload wins; '?' rerolls;
      //    '+'/'-' continue from the last SERVED value; '=' keeps the draft value
      for (const [k, varDef] of varMap) {
         if (!(varDef instanceof SeedVar)) continue
         const stateKey = `${mod.key}/${draft}/${k}`
         if (!(k in payload)) {
            if (varDef.mode === '?') varDef.randomize()
            else if (varDef.mode === '+' || varDef.mode === '-') {
               const last = this.seedState.get(stateKey)
               if (last != null) varDef.set(last + (varDef.mode === '+' ? 1 : -1))
            }
         }
         this.seedState.set(stateKey, varDef.value)
         seeds[k] = varDef.value
      }

      // 5. send (build + POST /prompt); the wait for outputs happens OUTSIDE the mutex
      try {
         return { execution: await this.starter(mod) }
      } catch (e) {
         if (e instanceof ImageVarEmptyError) return { status: 400, error: e.message }
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
