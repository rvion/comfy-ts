# Per-host SDK codegen

## Why per-host namespaces

Different ComfyUI hosts have different custom nodes, models, embeddings. One
global `Comfy.IN` cannot describe two hosts. So EVERY host gets its own
namespace under `Comfy`, plus a registry entry keyed by host id:

```ts
declare global {
   namespace Comfy {
      namespace Windows1 {
         interface IN { … }        // input types per node
         interface OUT { … }       // output slots per node
         interface Node { … }      // ComfyNode<IN[k], OUT[k]> & HasSingle props
         interface Builder { … }   // one factory method per node (autocomplete surface)
         interface Slots { … }     // 'LoadImage.image' → Union[…] (per-slot enums)
         interface Accepts { … }    // everything accepted by an input of a given type
         interface Union { … }     // deduped enums (by sha1 of values)
         interface Producer { … }  // slot type → nodes able to produce it
         type Embeddings = …
         export interface HasSingle { … }
         export type Schemas / NodeType
         interface Sdk { IN, OUT, Node, Builder, … }   // the package
      }
      interface Hosts { 'windows-1': Windows1.Sdk }    // registry entry
   }
}
```

- namespace name = `hostIdToNamespace(hostId)` (PascalCase, digit-prefix guarded).
- `SdkForHost<'windows-1'>` (src/types/comfy-sdk.ts) resolves registry → precise
  types; unknown ids fall back to the permissive base `Comfy.*` interfaces.
- `ComfyWorkflow<ID>.builder` is typed `SdkForHost<ID>['Builder']` — THE bridge
  between runtime (dynamic builder) and generated types.

## Pipeline

`object_info.json` → `ComfyUIObjectInfoParsed` (unions deduped by sha1 of values,
qualified node keys via `pythonModuleToPrefix`) → `codegenSDK({ hostId, packageName? })`
(src/sdk-generator/comfyui-sdk-codegen.ts) → `.comfy-ts/hosts/<id>/sdk.d.ts`.

Regen paths:
- live: `ComfyHost.fetchAndUpdateSchema()` (on ws connect)
- offline: `bun run gen:sdk` (scripts/gen-sdk-from-cache.ts, uses cached object_info.json)

## Rules

- generated files import ONLY `'comfy-ts'` (tsconfig maps it to src/index.ts in-repo,
  consumers resolve node_modules) and are never edited by hand.
- the generated file must typecheck standalone — locally, where tsconfig picks up
  `.comfy-ts/hosts/**/sdk.d.ts`. GitHub CI never sees one (host dumps are not
  committed: they are a private machine's model inventory), so CI proves the OTHER
  half of the contract: everything typechecks with NO sdk.d.ts on disk.
- names: `E_<EnumName>` / `E_<hash>` for unions; qualified node keys like
  `impact-pack.FaceDetailer` for custom nodes, bare `KSampler` for builtins.
- autogrow containers (`template` WITH a nested `input` section, e.g.
  `TextEncodeBooguEdit.images`) never appear in `IN` under their own name —
  the declaration is never a prompt input (agent/architecture.md, converter
  section). Instead codegen emits ONE key per instance name
  (`'images.image_1'?: Accepts['IMAGE']`), typed from the template's single
  sub-input, the first `template.min` of them required when the template
  input section is required; the sub-input slot type registers into
  Accepts/Producer like any slot. ComfySchema marks the container input
  non-required so the runtime builder records no missing-value problem for
  it. Multi-sub-input templates are corpus-absent (2026-07-30 cloud sweep:
  27/27 single) — when one appears, no instance keys are emitted and the
  container stays `builderBase` territory.
- inspect big generated files with `bun run sdk:outline` — never Read 2MB blind.
