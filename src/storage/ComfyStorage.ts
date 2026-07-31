// the storage seam (architecture item 13): ONE sync fs-subset interface the
// core path talks to. Node gets the real fs, the web entry an in-memory Map.
// This file must stay browser-safe: no node imports, ever.

export type ComfyStorage = {
   /** backend name, for error messages */
   kind: string
   /** throws when missing */
   readText(path: string): string
   readTextIfExists(path: string): string | null
   /** throws when missing */
   readBytes(path: string): Uint8Array
   /** parents are created (mkdirp implied) */
   writeText(path: string, text: string): void
   /** parents are created (mkdirp implied) */
   writeBytes(path: string, bytes: Uint8Array): void
   exists(path: string): boolean
   mkdirp(path: string): void
   /** file mtime in ms; null when missing */
   mtimeMs(path: string): number | null
   homedir(): string
   cwd(): string
}

/** the fs/os surface createNodeStorageFrom needs — structural, so this file
 * never imports node types into the web graph */
export type NodeFsLike = {
   readFileSync(path: string, encoding?: 'utf8'): string | Uint8Array
   writeFileSync(path: string, data: string | Uint8Array): void
   existsSync(path: string): boolean
   mkdirSync(path: string, opts: { recursive: boolean }): unknown
   statSync(path: string): { mtimeMs: number; isFile(): boolean }
}
export type NodeOsLike = { homedir(): string }

function dirnameOf(path: string): string {
   const ix = path.lastIndexOf('/')
   return ix <= 0 ? '/' : path.slice(0, ix)
}

/** node backend built from INJECTED modules: nodeStorage.ts passes its static
 * imports, the autodetect below passes process.getBuiltinModule results */
export function createNodeStorageFrom(fs: NodeFsLike, os: NodeOsLike): ComfyStorage {
   return {
      kind: 'node',
      readText: (p) => fs.readFileSync(p, 'utf8') as string,
      readTextIfExists: (p) => (fs.existsSync(p) ? (fs.readFileSync(p, 'utf8') as string) : null),
      readBytes: (p) => new Uint8Array(fs.readFileSync(p) as Uint8Array),
      writeText: (p, text) => {
         fs.mkdirSync(dirnameOf(p), { recursive: true })
         fs.writeFileSync(p, text)
      },
      writeBytes: (p, bytes) => {
         fs.mkdirSync(dirnameOf(p), { recursive: true })
         fs.writeFileSync(p, bytes)
      },
      exists: (p) => fs.existsSync(p),
      mkdirp: (p) => void fs.mkdirSync(p, { recursive: true }),
      mtimeMs: (p) => (fs.existsSync(p) ? fs.statSync(p).mtimeMs : null),
      homedir: () => os.homedir(),
      cwd: () => process.cwd(),
   }
}

/** in-memory backend: the web default, also handy for hermetic tests.
 * Paths are LITERAL keys (no normalization — core callers resolve through
 * pathe/comfyts already). exists() knows written files and EXPLICIT mkdirp
 * dirs only, never implicit parents. Bytes are copied in AND out so neither
 * side can mutate the store. */
export function createMemoryStorage(p: { homedir?: string; cwd?: string } = {}): ComfyStorage {
   const files = new Map<string, Uint8Array>()
   const mtimes = new Map<string, number>()
   const dirs = new Set<string>()
   const td = new TextDecoder()
   const te = new TextEncoder()
   const write = (path: string, bytes: Uint8Array): void => {
      files.set(path, bytes.slice())
      mtimes.set(path, Date.now())
   }
   return {
      kind: 'memory',
      readText: (path) => {
         const hit = files.get(path)
         if (hit == null) throw new Error(`[memory storage] no such file: ${path}`)
         return td.decode(hit)
      },
      readTextIfExists: (path) => {
         const hit = files.get(path)
         return hit == null ? null : td.decode(hit)
      },
      readBytes: (path) => {
         const hit = files.get(path)
         if (hit == null) throw new Error(`[memory storage] no such file: ${path}`)
         return hit.slice()
      },
      writeText: (path, text) => write(path, te.encode(text)),
      writeBytes: write,
      exists: (path) => files.has(path) || dirs.has(path),
      mkdirp: (path) => void dirs.add(path),
      mtimeMs: (path) => mtimes.get(path) ?? null,
      homedir: () => p.homedir ?? '/home/web',
      cwd: () => p.cwd ?? '/',
   }
}

// ---- default resolution (architecture item 13) ------------------------------
// explicit ComfyTS.create({storage}) → entry-installed default → node builtins
// autodetect (node 22+/bun: no static import needed) → loud throw.

let installedDefault: ComfyStorage | null = null

/** entries call this at import time: index.ts installs node, web.ts memory */
export function setDefaultComfyStorage(storage: ComfyStorage): void {
   installedDefault = storage
}

function autodetectNodeStorage(): ComfyStorage | null {
   const get = globalThis.process?.getBuiltinModule
   if (typeof get !== 'function') return null
   const fs = get('node:fs') as NodeFsLike | undefined
   const os = get('node:os') as NodeOsLike | undefined
   if (fs == null || os == null) return null
   return createNodeStorageFrom(fs, os)
}

export function resolveComfyStorage(explicit?: ComfyStorage): ComfyStorage {
   if (explicit != null) return explicit
   if (installedDefault != null) return installedDefault
   const detected = autodetectNodeStorage()
   if (detected != null) {
      installedDefault = detected
      return detected
   }
   throw new Error(
      `no ComfyStorage available — import 'comfy-ts' (node) or 'comfy-ts/web' (browser) before creating ComfyTS, or pass ComfyTS.create({ storage })`,
   )
}

/** the ONE accessor call sites use: the instance's storage when the global
 * exists, the resolved default otherwise (vars constructed before create()) */
export function getComfyStorage(): ComfyStorage {
   const g = globalThis as { comfyts?: { storage?: ComfyStorage } }
   return g.comfyts?.storage ?? resolveComfyStorage()
}
