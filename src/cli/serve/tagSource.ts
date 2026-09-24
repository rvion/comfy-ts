// where a prompt's tag list comes from: `v.prompt(…, { tags })` names a url, serve reads it once and
// keeps it in memory. The list never ships with the code: a remote one is fetched on first use and
// kept under the cache dir, a local one is re-read when its file changes
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'pathe'
import { TagList } from 'src/cli/serve/tagList.ts'
import { sha1HexOfString } from 'src/utils/sha1.ts'

export type TagSourceRef = { kind: 'file'; path: string } | { kind: 'http'; url: string }

/** http(s) stays a url; `file://`, `~/`, absolute and relative (to the workflow file) become a path */
export function resolveTagSource(url: string, moduleFile: string): TagSourceRef {
   if (/^https?:\/\//i.test(url)) return { kind: 'http', url }
   if (url.startsWith('file://')) return { kind: 'file', path: fileURLToPath(url) }
   if (url === '~' || url.startsWith('~/')) return { kind: 'file', path: join(homedir(), url.slice(1)) }
   if (isAbsolute(url)) return { kind: 'file', path: url }
   return { kind: 'file', path: resolve(dirname(moduleFile), url) }
}

export class TagSources {
   private files = new Map<string, { mtimeMs: number; list: TagList }>()
   private remote = new Map<string, Promise<TagList>>()

   constructor(
      private p: {
         /** where remote lists are kept between runs */
         cacheDir: () => string
         /** a capped download: a tag list url pointing at something huge must not exhaust serve */
         fetchText: (url: string) => Promise<string>
      },
   ) {}

   async load(ref: TagSourceRef): Promise<TagList> {
      if (ref.kind === 'file') return this.loadFile(ref.path)
      const hit = this.remote.get(ref.url)
      if (hit != null) return hit
      const pending = this.loadRemote(ref.url)
      this.remote.set(ref.url, pending)
      // a failure is not remembered: the next keystroke retries (the network may be back)
      pending.catch(() => this.remote.delete(ref.url))
      return pending
   }

   private loadFile(path: string): TagList {
      if (!existsSync(path)) throw new Error(`tag list not found: ${path}`)
      const mtimeMs = statSync(path).mtimeMs
      const cached = this.files.get(path)
      if (cached != null && cached.mtimeMs === mtimeMs) return cached.list
      const list = TagList.parse(readFileSync(path, 'utf8'))
      if (list.entries.length === 0) throw new Error(`tag list is empty: ${path}`)
      this.files.set(path, { mtimeMs, list })
      return list
   }

   private async loadRemote(url: string): Promise<TagList> {
      const file = join(this.p.cacheDir(), `${sha1HexOfString(url)}.txt`)
      if (existsSync(file)) return TagList.parse(readFileSync(file, 'utf8'))
      console.log(`[serve] fetching tag list ${url}`)
      const text = await this.p.fetchText(url)
      const list = TagList.parse(text)
      if (list.entries.length === 0) throw new Error(`tag list is empty: ${url}`)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
      console.log(`[serve] tag list ${url}: ${list.entries.length} tags, kept in ${file}`)
      return list
   }
}
