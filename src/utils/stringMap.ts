// unknown json → a plain record of strings. Every localStorage blob and every settings file
// crossing into this process needs the same shape check; two copies of it drift.
export function stringMap(raw: unknown): Record<string, string> {
   const out: Record<string, string> = {}
   if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v
   }
   return out
}
