/** narrows unknown wire json to an indexable object (arrays and null excluded) */
export function isRecord(v: unknown): v is Record<string, unknown> {
   return typeof v === 'object' && v !== null && !Array.isArray(v)
}
