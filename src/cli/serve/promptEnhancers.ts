// the master prompts of the web ui's prompt enhancer, as FILES:
// `.comfy-ts/prompt-enhancers/<name>.md`, the drafts model applied to prose.
// Markdown, not json: these are hand-edited paragraphs, and a json string field
// would be one escaped line. The FILENAME is the identity (a rename is a write
// plus a delete); validStoreName is the same gate the draft routes use.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'
import { validStoreName } from 'src/cli/serve/safeName.ts'

const EXT = '.md'

export type PromptEnhancer = { name: string; text: string }

export function promptEnhancersDir(): string {
   return comfyts.resolveFromPromptEnhancers('')
}

export function promptEnhancerPath(name: string): string | null {
   const safe = validStoreName(name)
   return safe == null ? null : join(promptEnhancersDir(), `${safe}${EXT}`)
}

/** the shipped starting point. It is a FILE from the first read on, so it can be edited
 * on disk like everything else — the browser ships no copy of this text */
const SEED: PromptEnhancer = {
   name: 'refine-krea2-prompt',
   text: `You rewrite image prompts for krea2 turbo, a distilled 8 step text to image model whose text encoder reads flowing natural language, not tag soup, and which is steered by adjectives rather than by negatives.

Rewrite the user's prompt into ONE dense paragraph someone could picture with their eyes closed:
- keep every noun and every named subject the user wrote, they are the point
- add what is missing to make it fun to look at: lighting, palette, material, texture, camera angle, composition, mood
- prefer concrete visual nouns over praise, never write "masterpiece", "8k", "highly detailed", "award winning"
- stay under about 80 words, no lists, no headings, no quotes around the result
- keep any "// " comment line and any "- " negative line from the input verbatim, each on its own line

Answer with the rewritten prompt and nothing else: no preamble, no explanation.
`,
}

/** seeds ONCE, on an absent folder. A folder he emptied on purpose stays empty */
export function listPromptEnhancers(): PromptEnhancer[] {
   const dir = promptEnhancersDir()
   if (!existsSync(dir)) writePromptEnhancer(SEED.name, SEED.text)
   if (!existsSync(dir)) return []
   const out: PromptEnhancer[] = []
   for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(EXT)) continue
      const name = file.slice(0, -EXT.length)
      if (validStoreName(name) == null) continue
      out.push({ name, text: readFileSync(join(dir, file), 'utf8') })
   }
   return out
}

export function writePromptEnhancer(name: string, text: string): string | null {
   const path = promptEnhancerPath(name)
   if (path == null) return null
   mkdirSync(promptEnhancersDir(), { recursive: true })
   writeFileSync(path, text)
   return path
}

/** a missing file is still a success: the caller asked for it to be gone, and it is */
export function deletePromptEnhancer(name: string): boolean {
   const path = promptEnhancerPath(name)
   if (path == null) return false
   if (existsSync(path)) rmSync(path)
   return true
}
