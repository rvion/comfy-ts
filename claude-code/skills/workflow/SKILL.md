---
description: Write a new comfy-ts workflow module (*.cflow.ts) that generates an image, video, audio or text on a ComfyUI host. Use when the user wants a new generation pipeline in TypeScript.
argument-hint: "[what it should generate]"
---

Write a new comfy-ts workflow module for: $ARGUMENTS

1. Read `node_modules/comfy-ts/guide-for-agents.md`: the module pattern and the var kinds. No `.comfy-ts/hosts/<id>/sdk.d.ts` yet means the project needs its setup first.
2. Start from the closest bundled example: `grep -rl <NodeName> node_modules/comfy-ts/examples --include=*.cflow.ts`. Keep the project's own host, never the example's.
3. Take every node, input name, model file and enum value from the host's `sdk.d.ts` (grep `  <NodeName>: {`). A model the user may swap becomes a `v.model` var, never a typed file name.
4. Make vars of what a user tunes (prompt, seed, size, steps, input media) and keep the rest as constants.
5. Save it as `<name>.cflow.ts` with the workflow as its default export and the `import.meta.main` block of the guide.
6. Check it offline:
   - the project typechecks;
   - `bunx comfy-ts run ./<name>.cflow.ts --help` lists the vars;
   - a dry build reports no problem: `bun -e "const m = await import('./<name>.cflow.ts'); const wf = await m.default.build({ dry: true }); console.log(wf.problems)"` prints `[]`.
7. Generate only when the user asks: `bunx comfy-ts run ./<name>.cflow.ts --out <path>`.

Report the file, its vars, and the checks you ran.
