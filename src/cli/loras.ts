// refresh the local mirror of what ComfyUI-Lora-Manager knows about a host's loras
import { readdirSync, rmdirSync } from 'node:fs'
import { join } from 'pathe'
import { flagReader } from 'src/cli/flags.ts'
import { buildLoraMirror, readLoraMirror, writeLoraMirror } from 'src/host/loraInfoCache.ts'
import { fetchLoraList, lmModelName, lmTrainedWords } from 'src/host/loraManagerApi.ts'
import { ComfyTS } from 'src/state.ts'

const DEFAULT_HOST_URL = 'http://127.0.0.1:8188'

/** host ids already known on disk — `.comfy-ts/hosts/<id>/` is created by `comfy-ts gen` */
function knownHostIds(): string[] {
   try {
      return readdirSync(join(process.cwd(), '.comfy-ts', 'hosts'), { withFileTypes: true })
         .filter((e) => e.isDirectory())
         .map((e) => e.name)
         .sort()
   } catch {
      return []
   }
}

export async function runLoras(args: string[]): Promise<number> {
   const getFlag = flagReader(args)

   // --id: explicit, else the only host folder on disk (unambiguous), else loud
   const known = knownHostIds()
   const explicitId = getFlag('id')
   const id = explicitId ?? (known.length === 1 ? known[0] : null)
   if (id == null) {
      const hint =
         known.length === 0 ? 'none yet — run `comfy-ts gen --id <host-id> --host <url>` first' : known.join(', ')
      console.error(`[comfy-ts loras] 🔴 --id <host-id> is required (known: ${hint})`)
      return 1
   }
   // registering a host MKDIRS .comfy-ts/hosts/<id>/, so a typo used to leave a
   // junk folder that broke the `--id` default (and outline's) for good. Rather
   // than refuse unknown ids — `loras` has no real dependency on `gen` — remember
   // whether the folder pre-existed and take it back if the sweep fails.
   const hostDirExisted = known.includes(id)

   // ComfyTS FIRST: every .comfy-ts path, the mirror's included, resolves through the global
   const comfy = ComfyTS.create()

   // --host: explicit, else the url the last sync remembered for this id
   const previous = readLoraMirror(id)
   const hostUrl = getFlag('host') ?? (previous?.hostUrl !== '' ? previous?.hostUrl : null) ?? DEFAULT_HOST_URL

   const apiKey = getFlag('api-key') ?? process.env.COMFY_CLOUD_API_KEY
   const host = comfy.host({ id, url: hostUrl, apiKey: apiKey ?? undefined })

   /** a sweep that never produced a mirror must leave no trace of this run */
   const abandon = (): void => {
      if (hostDirExisted) return
      const dir = join(process.cwd(), '.comfy-ts', 'hosts', id)
      try {
         if (readdirSync(dir).length === 0) rmdirSync(dir)
      } catch {
         // best effort: a non-empty or vanished dir is not this command's business
      }
   }

   console.log(`[comfy-ts loras] sweeping ${hostUrl} /api/lm/loras/list …`)
   const sweep = await fetchLoraList(host)
   if (sweep.status === 'absent') {
      console.error(
         `[comfy-ts loras] 🔴 ${hostUrl} has no ComfyUI-Lora-Manager: the extension is not installed there. Mirror left untouched.`,
      )
      abandon()
      return 1
   }
   if (sweep.status === 'unreachable') {
      console.error(`[comfy-ts loras] 🔴 ${hostUrl} unreachable — ${sweep.reason}. Mirror left untouched.`)
      abandon()
      return 1
   }
   if (sweep.status === 'partial') {
      // writing this would DELETE loras from the mirror that are alive on the
      // host, and every surface would then quietly not know them
      console.error(
         `[comfy-ts loras] 🔴 the sweep broke off after ${sweep.items.length} loras (${sweep.reason}). Writing that would drop every lora past it, so the mirror is left untouched. Re-run when the host is healthy.`,
      )
      abandon()
      return 1
   }

   const mirror = buildLoraMirror({ hostId: id, hostUrl, fetchedAt: new Date().toISOString(), items: sweep.items })
   const path = writeLoraMirror(mirror)

   // what actually moved since the last sync — the whole point of running it again
   const before = previous?.loras ?? {}
   const added: string[] = []
   const changed: string[] = []
   let withWords = 0
   for (const [key, item] of Object.entries(mirror.loras)) {
      const words = lmTrainedWords(item)
      if (words.length > 0) withWords++
      const old = before[key]
      if (old == null) {
         if (words.length > 0) added.push(`${key} → ${words.join(', ')}`)
         else added.push(key)
      } else if (lmTrainedWords(old).join('\0') !== words.join('\0')) {
         changed.push(`${key} → ${words.length === 0 ? '(cleared)' : words.join(', ')}`)
      }
   }
   const removed = Object.keys(before).filter((k) => mirror.loras[k] == null)

   const sample = (label: string, lines: string[]): void => {
      if (lines.length === 0) return
      console.log(`[comfy-ts loras] ${label} (${lines.length}):`)
      for (const line of lines.slice(0, 10)) console.log(`   ${line}`)
      if (lines.length > 10) console.log(`   … +${lines.length - 10} more`)
   }
   sample('added', added)
   sample('trigger words changed', changed)
   sample('gone from the host', removed)

   const named = Object.values(mirror.loras).filter((i) => lmModelName(i) != null).length
   console.log(
      `[comfy-ts loras] 🟢 ${path} — ${mirror.count} loras, ${withWords} with trigger words, ${named} with a model name`,
   )
   if (previous == null) console.log(`[comfy-ts loras] next time: \`comfy-ts loras --id ${id}\` (url remembered)`)
   return 0
}
