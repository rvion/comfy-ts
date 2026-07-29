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
      // object form: custom-widget values pass through verbatim, array widget
      // values ride wrapped as { __value__: [...] } (a bare 2-list is a link)
      // prettier-ignore
      [key: string]: [string, number] | string | number | boolean | null | { [key: string]: unknown }
   }
   class_type: string
}
