import { ansi as chalk } from 'src/utils/ansi.ts'
import { downloadFile } from 'src/utils/downloadFile.ts'

// canonical repo since the ltdrdata → Comfy-Org move; the old ltdrdata raw
// urls still redirect here but that is goodwill, not contract (2026-07-30)
const MANAGER_RAW_BASE = 'https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main'

const MANAGER_MIRROR_FILES = [
   'custom-node-list.json',
   'model-list.json',
   'extension-node-map.json',
   'alter-list.json',
   'github-stats.json',
] as const

export async function DownloadComfyManagerJSONs(): Promise<void> {
   for (const file of MANAGER_MIRROR_FILES) {
      const dest = `src/manager/json/${file}`
      await downloadFile(`${MANAGER_RAW_BASE}/${file}`, dest, `- downloading ${file}...`)
      console.log(`  saved at ${chalk.blue(dest)}`)
   }
}
