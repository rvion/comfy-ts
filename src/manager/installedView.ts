/**
 * PURE builders of the public plugin and model lists where the Manager serves none (4.x default ui),
 * from our mirror and what the host reports (agent/architecture.md, Manager HTTP client).
 * A row the data cannot decide is left OUT (reads `unknown`), never given a guessed status.
 */
import { type } from 'arktype'
import type { KnownComfyPluginTitle } from 'src/manager/generated/KnownComfyPluginTitle.ts'
import type { ComfyManagerAPIModelList } from 'src/manager/types/ComfyManagerAPIModelList.ts'
import type { ComfyManagerAPIPluginList } from 'src/manager/types/ComfyManagerAPIPluginList.ts'
import type { ComfyManagerModelInfo } from 'src/manager/types/ComfyManagerModelInfo.ts'
import type { ComfyManagerPluginInfo } from 'src/manager/types/ComfyManagerPluginInfo.ts'

/** the part of the registry the views read */
export type ManagerMirror = {
   plugins_byTitle: ReadonlyMap<KnownComfyPluginTitle, ComfyManagerPluginInfo>
   /** every model row: upstream ships a few names twice, with different files */
   modelRows: readonly ComfyManagerModelInfo[]
}

/** `GET customnode/installed`: a disk scan, keyed by directory */
export const InstalledPacks_ark = type.Record(
   'string',
   type({ 'cnr_id?': 'string | null', 'aux_id?': 'string | null', enabled: 'boolean' }),
)
export type InstalledPacks = typeof InstalledPacks_ark.infer

/** `GET customnode/getmappings`: the extension-node-map, registered repos rekeyed by registry id */
export const PackMappings_ark = type.Record('string', type(['string[]', { 'title_aux?': 'string' }]))
export type PackMappings = typeof PackMappings_ark.infer

/** `https://github.com/Owner/Repo.git/` → `owner/repo` */
export const repoPath = (url: string): string =>
   url
      .toLowerCase()
      .replace(/\/+$/, '')
      .replace(/\.git$/, '')
      .split('/')
      .slice(-2)
      .join('/')

/** one installed pack, joined to the mirror when the data allows it */
export type AttributedPack = { enabled: boolean; repo: string | null; title: string | null; id: string }

/** git clone → its `owner/repo`; registry install → its registry id's `title_aux` (= the mirror title) */
export const attributePacks = (installed: InstalledPacks, mappings: PackMappings): AttributedPack[] => {
   // registry ids are case insensitive: the mappings keep the registry's casing, the scan lowercases
   const titleById = new Map(Object.entries(mappings).map(([k, v]) => [k.toLowerCase(), v[1].title_aux]))
   return Object.entries(installed).map(([dir, p]) => {
      const aux = p.aux_id ?? null
      const cnr = p.cnr_id != null && p.cnr_id !== '' ? p.cnr_id : null
      const repo = aux != null && aux.includes('/') ? repoPath(aux) : null
      const title = cnr != null ? (titleById.get(cnr.toLowerCase()) ?? null) : null
      return { enabled: p.enabled, repo, title, id: cnr ?? aux ?? dir }
   })
}

/** is this mirror row among the attributed packs, enabled? */
export const packIsInstalled = (
   packs: AttributedPack[],
   plugin: { title: string; files: string[]; reference: string },
): boolean => {
   const repo = repoPath(plugin.files[0] ?? plugin.reference)
   return packs.some((p) => p.enabled && (p.repo === repo || p.title === plugin.title))
}

export const buildPluginView = (p: {
   mirror: ManagerMirror
   installed: InstalledPacks
   mappings: PackMappings
}): { list: ComfyManagerAPIPluginList; unattributed: string[] } => {
   const packs = attributePacks(p.installed, p.mappings)
   const plugins = [...p.mirror.plugins_byTitle.values()]
   const mirrorRepos = new Set(plugins.flatMap((x) => x.files.map(repoPath)))
   const mirrorTitles = new Set<string>(plugins.map((x) => x.title))
   const joins = (x: AttributedPack): boolean =>
      (x.repo != null && mirrorRepos.has(x.repo)) || (x.title != null && mirrorTitles.has(x.title))
   // a git clone whose repo the mirror lacks is no mirror row; an enabled pack known by no repo that joins
   // nothing could be one (a disabled one reads `False` whichever row it is, like a missing one)
   const unattributed = packs.filter((x) => x.enabled && x.repo == null && !joins(x))
   const serverTitles = new Set(
      Object.values(p.mappings).flatMap((v) => (v[1].title_aux != null ? [v[1].title_aux] : [])),
   )
   const custom_nodes: ComfyManagerAPIPluginList['custom_nodes'] = []
   for (const plugin of plugins) {
      const repo = repoPath(plugin.files[0] ?? plugin.reference)
      const joined = packs.filter((x) => x.repo === repo || x.title === plugin.title)
      if (joined.some((x) => x.enabled)) custom_nodes.push({ title: plugin.title, installed: 'True' })
      // an unattributed registry install can only be a row the server's mappings do not name
      else if (joined.length === 0 && unattributed.length > 0 && !serverTitles.has(plugin.title)) continue
      else custom_nodes.push({ title: plugin.title, installed: 'False' })
   }
   return { list: { chanel: 'default', custom_nodes }, unattributed: unattributed.map((x) => x.id) }
}

/** the Manager's `type` → folder map for `save_path: default` (model_utils.get_model_dir, 4.4) */
const DEFAULT_FOLDER_BY_TYPE: Record<string, string> = {
   checkpoints: 'checkpoints',
   checkpoint: 'checkpoints',
   unclip: 'checkpoints',
   text_encoders: 'text_encoders',
   clip: 'text_encoders',
   vae: 'vae',
   lora: 'loras',
   't2i-adapter': 'controlnet',
   't2i-style': 'controlnet',
   controlnet: 'controlnet',
   clip_vision: 'clip_vision',
   gligen: 'gligen',
   upscale: 'upscale_models',
   embedding: 'embeddings',
   embeddings: 'embeddings',
   unet: 'diffusion_models',
   diffusion_model: 'diffusion_models',
}

/** what core `get_filename_list` lists in the standard folders */
const LISTED_EXTENSIONS = ['.ckpt', '.pt', '.pt2', '.bin', '.pth', '.safetensors', '.pkl', '.sft']

/**
 * where this model counts as installed, in core's `/models/<folder>` terms; null when not decidable.
 * The Manager's own check accepts the folder root as well as the `save_path` sub folder.
 */
export const modelLocation = (m: ComfyManagerModelInfo): { folder: string; files: string[] } | null => {
   if (m.filename === '<huggingface>' || /[\\/:]/.test(m.filename)) return null
   if (!LISTED_EXTENSIONS.some((ext) => m.filename.toLowerCase().endsWith(ext))) return null
   if (m.save_path === 'default') {
      const folder = DEFAULT_FOLDER_BY_TYPE[m.type.toLowerCase()]
      return folder == null ? null : { folder, files: [m.filename] }
   }
   const parts = m.save_path
      .replaceAll('\\', '/')
      .split('/')
      .filter((s) => s !== '')
   const folder = parts[0]
   if (folder == null || folder === 'custom_nodes' || parts.includes('..')) return null
   const sub = [...parts.slice(1), m.filename].join('/')
   return { folder, files: sub === m.filename ? [m.filename] : [m.filename, sub] }
}

export const buildModelView = (p: {
   models: readonly ComfyManagerModelInfo[]
   /** registered folder → its relative file paths, for the folders core lists */
   files: ReadonlyMap<string, readonly string[]>
}): ComfyManagerAPIModelList => {
   const listed = new Map(
      [...p.files].map(([folder, files]) => [folder, new Set(files.map((f) => f.replaceAll('\\', '/')))]),
   )
   const statusOf = (m: ComfyManagerModelInfo): 'True' | 'False' | null => {
      const at = modelLocation(m)
      const files = at == null ? null : listed.get(at.folder)
      if (at == null || files == null) return null
      return at.files.some((f) => files.has(f)) ? 'True' : 'False'
   }
   const byName = new Map<string, ComfyManagerModelInfo[]>()
   for (const m of p.models) byName.set(m.name, [...(byName.get(m.name) ?? []), m])
   const models: ComfyManagerAPIModelList['models'] = []
   for (const rows of byName.values()) {
      // a name shipped twice with different files is decided only when every row agrees
      const statuses = new Set(rows.map(statusOf))
      const first = rows[0]
      const installed = statuses.size === 1 ? [...statuses][0] : null
      if (first == null || installed == null) continue
      models.push({
         name: first.name,
         installed,
         filename: first.filename,
         save_path: first.save_path,
         base: first.base,
      })
   }
   return { models }
}

/** the folders the views need listed */
export const modelFolders = (models: Iterable<ComfyManagerModelInfo>): Set<string> =>
   new Set([...models].flatMap((m) => modelLocation(m)?.folder ?? []))
