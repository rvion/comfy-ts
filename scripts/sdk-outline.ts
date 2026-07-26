// thin wrapper: `bun run sdk:outline` — logic lives in src/cli/outline.ts
import { runOutline } from 'src/cli/outline.ts'

process.exitCode = runOutline(process.argv.slice(2))
