// the loras a host's lora-manager knows but its object_info enum does not yet list.
// ONE function, because the picker and the payload validator must agree exactly: whatever
// the ui offers, `applyVarPayload` compares by RAW STRING, so a name built with the wrong
// separator is offered and then refused as an unknown lora.
import { loraMirrorEntries } from 'src/host/loraInfoCache.ts'
import { loraKey } from 'src/host/loraManagerApi.ts'
import { statelessRegex } from 'src/utils/matchesRegex.ts'

/**
 * `options` is the host enum for this var: it decides both what counts as already-known
 * (compared by normalized key, never raw — the enum keeps case, extension and separators)
 * and which separator the rebuilt names must use.
 */
export function managerOnlyLoraOptions(p: {
   hostId: string
   options: readonly string[]
   /** the var's own narrowing, `v.loras(/krea-?2/i)`: it applies to the mirror too */
   filter?: RegExp | null
}): string[] {
   const filter = p.filter == null ? null : statelessRegex(p.filter)
   const known = new Set(p.options.map((o) => loraKey(o)))
   const separator = p.options.some((o) => o.includes('\\')) ? '\\' : '/'
   return loraMirrorEntries(p.hostId, { separator })
      .filter((e) => !known.has(e.key))
      .map((e) => e.serverName)
      .filter((n) => filter == null || filter.test(n))
}
