import { type Either, resultFailure, resultSuccess } from '../types/index'

export type TextChunks = {
   [key: string]: string
}

export const getPngMetadataFromUint8Array = (pngData: Uint8Array): Either<string, TextChunks> => {
   const dataView = new DataView(
      pngData.buffer,
      pngData.byteOffset, // <-- it just doesn't work without this
      pngData.byteLength, // <-- it just doesn't work without this
   )

   // console.log('🟢', dataView.getUint32(0))
   // console.log('🟢', dataView)

   // Check that the PNG signature is present
   if (dataView.getUint32(0) !== 0x89504e47) {
      // 🔴 showErrorMessage('Not a valid PNG file')
      return resultFailure('Not a valid PNG file')
   }

   // Start searching for chunks after the PNG signature
   let offset = 8

   const txt_chunks: TextChunks = {}

   // Loop through the chunks in the PNG file
   while (offset < pngData.length) {
      // Get the length of the chunk
      const length = dataView.getUint32(offset)
      // Get the chunk type
      const type = String.fromCharCode(...pngData.slice(offset + 4, offset + 8))
      if (type === 'tEXt') {
         // Get the keyword
         let keyword_end = offset + 8
         while (pngData[keyword_end] !== 0) {
            keyword_end++
         }
         const keyword = String.fromCharCode(...pngData.slice(offset + 8, keyword_end))
         // Get the text
         const contentArraySegment = pngData.slice(keyword_end + 1, offset + 8 + length)
         const contentJson = Array.from(contentArraySegment)
            .map((s) => String.fromCharCode(s))
            .join('')
         txt_chunks[keyword] = contentJson
      }

      offset += 12 + length
   }

   return resultSuccess(txt_chunks)
}
