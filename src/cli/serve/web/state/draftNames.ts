// the names new and duplicate give a draft without asking: rename is one click away, a prompt on
// every copy is not. PURE, tests/serve-web-draft-names.test.ts
import { copyName } from 'src/utils/copyName.ts'

/** `new`, `new 2`, … the first name no draft of this workflow has */
export function freeDraftName(drafts: readonly string[]): string {
   if (!drafts.includes('new')) return 'new'
   let n = 2
   while (drafts.includes(`new ${n}`)) n++
   return `new ${n}`
}

/** `shot 007` → `shot 008`, `default` → `default-2`, never a name already taken */
export function duplicateDraftName(from: string, drafts: readonly string[]): string {
   return copyName(from, drafts)
}
