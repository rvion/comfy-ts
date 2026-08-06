// `comfy-ts serve [dir | module.cflow.ts] [--port N] [--host ADDR]`
// drafts as a local HTTP generation API — agent/architecture.md item 12
import { statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { pathToFileURL } from 'node:url'
import { resolve } from 'pathe'
import { scanCflowFiles } from 'src/cli/tui/discoverWorkflows.ts'
import { findDefinedWorkflow } from 'src/cli/tui/findDefinedWorkflow.ts'
import { draftKeyForFile } from 'src/cli/tui/state/DraftsSt.ts'
import { describeVar, renderDescriptorLine } from 'src/cli/serve/describeVar.ts'
import { ServeApp, type ServeModule } from 'src/cli/serve/ServeApp.ts'
import { renderStartupLines } from 'src/cli/serve/startupPrint.ts'
import { loadOrBuildWebJs } from 'src/cli/serve/webBundle.ts'
import { colorsAvailable } from 'src/utils/ansi.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'

const DEFAULT_PORT = 8288
const BODY_CAP = 10_000_000

export function parseArgs(args: string[]): { target?: string; port: number; bind: string } | { error: string } {
   let target: string | undefined
   let port = DEFAULT_PORT
   let bind = '127.0.0.1'
   for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a === '--port') {
         const n = Number(args[++i])
         if (!Number.isInteger(n) || n <= 0 || n > 65535) return { error: `--port expects 1..65535, got '${args[i]}'` }
         port = n
      } else if (a === '--host' || a === '--bind') {
         // --host is the spelling; --bind stays an alias so an old command line keeps working
         const b = args[++i]
         if (b == null) return { error: `${a} expects an address (0.0.0.0 to reach it from another machine)` }
         bind = b
      } else if (a != null && a.startsWith('--')) return { error: `unknown flag '${a}'` }
      else if (a != null) {
         if (target != null) return { error: `one target only (got '${target}' and '${a}')` }
         target = a
      }
   }
   return { target, port, bind }
}

/** node:http glue around ServeApp.handle — exported so tests can drive a real socket */
export function makeRequestListener(app: ServeApp): (req: IncomingMessage, res: ServerResponse) => void {
   return (req, res) => {
      // local bridge, no auth by design: open CORS so browser frontends can call it
      const cors = {
         'access-control-allow-origin': '*',
         'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
         'access-control-allow-headers': 'content-type, accept',
      }
      const chunks: Buffer[] = []
      let size = 0
      let overflow = false
      req.on('error', (e) => console.error(`[serve] request stream error: ${extractErrorMessage(e)}`))
      req.on('data', (c: Buffer) => {
         if (overflow) return
         size += c.length
         if (size > BODY_CAP) {
            // answer NOW: a destroyed request never emits 'end'
            overflow = true
            res.writeHead(413, { 'content-type': 'application/json', ...cors })
            res.end(JSON.stringify({ error: 'payload too large' }), () => req.destroy())
         } else chunks.push(c)
      })
      req.on('end', () => {
         if (overflow) return
         if (req.method === 'OPTIONS') {
            res.writeHead(204, cors)
            res.end()
            return
         }
         app.handle({
            method: req.method ?? 'GET',
            url: req.url ?? '/',
            accept: req.headers.accept,
            body: Buffer.concat(chunks).toString('utf8'),
         })
            .then((reply) => {
               res.writeHead(reply.status, { 'content-type': reply.contentType, ...cors })
               res.end(reply.body)
            })
            .catch((e: unknown) => {
               // handle() catches internally; this guards the response write itself
               console.error(`[serve] response write failed: ${extractErrorMessage(e)}`)
               res.destroy()
            })
      })
   }
}

export async function runServe(args: string[]): Promise<number> {
   const parsed = parseArgs(args)
   if ('error' in parsed) {
      console.error(`[comfy-ts serve] ${parsed.error}`)
      return 1
   }

   // discovery: explicit file → that module only; dir/no-arg → scan, WITHOUT
   // the bundled examples (serve is for the user's tuned drafts)
   const target = resolve(parsed.target ?? '.')
   let files: string[]
   try {
      files = statSync(target).isDirectory() ? scanCflowFiles(target) : [target]
   } catch {
      console.error(`[comfy-ts serve] no such file or directory: ${target}`)
      return 1
   }
   if (files.length === 0) {
      console.error(`[comfy-ts serve] no *.cflow.ts modules under ${target}`)
      return 1
   }

   const modules: ServeModule[] = []
   const loadErrors: Record<string, string> = {}
   for (const file of files) {
      try {
         const mod: Record<string, unknown> = await import(pathToFileURL(file).href)
         const dw = findDefinedWorkflow(mod)
         if (dw == null) throw new Error('exports no DefinedWorkflow')
         const key = draftKeyForFile(file)
         const clash = modules.find((m) => m.key === key)
         if (clash != null) throw new Error(`module key '${key}' already taken by ${clash.file}`)
         modules.push({ key, file, dw })
      } catch (e) {
         loadErrors[file] = extractErrorMessage(e)
         console.error(`[comfy-ts serve] ✗ ${file}: ${loadErrors[file]}`)
      }
   }
   if (modules.length === 0) {
      console.error('[comfy-ts serve] every module failed to load — nothing to serve')
      return 1
   }

   const app = new ServeApp(modules, { loadErrors, webJs: loadOrBuildWebJs })
   printStartup(app, parsed.bind, parsed.port)

   const server = createServer(makeRequestListener(app))

   server.on('error', (e) => {
      console.error(`[comfy-ts serve] server error: ${extractErrorMessage(e)}`)
      process.exitCode = 1
      server.close()
   })
   server.listen(parsed.port, parsed.bind)

   // stays up until the process is interrupted or the server dies
   return new Promise<number>((resolveExit) => {
      server.on('close', () => resolveExit(typeof process.exitCode === 'number' ? process.exitCode : 0))
   })
}

export type Nic = { address: string; family: string | number; internal: boolean }

/** the addresses this bind actually answers on. `0.0.0.0` means every interface, so printing
 * only that back is useless: the LAN ip and the tailnet 100.x are the urls a phone can open */
export function reachableAddresses(bind: string, nics: Record<string, Nic[] | undefined>): string[] {
   if (bind !== '0.0.0.0' && bind !== '::') return [bind]
   const found: string[] = []
   for (const list of Object.values(nics)) {
      for (const nic of list ?? []) {
         // node reports family as 'IPv4' or 4 depending on the version
         if (nic.internal || (nic.family !== 'IPv4' && nic.family !== 4)) continue
         found.push(nic.address)
      }
   }
   return ['127.0.0.1', ...found]
}

function printStartup(app: ServeApp, bind: string, port: number): void {
   const base = `http://${bind}:${port}`
   const color = colorsAvailable()
   const lines = renderStartupLines({
      bind,
      port,
      urls: reachableAddresses(bind, networkInterfaces()),
      color,
      modules: app.modules.map((mod) => {
         const entries = mod.dw.entries()
         const nameWidth = Math.max(...entries.map(([n]) => n.length), 4)
         return {
            key: mod.key,
            hostId: mod.dw.host.data.id,
            routes: app
               .draftsFor(mod)
               .map((d) => `${base}/generate/${encodeURIComponent(mod.key)}/${encodeURIComponent(d)}`),
            varLines: entries.map(([name, varDef]) =>
               renderDescriptorLine(name, describeVar(varDef), nameWidth, color),
            ),
         }
      }),
   })
   for (const line of lines) console.log(line)
}
