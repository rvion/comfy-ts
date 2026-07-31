/**
 * comfy-ts/web — the BROWSER entry (architecture item 13): same library,
 * in-memory storage, native WebSocket, no sharp. Types still come from a
 * generated sdk.d.ts included in the consumer's tsconfig.
 * Importing both entries in one process: the LAST import wins the default
 * backend — pass ComfyTS.create({ storage }) to be explicit (SSR setups).
 * @packageDocumentation
 */
import { createMemoryStorage, setDefaultComfyStorage } from 'src/storage/ComfyStorage.ts'

setDefaultComfyStorage(createMemoryStorage())

export * from 'src/coreExports.ts'
