import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { listDraftsInDir } from 'src/cli/tui/state/DraftsSt.ts'

function dirWith(names: string[]): string {
   const dir = mkdtempSync(join(tmpdir(), 'comfy-ts-draft-sort-'))
   for (const n of names) writeFileSync(join(dir, `${n}.json`), '{}')
   return dir
}

// why we think it is actually a bug, and not just meaning spec should change: the numbers are
// copy counters, so plain string order puts copy 11 before copy 2 and the picker reads shuffled
test('draft names sort by the number they carry, not by character', () => {
   const dir = dirWith(['default-2', 'default-11', 'default', 'default-1', 'default-3', 'default-12'])
   expect(listDraftsInDir(dir)).toEqual(['default', 'default-1', 'default-2', 'default-3', 'default-11', 'default-12'])
})

test('control: names without numbers keep alphabetical order', () => {
   expect(listDraftsInDir(dirWith(['portrait', 'default', 'landscape']))).toEqual(['default', 'landscape', 'portrait'])
})
