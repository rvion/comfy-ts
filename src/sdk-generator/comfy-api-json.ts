/**
 * the graph format comfyUI server takes as input
 *
 * !! Hasn't been updated in a while; may be out of date !!
 */
export type ComfyApiJson = {
   [nodeUID: string]: ComfyApiNodeJson
}

export type ComfyApiNodeJson = {
   inputs: {
      // prettier-ignore
      [key: string]: [string, number] | string | number | boolean | null
   }
   class_type: string
}
