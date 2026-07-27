// cp1252's 0x80-0x9F specials, unicode → original byte (the rest is latin1: code = byte)
const CP1252_REVERSE: Record<string, number> = {
   '€': 0x80,
   '‚': 0x82,
   ƒ: 0x83,
   '„': 0x84,
   '…': 0x85,
   '†': 0x86,
   '‡': 0x87,
   ˆ: 0x88,
   '‰': 0x89,
   Š: 0x8a,
   '‹': 0x8b,
   Œ: 0x8c,
   Ž: 0x8e,
   '‘': 0x91,
   '’': 0x92,
   '“': 0x93,
   '”': 0x94,
   '•': 0x95,
   '–': 0x96,
   '—': 0x97,
   '˜': 0x98,
   '™': 0x99,
   š: 0x9a,
   '›': 0x9b,
   œ: 0x9c,
   ž: 0x9e,
   Ÿ: 0x9f,
}

/**
 * repair UTF-8 that was decoded as cp1252 (a Windows server re-reading its own
 * output: `█` E2 96 88 arrives as `â–ˆ`). Reverses the cp1252 map back to
 * bytes and re-decodes as UTF-8; any unmappable char or invalid byte sequence
 * means the text was NOT mojibake — the original is returned untouched.
 */
export function repairMojibake(s: string): string {
   let suspicious = false
   for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) > 0x7f) {
         suspicious = true
         break
      }
   }
   if (!suspicious) return s
   const bytes = new Uint8Array(s.length)
   for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i)
      if (code <= 0xff) {
         bytes[i] = code
         continue
      }
      const mapped = CP1252_REVERSE[s[i] ?? '']
      if (mapped == null) return s
      bytes[i] = mapped
   }
   const decoded = Buffer.from(bytes).toString('utf8')
   return decoded.includes('�') ? s : decoded
}
