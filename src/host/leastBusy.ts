import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'

/**
 * the host with the shortest queue. Score = max(server queue, our runs in flight there):
 * the server counts every client, the local count sees runs not posted yet.
 * Ties go to the first host listed; a host that does not answer is skipped, all down throws.
 */
export async function leastBusy<H extends ComfyHost<string>>(
   hosts: readonly H[],
   p: { timeoutMs?: number } = {},
): Promise<H> {
   if (hosts.length === 0) throw new Error('leastBusy: no host given')
   const probes = await Promise.all(
      hosts.map(async (host) => {
         try {
            const queue = await host.fetchQueueSize({ timeoutMs: p.timeoutMs })
            return { host, score: Math.max(queue, host.runsInFlight), error: null }
         } catch (err) {
            return { host, score: Infinity, error: extractErrorMessage(err) }
         }
      }),
   )
   let best: (typeof probes)[number] | null = null
   for (const probe of probes) {
      if (probe.error != null) {
         console.warn(`🟡 leastBusy: host '${probe.host.data.id}' skipped: ${probe.error}`)
         continue
      }
      if (best == null || probe.score < best.score) best = probe
   }
   if (best == null)
      throw new Error(
         `🔴 leastBusy: no host answered (${probes.map((x) => `'${x.host.data.id}': ${x.error}`).join(', ')})`,
      )
   return best.host
}
