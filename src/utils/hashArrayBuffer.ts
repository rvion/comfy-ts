import { sha1Hex } from 'src/utils/sha1.ts'

export const hashArrayBuffer = (buffer: Uint8Array): string => {
   return sha1Hex(buffer)
}
