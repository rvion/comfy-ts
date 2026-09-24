// the prompt enhancer's LLM configs as FILES: `.comfy-ts/llm-configs/<name>.json`, the drafts
// model, plus its input as `.comfy-ts/enhancer-input.md`. The FILENAME is the identity (a rename is a write plus a delete), validStoreName is the
// same gate the draft routes use. SERVE-ONLY: no workflow reads these
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'
import { normalizeLlmConfig, type LlmConfig, type LlmConfigEntry } from 'src/cli/serve/llmConfigShape.ts'
import { validStoreName } from 'src/utils/safeName.ts'

const EXT = '.json'

export function llmConfigsDir(): string {
   return comfyts.resolveFromLlmConfigs('')
}

function llmConfigPath(name: string): string | null {
   const safe = validStoreName(name)
   return safe == null ? null : join(llmConfigsDir(), `${safe}${EXT}`)
}

export function listLlmConfigs(): LlmConfigEntry[] {
   const dir = llmConfigsDir()
   if (!existsSync(dir)) return []
   const out: LlmConfigEntry[] = []
   for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(EXT)) continue
      const name = file.slice(0, -EXT.length)
      if (validStoreName(name) == null) continue
      // one broken file is skipped loudly, the rest still list
      try {
         out.push({ name, config: normalizeLlmConfig(JSON.parse(readFileSync(join(dir, file), 'utf8'))) })
      } catch (e) {
         console.error(`[serve] llm config '${name}' unreadable, skipped:`, e)
      }
   }
   return out
}

export function writeLlmConfig(name: string, config: LlmConfig): string | null {
   const path = llmConfigPath(name)
   if (path == null) return null
   mkdirSync(llmConfigsDir(), { recursive: true })
   writeFileSync(path, `${JSON.stringify(normalizeLlmConfig(config), null, 3)}\n`)
   return path
}

/** the enhancer's input as you left it, so a reload (or another window) opens on it. One file,
 * markdown like the master prompts: it is a hand-written paragraph */
function enhancerInputPath(): string {
   return join(comfyts.baseFolder, 'enhancer-input.md')
}

export function readEnhancerInput(): string {
   const path = enhancerInputPath()
   return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

export function writeEnhancerInput(text: string): void {
   mkdirSync(comfyts.baseFolder, { recursive: true })
   writeFileSync(enhancerInputPath(), text)
}

/** a missing file is still a success: the caller asked for it to be gone, and it is */
export function deleteLlmConfig(name: string): boolean {
   const path = llmConfigPath(name)
   if (path == null) return false
   if (existsSync(path)) rmSync(path)
   return true
}
