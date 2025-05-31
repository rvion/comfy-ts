import { type } from 'arktype'

export type ComfyManagerPluginContentMetadata = typeof ComfyManagerPluginContentMetadata_ark.infer
export const ComfyManagerPluginContentMetadata_ark = type({
   // optional because on damn validation on comfy manager! 😬
   // should have been always present
   title_aux: type.string.or(type.null), // "Jovimetrix Composition Nodes",

   // optional
   'author?': 'string', // "amorano",
   'nickname?': 'string', // "Comfy Deploy",
   'description?': 'string', // "Webcams, GLSL shader, Media Streaming, Tick animation, Image manipulation,",
   'nodename_pattern?': 'string', // " \\(jov\\)$",
   'title?': 'string', // "Jovimetrix",
   'preemptions?': 'string[]', // ❓
})
