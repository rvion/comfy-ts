# extra

Things that live outside the TypeScript library but make it more useful. Nothing here is imported by `comfy-ts`; each folder stands alone.

## [`comfyui-textgen-stream/`](comfyui-textgen-stream/), a ComfyUI custom node

`Generate Text (streaming)`: core `TextGenerate`, except it publishes the answer as it is produced instead of once at the end. Copy the folder into `ComfyUI/custom_nodes/` and restart. The live text arrives as `execution.progressText`, which `comfy-ts serve` renders while the run is in flight.

## [`scripts/fetch_text_encoder.py`](scripts/fetch_text_encoder.py), a Hugging Face model, ready for `CLIPLoader`

```
python fetch_text_encoder.py <hf-repo-id> <output-name.safetensors> [--dest DIR]
```

ComfyUI does not use `transformers`. It reimplements a closed list of architectures with hardcoded dimensions and works out which one a file is from its **tensor shapes**, so only a model matching a supported architecture at a supported size can load. It also loads exactly one file, while Hugging Face ships sharded.

This checks the repo's `config.json` against what ComfyUI implements, refuses early with the reason when it does not match, and otherwise downloads the shards and merges them into a single `.safetensors` in `models/text_encoders/`.

What can generate text, as of ComfyUI 0.27: **Qwen3** (0.6B / 2B / 4B / 8B), **Gemma 2-2B**, **Gemma 3** (4B / 12B), **Ministral-3-3B**. A finetune of one of those, abliterated ones included, has the same shapes as its base and works; an architecture ComfyUI has no implementation for does not, whatever its size.

Run it with the same Python ComfyUI itself uses, so `torch` and `safetensors` are the ones already installed:

```
<comfy-python> fetch_text_encoder.py huihui-ai/Huihui-Qwen3-4B-Instruct-2507-abliterated qwen_3_4b_abliterated.safetensors --dest <comfy>/models/text_encoders
```

Restart ComfyUI afterwards: the model list is read at startup.

Two things it handles that trip up a hand-rolled merge, both found the hard way:

- **Key nesting differs per repo.** ComfyUI wants the transformer at `model.layers.*`, but a VL repo ships `model.language_model.layers.*` and some abliterations ship `language_model.model.layers.*`. Left alone the model loads and generates pure newlines. The script finds the key carrying `layers.0.input_layernorm.weight` and strips whatever sits in front of it, so any spelling normalises.
- **Some ComfyUI repacks embed the tokenizer as a tensor.** Ministral and ERNIE files carry `tekken_model`; a raw Hugging Face merge has no such key and `CLIPLoader` dies with `the JSON object must be str, bytes or bytearray, not NoneType`. `--borrow-from <working.safetensors>` copies any tensor the merge lacks from a working file of the same architecture.
