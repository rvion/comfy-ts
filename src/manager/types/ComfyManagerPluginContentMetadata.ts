import { type } from 'arktype'

export type ComfyManagerPluginContentMetadata = typeof ComfyManagerPluginContentMetadata_ark.infer
export const ComfyManagerPluginContentMetadata_ark = type({
   // absent on 10/5573 upstream rows (2026-07-30), null on others
   'title_aux?': type.string.or(type.null), // "Jovimetrix Composition Nodes",

   // optional
   'author?': 'string', // "amorano",
   'nickname?': 'string', // "Comfy Deploy",
   'description?': 'string', // "Webcams, GLSL shader, Media Streaming, Tick animation, Image manipulation,",
   'nodename_pattern?': 'string', // " \\(jov\\)$",
   'title?': 'string', // "Jovimetrix",
   'preemptions?': 'string[]', // ❓
})
