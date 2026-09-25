/** the default name of a duplicate: a trailing number is incremented (`shot 007` → `shot 008`,
 * zero padding kept), anything else gets `-2`. Never returns a name in `taken` */
export function copyName(name: string, taken: readonly string[]): string {
   const m = /^(.*?)(\d+)$/.exec(name)
   if (m == null) return copyName(`${name}-1`, taken)
   const prefix = m[1] ?? ''
   const digits = m[2] ?? ''
   for (let n = Number(digits) + 1; ; n++) {
      const candidate = `${prefix}${String(n).padStart(digits.length, '0')}`
      if (!taken.includes(candidate)) return candidate
   }
}
