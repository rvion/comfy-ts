---
"Node 22 is the minimum": commit 4dbbd8f, weight improvement
"Every dependency at its latest": commit 4dbbd8f, weight improvement
"A progress frame is typed with its prompt and node": commit 7474e34, weight improvement
---
# next (minor)

## Package

### Node 22 is the minimum
`engines.node` goes from `>=20` to `>=22`. Two dependencies need it: `ink` 8 (the terminal UI) and `nanoid` 6, which already asked for node 22 in earlier versions. Node 20 reached its end of life in April 2026.

### Every dependency at its latest
All dependencies are at their latest versions, with two majors: `ink` 8 and `image-meta` 0.3. The exports of `comfy-ts` and `comfy-ts/web` are the same.

The type declarations now ship as one file per source file under `dist/`, with a `.d.cts` twin for `require()` consumers, in place of one bundled `index.d.ts`. `import … from 'comfy-ts'` and `comfy-ts/web` resolve the same types as before.

## Types

### A progress frame is typed with its prompt and node
`NodeProgress`, the data of a `progress` websocket frame, now has the optional `prompt_id` and `node` that ComfyUI sends with it.
