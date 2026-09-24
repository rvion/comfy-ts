// a booru tag list in memory: parsed once per source, searched per keystroke. PURE (text in, hits
// out). Formats: the a1111 tagcomplete csv `name,category,count,"alias,alias"`, or one tag per line

export type TagEntry = { name: string; category: number | null; count: number; aliases: string[] }
export type TagHit = { name: string; category: number | null; count: number; alias?: string }

/** one csv line, double-quoted fields with `""` escapes */
function csvFields(line: string): string[] {
   const out: string[] = []
   let cur = ''
   let quoted = false
   for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quoted) {
         if (ch === '"' && line[i + 1] === '"') {
            cur += '"'
            i++
         } else if (ch === '"') quoted = false
         else cur += ch
      } else if (ch === '"') quoted = true
      else if (ch === ',') {
         out.push(cur)
         cur = ''
      } else cur += ch
   }
   out.push(cur)
   return out
}

const intOrNull = (s: string | undefined): number | null => (s != null && /^\d+$/.test(s.trim()) ? Number(s) : null)

export function parseTagList(text: string): TagEntry[] {
   const out: TagEntry[] = []
   for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (line === '' || line.startsWith('#')) continue
      const f = csvFields(line)
      const name = (f[0] ?? '').trim()
      if (name === '') continue
      // `name,count` (two columns) is a counted plain list; three and more is the tagcomplete shape
      const twoCols = f.length === 2
      out.push({
         name,
         category: twoCols ? null : intOrNull(f[1]),
         count: (twoCols ? intOrNull(f[1]) : intOrNull(f[2])) ?? 0,
         aliases: (f[3] ?? '')
            .split(',')
            .map((a) => a.trim())
            .filter((a) => a !== ''),
      })
   }
   return out
}

/** the searchable form: lowercase, spaces as underscores (the lists write `long_hair`) */
const key = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '_')

export class TagList {
   private rows: { e: TagEntry; name: string; aliases: string[] }[]
   constructor(public readonly entries: TagEntry[]) {
      this.rows = entries.map((e) => ({ e, name: key(e.name), aliases: e.aliases.map(key) }))
      this.rows.sort((a, b) => b.e.count - a.e.count)
   }

   static parse(text: string): TagList {
      return new TagList(parseTagList(text))
   }

   /** prefix of the name first, then prefix of an alias (answered with the name it points to),
    * then a word inside the name (`hair` finds `long_hair`), each by post count */
   search(query: string, limit = 20): TagHit[] {
      const q = key(query)
      if (q === '') return []
      const hits: TagHit[] = []
      const seen = new Set<string>()
      const take = (e: TagEntry, alias?: string): boolean => {
         if (seen.has(e.name)) return false
         seen.add(e.name)
         hits.push(alias == null ? { name: e.name, category: e.category, count: e.count } : { ...pick(e), alias })
         return hits.length >= limit
      }
      for (const r of this.rows) if (r.name.startsWith(q) && take(r.e)) return hits
      for (const r of this.rows) {
         const a = r.aliases.find((x) => x.startsWith(q))
         if (a != null && take(r.e, a)) return hits
      }
      for (const r of this.rows) if (r.name.includes(`_${q}`) && take(r.e)) return hits
      return hits
   }
}

const pick = (e: TagEntry): TagHit => ({ name: e.name, category: e.category, count: e.count })
