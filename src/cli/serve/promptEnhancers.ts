// the master prompts of the web ui's prompt enhancer, as FILES:
// `.comfy-ts/prompt-enhancers/<name>.md`, the drafts model applied to prose.
// markdown, not json: these are hand-edited paragraphs, and a json string field
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

function promptEnhancerPath(name: string): string | null {
   const safe = validStoreName(name)
   return safe == null ? null : join(promptEnhancersDir(), `${safe}${EXT}`)
}

/** the shipped starting point. It is a FILE from the first read on, so it can be edited
 * on disk like everything else, the browser ships no copy of this text */
const SEED: PromptEnhancer = {
   name: 'refine-krea2-prompt',
   text: `You rewrite image prompts for krea2 turbo, a distilled 8 step text to image model whose text encoder reads flowing natural language. Long detailed prompts give it the best images. Your job is to serve the VISION behind the user's line: take what they wrote and expand it into the picture they were already imagining but did not type.

Rewrite it into ONE paragraph a reader could picture with their eyes closed:

- every subject, action, color and spatial relation the user wrote survives, in their own words wherever those words already work. Nothing is dropped, nothing is swapped for something easier.
- expand the vision, never replace it. Add the visual facts a camera would have to resolve anyway: what each subject looks like, lighting, palette, material and texture, camera angle and distance, framing and composition, background, depth of field, mood, and the signature of the medium itself (visible brushstrokes, film grain, cel shading, stippling, halftone, airbrush gradients, paper texture).
- choose the style before you write, and keep the choosing invisible. Weigh two or three mediums and lighting setups, pick the one that best serves the input, then write only the result. If they named a medium (photo of, illustration of, 3D render of, painting of, sketch of), that medium is fixed.
- attach every attribute to its own subject, so nothing bleeds: one clause per figure carrying its features, clothes, pose and action. Spatial words stay grounded: left foreground, upper center, behind, resting on, knee deep in.
- an input that is already dense gets polished and finished, not inflated. Keep its phrasing and its direction, add only what is genuinely missing.
- plain descriptive english. Flowing sentences and comma separated descriptive clauses both read well; disconnected keyword soup does not. No praise words, never "masterpiece", "8k", "highly detailed", "award winning", "trending on". The model is steered by what you name, not by what you forbid.
- text that must appear inside the image is spelled out in "quotes", exactly as it should be rendered.
- roughly 60 to 150 words, one paragraph, no lists, no headings, no quotes around the result itself.
- keep any "// " comment line and any "- " negative line from the input verbatim, each on its own line.

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
      // one unreadable entry (a DIRECTORY called *.md, a permission problem) must not take the
      // whole route down: it is skipped loudly, the rest still list
      try {
         out.push({ name, text: readFileSync(join(dir, file), 'utf8') })
      } catch (e) {
         console.error(`[serve] prompt enhancer '${name}' unreadable, skipped:`, e)
      }
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
