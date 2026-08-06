// ComfyUI's own words for a refused prompt. The body carries `error` (what went wrong overall)
// and `node_errors` (per node, with the offending value), and those sentences are the only
// thing that says WHICH input the host would not take.
import { isRecord } from 'src/utils/isRecord.ts'

function str(v: unknown): string {
   return typeof v === 'string' ? v.trim() : ''
}

export function describePromptRejection(body: unknown): string {
   if (!isRecord(body)) return 'no reason given'
   const parts: string[] = []
   const err = body['error']
   if (isRecord(err)) {
      const head = str(err['message'])
      const detail = str(err['details'])
      if (head !== '') parts.push(detail === '' ? head : `${head} (${detail})`)
   }
   const nodes = body['node_errors']
   if (isRecord(nodes)) {
      for (const [nodeId, raw] of Object.entries(nodes)) {
         if (!isRecord(raw)) continue
         const list = raw['errors']
         if (!Array.isArray(list)) continue
         for (const e of list) {
            if (!isRecord(e)) continue
            const detail = str(e['details'])
            const msg = str(e['message'])
            parts.push(`node ${nodeId}: ${[msg, detail].filter((x) => x !== '').join(' — ')}`)
         }
      }
   }
   return parts.length === 0 ? 'no reason given' : parts.join(' · ')
}
