import type { Maybe } from '../types'
import { bong } from '../utils/bang'
import { type ExifData, parseExifData } from './_parseExifData'

export const getWebpMetadataFromUint8Array = (webp: Uint8Array): Maybe<ExifData> => {
   const dataView = new DataView(webp.buffer)

   // Check that the WEBP signature is present
   if (dataView.getUint32(0) !== 0x52494646 || dataView.getUint32(8) !== 0x57454250) {
      console.error('Not a valid WEBP file')
      // r()
      return null
   }

   // Start searching for chunks after the WEBP signature
   let offset = 12
   const txt_chunks: ExifData = {}
   // Loop through the chunks in the WEBP file
   while (offset < webp.length) {
      const chunk_length = dataView.getUint32(offset + 4, true)
      const chunk_type = String.fromCharCode(...webp.slice(offset, offset + 4))
      if (chunk_type === 'EXIF') {
         if (String.fromCharCode(...webp.slice(offset + 8, offset + 8 + 6)) === 'Exif\0\0') {
            offset += 6
         }
         const data = parseExifData(webp.slice(offset + 8, offset + 8 + chunk_length))
         for (const key in data) {
            const value = bong(data[key])
            const index = value.indexOf(':')
            txt_chunks[value.slice(0, index)] = value.slice(index + 1)
         }
      }

      offset += 8 + chunk_length
   }

   return txt_chunks
}
