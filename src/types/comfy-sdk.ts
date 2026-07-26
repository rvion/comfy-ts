import type { ComfyNode } from 'src/graph/ComfyNode.ts'
import type { ComfyNodeMetadata } from 'src/graph/ComfyNodeID.ts'
import type { ComfyNodeOutput } from 'src/graph/ComfyNodeOutput.ts'

// base (untyped) node shapes: what you get when no generated sdk is in scope
export type BaseNodeInputs = Record<string, unknown>
export type BaseNodeOutputs = Record<string, ComfyNodeOutput<string, number>>
export type BaseNode = ComfyNode<BaseNodeInputs, BaseNodeOutputs>
export type BaseNodeFactory = (inputs: BaseNodeInputs, meta?: ComfyNodeMetadata) => BaseNode

declare global {
   namespace Comfy {
      /**
       * registry of generated per-host SDKs.
       * each generated `output/hosts/<id>/sdk.d.ts` merges one entry:
       *
       *    interface Hosts { 'windows-1': Windows1.Sdk }
       *
       * `SdkForHost<'windows-1'>` then resolves to the precise types of that host.
       */
      interface Hosts {}

      // ---- permissive base surface --------------------------------------
      // lets the library itself (and untyped consumers) typecheck with NO
      // generated sdk around. generated per-host namespaces provide the
      // precise versions of these under Comfy.<HostNs>.*
      interface Accepts {
         [slotTypeName: string]: unknown
      }
      interface Slots {
         [slotName: string]: string
      }
      interface Union {
         [unionName: string]: string | number | boolean
      }
      interface IN {
         [nodeName: string]: BaseNodeInputs
      }
      interface OUT {
         [nodeName: string]: BaseNodeOutputs
      }
      interface Node {
         [nodeName: string]: BaseNode
      }
      interface Builder {
         [nodeName: string]: BaseNodeFactory
      }
      interface Producer {
         [slotTypeName: string]: Partial<Builder>
      }
   }
}

/** the shape every generated per-host Sdk interface follows */
export interface ComfySdkShape {
   IN: object
   OUT: object
   Node: object
   Builder: object
   Slots: object
   Accepts: object
   Union: object
   Producer: object
   Embeddings: string
}

/** fallback sdk: the permissive base surface above */
export interface ComfySdkBase extends ComfySdkShape {
   IN: Comfy.IN
   OUT: Comfy.OUT
   Node: Comfy.Node
   Builder: Comfy.Builder
   Slots: Comfy.Slots
   Accepts: Comfy.Accepts
   Union: Comfy.Union
   Producer: Comfy.Producer
   Embeddings: string
}

/**
 * resolve the sdk types for a given host id:
 * precise generated types when `Comfy.Hosts` has an entry, base types otherwise.
 *
 * The `[keyof Comfy.Hosts] extends [never]` guard is load-bearing, not style:
 * with an EMPTY registry (no sdk.d.ts anywhere, i.e. a fresh clone or a consumer
 * before their first codegen) `ID extends keyof Comfy.Hosts` stays a DEFERRED
 * conditional for any generic ID. A deferred type in the contravariant `build`
 * parameter of DefineWorkflowSpec makes `ComfyHost<ID>` unassignable to
 * `ComfyHost<string>`, and 10 errors erupt across state/ComfyHost/ComfyWorkflow/
 * MediaImage. Resolving to the base sdk EAGERLY when the registry is empty keeps
 * the library typechecking with nothing generated on disk (frozen invariant).
 */
export type SdkForHost<ID extends string> = [keyof Comfy.Hosts] extends [never]
   ? ComfySdkBase
   : ID extends keyof Comfy.Hosts
     ? Comfy.Hosts[ID] extends ComfySdkShape
        ? Comfy.Hosts[ID]
        : ComfySdkBase
     : ComfySdkBase

/** the typed node K of host ID (falls back to BaseNode when unknown) */
export type NodeOf<ID extends string, K extends string> = SdkForHost<ID>['Node'] extends infer N
   ? K extends keyof N
      ? N[K]
      : BaseNode
   : BaseNode
