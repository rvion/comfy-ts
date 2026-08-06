# comfyui-textgen-stream

A ComfyUI custom node: **`Generate Text (streaming)`**, core `TextGenerate`, except you can watch it write.

## Why it exists

ComfyUI's `TextGenerate` blocks for the whole generation and publishes its answer once, when the node finishes. Nothing partial reaches a client, so a long answer is a progress bar and a wait.

The protocol was never the limit. `PromptServer.send_progress_text(text, node_id)` pushes a node's live text as binary websocket frame type 3, and several nodes already use it. Core `TextGenerate` simply never calls it.

## How it works

The generation loop (`comfy/text_encoders/llama.py`) keeps its token list local, so there is nothing to subscribe to. What is reachable is `sample_token`, called exactly once per generated token and returning the token it picked. This node wraps that method for the duration of one call, decodes what has accumulated every `stream_every` tokens, and publishes it. The real sampling loop runs unmodified, nothing is reimplemented, so sampling behaviour is identical to core.

The wrapper is installed and removed around a single `generate()` call, in a `finally`, so an exception cannot leave a patched model behind.

## Install

Copy this folder into `ComfyUI/custom_nodes/` and restart ComfyUI:

```
ComfyUI/custom_nodes/comfyui-textgen-stream/__init__.py
```

Uninstall by deleting the folder. It patches nothing at import time.

## Use from comfy-ts

`examples/rvion/07-local-llm-text-gen.cflow.ts` feature-detects it and falls back to core `TextGenerate` where it is absent. The live text arrives as `execution.progressText` (and on the `onProgress` callback), which `comfy-ts serve` renders in the results panel as the answer builds up.

Note the builder key is qualified by the folder you install it under: `comfyui-textgen-stream` becomes `textgen-stream.StreamTextGenerate`.

## Limits

`stream_every: 1` is true token-by-token; decoding the accumulated ids each time costs a little, so a few tokens per frame reads the same and wastes less. A model whose text stack exposes no `sample_token` gets no live text and generates normally, the node says so in the ComfyUI log rather than failing.
