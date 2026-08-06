"""Download a Hugging Face causal LM and write it as ONE safetensors file ComfyUI can load.

ComfyUI reimplements a closed list of architectures with hardcoded dimensions and detects
which one a file is from its TENSOR SHAPES (comfy/sd.py::detect_te_model), so only a model
matching a supported architecture AND size works. It also loads exactly one file, while HF
ships sharded, this merges the shards and drops the result in models/text_encoders/.

  python fetch_text_encoder.py <hf-repo-id> <output-name.safetensors> [--dest DIR]

It refuses rather than writing a file ComfyUI would reject: the config must name a supported
architecture, and the hidden size must be one comfy has a config for.
"""

import argparse
import json
import os
import sys

# hidden_size  ->  what comfy's detect_te_model will call it (comfy/sd.py, verified 0.27.0).
# Generation additionally needs the class to mix in BaseGenerate, which is true for all of these
SUPPORTED = {
    "qwen3": {1024: "Qwen3-0.6B", 2048: "Qwen3-2B", 2560: "Qwen3-4B", 4096: "Qwen3-8B"},
    "gemma2": {2304: "Gemma2-2B"},
    "gemma3": {2560: "Gemma3-4B", 3840: "Gemma3-12B"},
    "gemma3_text": {2560: "Gemma3-4B", 3840: "Gemma3-12B"},
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("out")
    ap.add_argument("--dest", default=None, help="text_encoders dir (default: ./models/text_encoders)")
    args = ap.parse_args()

    from huggingface_hub import hf_hub_download, snapshot_download
    from safetensors.torch import load_file, save_file

    cfg_path = hf_hub_download(args.repo, "config.json")
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    text_cfg = cfg.get("text_config", cfg)
    model_type = str(text_cfg.get("model_type", "")).lower()
    hidden = int(text_cfg.get("hidden_size", 0))

    sizes = SUPPORTED.get(model_type)
    if sizes is None:
        print(f"ERROR: '{model_type}' is not one of the architectures ComfyUI implements: {sorted(SUPPORTED)}")
        return 1
    if hidden not in sizes:
        print(f"ERROR: {model_type} hidden_size {hidden} has no comfy config (it knows {sorted(sizes)})")
        return 1
    print(f"OK: {args.repo} is {sizes[hidden]} ({model_type}, hidden {hidden}), ComfyUI can run this")

    dest = args.dest or os.path.join("models", "text_encoders")
    os.makedirs(dest, exist_ok=True)
    target = os.path.join(dest, args.out)
    if os.path.exists(target):
        print(f"SKIP: {target} already exists, nothing downloaded")
        return 0

    print("downloading weights...")
    local = snapshot_download(args.repo, allow_patterns=["*.safetensors", "*.safetensors.index.json"])

    shards = sorted(f for f in os.listdir(local) if f.endswith(".safetensors"))
    if not shards:
        print("ERROR: the repo publishes no .safetensors (a GGUF-only repo cannot be used here)")
        return 1
    merged: dict = {}
    for shard in shards:
        print(f"  + {shard}")
        # contiguous: a merged view can otherwise refuse to serialize
        for k, v in load_file(os.path.join(local, shard)).items():
            merged[k] = v.contiguous()

    print(f"writing {target} ({len(merged)} tensors)")
    save_file(merged, target)
    print(f"OK: done, restart ComfyUI and it appears in CLIPLoader as {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
