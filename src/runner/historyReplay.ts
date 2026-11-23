import { type } from 'arktype'
import { type PromptID, type PromptRelated_WsMsg, types } from 'src/runner/ComfyWsApi.ts'

const END_TYPES: ReadonlySet<string> = new Set(['execution_success', 'execution_error', 'execution_interrupted'])

export type HistoryReplay = {
   /** one `executed` per output node the entry lists */
   executed: PromptRelated_WsMsg[]
   /** the end message: from `status.messages`, or a success when the entry says success (or, on an
    * old server, says nothing). Null when the entry claims an end it does not carry */
   end: PromptRelated_WsMsg | null
   /** entries that did not pass the ws schemas, skipped */
   problems: string[]
}

/** a prompt's `GET /history/<id>` reply as the ws messages a client missed. Null while the host has no
 * entry for it: queued, running, or lost */
export function historyReplay(json: unknown, promptId: PromptID): HistoryReplay | null {
   const entry = field(json, promptId)
   if (entry == null) return null
   const problems: string[] = []
   const valid = (raw: unknown): PromptRelated_WsMsg | null => {
      const res = types.PromptRelated_WsMsg(raw)
      if (!(res instanceof type.errors)) return res
      problems.push(`${JSON.stringify(raw).slice(0, 200)}: ${res.summary}`)
      return null
   }

   const executed: PromptRelated_WsMsg[] = []
   const outputs = field(entry, 'outputs')
   if (typeof outputs === 'object' && outputs != null)
      for (const [node, output] of Object.entries(outputs)) {
         const msg = valid({ type: 'executed', data: { node, output, prompt_id: promptId } })
         if (msg != null) executed.push(msg)
      }

   const status = field(entry, 'status')
   const list = field(status, 'messages')
   let end: PromptRelated_WsMsg | null = null
   for (const m of Array.isArray(list) ? list : []) {
      if (!Array.isArray(m) || typeof m[0] !== 'string' || !END_TYPES.has(m[0])) continue
      end = valid({ type: m[0], data: m[1] })
   }
   const statusStr = field(status, 'status_str')
   if (end == null && (status == null || statusStr === 'success'))
      end = valid({ type: 'execution_success', data: { prompt_id: promptId, timestamp: Date.now() } })
   return { executed, end, problems }
}

function field(x: unknown, key: string): unknown {
   if (typeof x !== 'object' || x == null) return null
   return Reflect.get(x, key) ?? null
}
