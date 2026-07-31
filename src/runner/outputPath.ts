/**
 * local output naming, relative to `.comfy-ts/outputs/`:
 * the server filename is NOT unique — cloud hosts reset the
 * `_00001_` counter every run, so trusting it overwrote the same file — and
 * a `foo/krea/` prefix means the DIRECTORY foo/krea/, not a `krea_` name
 * prefix. Local names are ours: dir from the prompt's own filename_prefix
 * (or an explicit save.prefix override), then
 * `<stem>_<timestamp>_<counter><ext>` so every run sorts chronologically
 * per stem and nothing ever collides.
 */
export const localOutputPath = (p: {
   /** explicit local dir override (SaveOptions.prefix) — wins when set */
   localDir?: string
   /** the SaveImage node's own filename_prefix as sent in the prompt */
   filenamePrefix?: string
   /** server-reported subfolder (fallback when no prefix is known) */
   subfolder: string
   /** server-reported filename, e.g. krea_00001_.png */
   filename: string
   /** run timestamp, YYYYMMDD-HHmmss */
   timestamp: string
}): string => {
   // server name → stem / counter / extension: `krea_00001_.png`
   const dot = p.filename.lastIndexOf('.')
   const ext = dot === -1 ? '' : p.filename.slice(dot)
   const base = dot === -1 ? p.filename : p.filename.slice(0, dot)
   const counterMatch = /_(\d+)_$/.exec(base)
   const counter = counterMatch?.[1]
   const serverStem = counterMatch != null ? base.slice(0, base.length - counterMatch[0].length) : base

   // directory + stem intent: explicit local dir > prompt prefix > server
   // layout. The stem SURVIVES a localDir override — identity keeps sorting
   let dir: string
   let stem: string
   if (p.filenamePrefix != null && p.filenamePrefix !== '') {
      const slash = p.filenamePrefix.lastIndexOf('/')
      dir = slash === -1 ? '' : p.filenamePrefix.slice(0, slash)
      stem = slash === -1 ? p.filenamePrefix : p.filenamePrefix.slice(slash + 1)
   } else {
      dir = p.subfolder
      stem = serverStem
   }
   if (p.localDir != null) dir = p.localDir

   const name = [stem === '' ? null : stem, p.timestamp, counter].filter((x) => x != null).join('_') + ext
   return dir === '' ? name : `${dir}/${name}`
}

/** REPLACE the extension (never append one): a re-encoded save owns its whole
 * name now that local naming is ours, so `save: {format:'image/webp'}` writes
 * `shot_20260731-154210_00001.webp`, not `…_00001.png.webp` — appending
 * described the bytes twice and the first description was a lie */
export const withExtension = (path: string, ext: string): string => {
   const slash = path.lastIndexOf('/')
   const dot = path.lastIndexOf('.')
   const stem = dot > slash ? path.slice(0, dot) : path
   return `${stem}.${ext}`
}

/**
 * never-overwrite guard: bump `-2`, `-3`, … while the path exists on disk OR
 * was already CLAIMED by a still-downloading retrieval (two same-second runs
 * on a counter-resetting cloud host compute the same name).
 * The chosen path is claimed before returning.
 */
export const uniquifyOutputPath = (p: {
   path: string
   exists: (path: string) => boolean
   claimed: Set<string>
}): string => {
   let out = p.path
   if (p.exists(out) || p.claimed.has(out)) {
      const dot = out.lastIndexOf('.')
      const stem = dot === -1 ? out : out.slice(0, dot)
      const ext = dot === -1 ? '' : out.slice(dot)
      for (let n = 2; p.exists(out) || p.claimed.has(out); n++) out = `${stem}-${n}${ext}`
   }
   p.claimed.add(out)
   return out
}

/** YYYYMMDD-HHmmss, local time — sortable, text-encodable, no colons for filesystems */
export const runTimestamp = (d: Date): string => {
   const pad = (n: number): string => String(n).padStart(2, '0')
   return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
