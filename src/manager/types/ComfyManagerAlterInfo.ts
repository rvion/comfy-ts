import { type } from 'arktype'

/** ONE alter-list.json row (a1111 extension → comfy alternative); `tags` is a comma-separated STRING upstream */
export type ComfyManagerAlterInfo = typeof ComfyManagerAlterInfo_ark.infer
export const ComfyManagerAlterInfo_ark = type({
   id: 'string', // "https://github.com/comfyanonymous/ComfyUI"
   tags: 'string', // "SD1.x,SD2.x,SDXL"
   description: 'string',
})

/** root shape only: rows are validated ONE BY ONE */
export type ComfyManagerFileAlterListRoot = typeof ComfyManagerFileAlterListRoot_ark.infer
export const ComfyManagerFileAlterListRoot_ark = type({ items: 'unknown[]' })
