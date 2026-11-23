import type { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import type { ComfyApiJson } from 'src/sdk-generator/comfy-api-json.ts'

/** a Comfy account key, or a thunk read only when a run with a partner node starts */
export type ComfyOrgApiKeySource = string | (() => string | undefined | Promise<string | undefined>)

/** a partner API node of a prompt: what the error names */
export type PartnerApiNode = { id: string; classType: string }

/** the prompt holds a paid partner node and no Comfy account key was set */
export class ComfyOrgApiKeyMissingError extends Error {
   /** name, not instanceof: the cli bundle and dist/index.js each define this class */
   override readonly name = 'ComfyOrgApiKeyMissingError'
   constructor(
      public hostId: string,
      public nodes: PartnerApiNode[],
   ) {
      const list = nodes.map((n) => `${n.classType} #${n.id}`).join(', ')
      super(
         `🔴 host '${hostId}': the prompt holds partner API node(s) ${list}, which bill a Comfy account, and no Comfy account key is set. ` +
            `Set it with \`comfy.host({ id: '${hostId}', comfyOrgApiKey })\` or \`run({ comfyOrgApiKey })\` (a string or a thunk; the key comes from platform.comfy.org). Nothing was sent.`,
      )
   }
}

/** the nodes of a prompt whose schema says `api_node: true` */
export const partnerApiNodes = (apiJson: ComfyApiJson, schema: ComfySchema): PartnerApiNode[] => {
   const out: PartnerApiNode[] = []
   for (const [id, node] of Object.entries(apiJson))
      if (schema.nodesByNameInComfy[node.class_type]?.raw.api_node === true) out.push({ id, classType: node.class_type })
   return out
}

/** the first source set wins; an empty string counts as unset */
export const resolveComfyOrgApiKey = async (
   sources: readonly (ComfyOrgApiKeySource | undefined)[],
): Promise<string | undefined> => {
   for (const src of sources) {
      if (src == null) continue
      const key = typeof src === 'string' ? src : await src()
      if (key != null && key !== '') return key
   }
   return undefined
}
