---
description: Convert a ComfyUI workflow JSON (a saved workflow.json, an exported api.json, an official template) into a typed comfy-ts workflow module (*.cflow.ts). Use when the user has a ComfyUI JSON and wants it as TypeScript.
argument-hint: "[workflow.json] [module-name]"
---

Convert this ComfyUI JSON into a comfy-ts module: $ARGUMENTS

1. Read `node_modules/comfy-ts/guide-for-agents.md`: the module pattern, the var kinds, import and export. The conversion needs a host whose `.comfy-ts/hosts/<id>/sdk.d.ts` exists and whose nodes cover the JSON; without one, set the project up first.
2. Let comfy-ts read the JSON offline and print it in the prompt format. A JSON with a `nodes` array is a workflow.json; an object of `{ class_type, inputs }` entries is an api.json. Save this as a scratch `.ts` file in the project and run it with `bun`:

   ```ts
   import { ComfyTS } from 'comfy-ts'
   const host = ComfyTS.create().host({ id: '<host-id>', url: '<host-url>' })
   await host.loadSchemaFromCache()
   const json = JSON.parse(await Bun.file('<input.json>').text())
   const wf = 'nodes' in json ? host.importWorkflowJson(json) : host.importApiJson(json)
   console.log(JSON.stringify(wf.toApiJson(), null, 1))
   ```

   An error that names a node or a model the host lacks is the answer: report it, never guess around it.
3. Write `<module-name>.cflow.ts` from that prompt: one `b.<class_type>({ … })` call per node, producers first. A link `["<id>", <slot>]` becomes the producing node's output, `node.outputs.<name>` with the output name from the `OUT` block of `sdk.d.ts`. A literal input stays a value. Make vars of what a user tunes: prompt text, seed, size, steps, input media, the model files.
4. Check it as a new workflow is checked: the project typechecks, `bunx comfy-ts run ./<module-name>.cflow.ts --help` lists the vars, a dry build has empty `problems`. Then compare `(await m.default.build({ dry: true })).toApiJson()` with the converted prompt: every loader, encoder, sampler and saver node of the prompt is there.
5. Delete the scratch file.

Report the module path, its vars, and every node the conversion dropped, with the reason.
