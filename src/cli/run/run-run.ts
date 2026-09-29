// `comfy-ts run`: one generation from the command line, headless (architecture.md item 15).
// It is serve's generate path in process: a ServeApp over the one module, handle(POST
// /generate/…), so drafts, payload checks, the media gate and seeds are serve's own code. Only
// the starter differs (live progress, nothing saved by the runner) and the outputs land where
// --out says
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { basename, dirname, resolve } from 'pathe'
import type { DefinedWorkflow } from 'src/vars/DefinedWorkflow.ts'
import { flagValue, type FlagSpec } from 'src/cli/run/flagValue.ts'
import { outputPaths, sidecarPath } from 'src/cli/run/outputPaths.ts'
import { pickModule } from 'src/cli/run/pickModule.ts'
import { parseRunArgs } from 'src/cli/run/runArgs.ts'
import { describeVar, renderDescriptorLine } from 'src/cli/serve/describeVar.ts'
import { ServeApp, type ServeExecution, type ServeStarter } from 'src/cli/serve/ServeApp.ts'
import { findModules, workspaceOf } from 'src/cli/run/findModules.ts'
import { mergeWorkflowSources, scanCflowFiles } from 'src/cli/tui/discoverWorkflows.ts'
import { findDefinedWorkflow } from 'src/cli/tui/findDefinedWorkflow.ts'
import { moduleName } from 'src/cli/tui/treeRows.ts'
import { bundledExamplesDir } from 'src/exampleAssets.ts'
import { ComfyTS } from 'src/state.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'

const USAGE = `comfy-ts run <name | module.cflow.ts> [--draft <name>] [--<var> <value>…] [--out <path>] [--json]
   one generation, headless, with live progress. <name> is a module key (10-anima-t2i), the key
   without its number (anima-t2i), or a unique part of it (anima). \`comfy-ts run <name> --help\`
   lists the module's vars. --<var>-file <path> reads a text var from a file. --out a.png writes
   there (several outputs: a-1.png, a-2.png), --out dir/ keeps the server's names, no --out
   writes <module>-<id>.<ext> here. Text outputs go beside the first media output as <stem>.txt.
   --json prints one line with every output path, --verbose shows the library log on stderr`

type Out = { path: string; note: string | null; bytes: Uint8Array | null; from: string | null }

function discover(cwd: string): string[] {
   const bundledDir = bundledExamplesDir()
   return mergeWorkflowSources({
      explicitTarget: false,
      scanned: findModules(cwd),
      bundledFiles: bundledDir == null ? [] : scanCflowFiles(bundledDir),
   }).files
}

const log = (line: string): void => void process.stderr.write(`${line}\n`)

export async function runRun(argv: string[]): Promise<number> {
   const args = parseRunArgs(argv)
   if ('error' in args) {
      log(`[comfy-ts run] ${args.error}`)
      return 1
   }
   // stdout carries the result lines only (one json line under --json): the library's info
   // chatter is silenced, and a stray console.log reaches stderr under --verbose, else nowhere
   const say = console.log.bind(console)
   if (!args.verbose) process.env.COMFY_TS_QUIET = '1'
   console.log = (...a: unknown[]): void => {
      if (args.verbose) console.error(...a)
   }
   const cwd = process.cwd()
   const explicit = args.name != null && /\.cflow\.tsx?$/.test(args.name) ? resolve(cwd, args.name) : null
   const files = explicit != null ? [explicit] : discover(cwd)
   if (args.name == null) {
      say(USAGE)
      const names = [...new Set(files.map((f) => `${basename(dirname(f))}/${moduleName(f)}`))]
      say(`\nmodules:\n${names.map((k) => `   ${k}`).join('\n')}`)
      return 0
   }
   if (explicit != null && !existsSync(explicit)) {
      log(`[comfy-ts run] no such file: ${explicit}`)
      return 1
   }
   const picked = explicit != null ? { file: explicit, key: moduleName(explicit) } : pickModule(files, args.name)
   if ('error' in picked) {
      log(`[comfy-ts run] ${picked.error}`)
      return 1
   }

   // rooted at the module's workspace before its import registers one at the cwd: its schema
   // cache and drafts are there, and --out and media paths still resolve against the cwd
   ComfyTS.create({ rootPath: workspaceOf(picked.file) ?? cwd })
   let dw: DefinedWorkflow
   try {
      const found = findDefinedWorkflow((await import(pathToFileURL(picked.file).href)) as Record<string, unknown>)
      if (found == null) throw new Error('it exports no DefinedWorkflow')
      dw = found
   } catch (e) {
      log(`[comfy-ts run] ${picked.file}: ${extractErrorMessage(e)}`)
      return 1
   }
   const vars = new Map(dw.entries())

   if (args.help) {
      say(`comfy-ts run ${picked.key}  (${picked.file})\n\nvars, each one a --<name> <value> flag:`)
      const width = Math.max(0, ...[...vars.keys()].map((k) => k.length))
      for (const [k, v] of vars) {
         const d = describeVar(v)
         // the cli's own forms where they differ from serve's json payload
         const payload =
            v.kind === 'seed'
               ? 'a number, or ? for a random one'
               : v.kind === 'toggle'
                 ? 'true | false, or the bare flag'
                 : v.kind === 'text' || v.kind === 'prompt'
                   ? `${d.payload}, or --${k}-file <path>`
                   : d.payload
         say(renderDescriptorLine(k, { ...d, payload }, width))
      }
      return 0
   }

   // the flags, shaped by each var's own kind
   const payload: Record<string, unknown> = {}
   for (const [name, raw] of args.vars) {
      const fileOf = name.endsWith('-file') ? name.slice(0, -'-file'.length) : null
      const target = fileOf != null && vars.has(fileOf) ? fileOf : name
      const v = vars.get(target)
      if (v == null) {
         log(`[comfy-ts run] ${picked.key} has no var '${name}'. Vars: ${[...vars.keys()].join(', ')}`)
         return 1
      }
      if (target !== name) {
         if (raw === true) {
            log(`[comfy-ts run] --${name} needs a path`)
            return 1
         }
         const path = resolve(cwd, raw)
         if (!existsSync(path)) {
            log(`[comfy-ts run] --${name}: no such file ${path}`)
            return 1
         }
         payload[target] = readFileSync(path, 'utf8').trim()
         continue
      }
      // kind, never instanceof (agent/coding.md cast whitelist 6)
      const spec: FlagSpec = { kind: v.kind, select: v.kind === 'choice' ? describeVar(v).select : undefined }
      const shaped = flagValue({ name, spec, raw, cwd })
      if ('error' in shaped) {
         log(`[comfy-ts run] ${shaped.error}`)
         return 1
      }
      payload[name] = shaped.value
   }
   // a voice clip's transcript sits beside it as <clip>.txt: the pair a voice design writes
   const transcript = vars.get('transcript')
   if (transcript != null && transcript.kind === 'text' && !('transcript' in payload)) {
      for (const [k, v] of vars) {
         const p = payload[k]
         if (v.kind !== 'audio' || typeof p !== 'string' || /^https?:\/\//.test(p)) continue
         const side = sidecarPath(p)
         if (existsSync(side)) {
            payload.transcript = readFileSync(side, 'utf8').trim()
            if (!args.json) log(`   transcript from ${side}`)
            break
         }
      }
   }

   let execution: ServeExecution | null = null
   const starter: ServeStarter = async (mod, opts) => {
      const host = opts.host ?? mod.dw.host
      await host.connect()
      const wf = await mod.dw.build({ advance: true, host })
      const ex = await wf.start({ save: false, log: !args.json })
      execution = ex
      return ex
   }
   const app = new ServeApp([{ key: picked.key, file: picked.file, dw }], { starter })
   if (!args.json) log(`▶ ${dw.host.data.id} · ${picked.key}/${args.draft}`)
   const t0 = Date.now()
   let code = 0
   try {
      const reply = await app.handle({
         method: 'POST',
         url: `/generate/${encodeURIComponent(picked.key)}/${encodeURIComponent(args.draft)}`,
         body: JSON.stringify(payload),
      })
      const body = JSON.parse(typeof reply.body === 'string' ? reply.body : new TextDecoder().decode(reply.body)) as {
         ok?: boolean
         error?: string
         seeds?: Record<string, number>
         promptId?: string
         durationMs?: number
      }
      const ex = execution as ServeExecution | null
      if (reply.status !== 200 || body.ok !== true || ex == null) {
         const error = body.error ?? `serve answered ${reply.status}`
         if (args.json) say(JSON.stringify({ ok: false, module: picked.key, draft: args.draft, error }))
         else log(`\n✗ ${picked.key}/${args.draft}: ${error}`)
         return 1
      }

      const media: { filename: string; bytes: Uint8Array | null; from: string | null }[] = [
         ...ex.images.map((i) => ({ filename: i.filename, bytes: i.buffer ?? null, from: i.absPath })),
         ...(ex.audios ?? []).map((a) => ({ filename: a.filename, bytes: a.bytes, from: a.absPath })),
         ...(ex.videos ?? []).map((a) => ({ filename: a.filename, bytes: a.bytes, from: a.absPath })),
      ]
      const outIsDir =
         args.out != null &&
         (/[/\\]$/.test(args.out) ||
            (existsSync(resolve(cwd, args.out)) && statSync(resolve(cwd, args.out)).isDirectory()))
      const dests = outputPaths({
         out: args.out,
         outIsDir,
         module: picked.key,
         promptId: body.promptId ?? ex.data.id,
         items: media,
         cwd,
      })
      const outs: Out[] = media.map((m, i) => ({ ...dests[i]!, bytes: m.bytes, from: m.from }))
      for (const o of outs) {
         const bytes = o.bytes ?? (o.from != null ? new Uint8Array(readFileSync(o.from)) : null)
         if (bytes == null) throw new Error(`an output of ${picked.key} came back with no bytes`)
         mkdirSync(dirname(o.path), { recursive: true })
         writeFileSync(o.path, bytes)
      }
      const texts = (ex.texts ?? []).map((t) => t.text)
      const written = outs.map((o) => o.path)
      if (texts.length > 0) {
         const first = outs[0]
         if (first != null) {
            writeFileSync(sidecarPath(first.path), `${texts.join('\n')}\n`)
            written.push(sidecarPath(first.path))
         } else if (args.out != null && !outIsDir) {
            const path = resolve(cwd, args.out)
            mkdirSync(dirname(path), { recursive: true })
            writeFileSync(path, `${texts.join('\n')}\n`)
            written.push(path)
         } else if (!args.json) for (const t of texts) say(t)
      }
      const durationMs = body.durationMs ?? Date.now() - t0
      if (args.json)
         say(
            JSON.stringify({
               ok: true,
               module: picked.key,
               draft: args.draft,
               seeds: body.seeds ?? {},
               durationMs,
               outputs: written,
               texts,
            }),
         )
      else {
         const seeds = Object.entries(body.seeds ?? {})
            .map(([k, v]) => `${k} ${v}`)
            .join(', ')
         for (const o of outs) log(`✓ ${o.path}${o.note == null ? '' : `  (${o.note})`}`)
         for (const w of written.slice(outs.length)) log(`✓ ${w}`)
         log(`  ${(durationMs / 1000).toFixed(1)}s${seeds === '' ? '' : ` · ${seeds}`}`)
         if (written.length === 0) log('  the run produced no output')
      }
   } catch (e) {
      log(`[comfy-ts run] 🔴 ${extractErrorMessage(e)}`)
      code = 1
   } finally {
      for (const [, h] of comfyts.hosts) h.disconnect()
   }
   return code
}
