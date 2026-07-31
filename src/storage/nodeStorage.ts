// the ONLY core-path module allowed to import node:fs statically
// (architecture item 13) — index.ts installs it; the web graph never sees it
import * as fs from 'node:fs'
import * as os from 'node:os'
import { type ComfyStorage, createNodeStorageFrom } from 'src/storage/ComfyStorage.ts'

export function createNodeStorage(): ComfyStorage {
   return createNodeStorageFrom(fs, os)
}
