# comfyui-fresh-model-lists

A ComfyUI extension with no nodes: model lists (loras, checkpoints, every `models/` folder) that follow the disk, so a lora you just downloaded shows up without restarting ComfyUI.

## Why it exists

ComfyUI caches each folder's file list and keeps it while every scanned directory keeps its modification time. That works on NTFS and ext4, where adding a file updates the directory's mtime.

On **exFAT** it does not. Windows leaves an exFAT directory's modification time unchanged when a file is created inside it (measured: a new file in `models/loras/krea2/styles`, directory mtime still from six weeks earlier, `os.path.getmtime` agreeing). The cache never invalidates, `/object_info` keeps serving the old enum, and the only way to see a new lora is a restart. A models drive formatted exFAT, common for large external or shared SSDs, has this on every download.

## How it works

It wraps `folder_paths.cached_filename_list_` and adds an age limit: a list scanned more than `TTL_SECONDS` (2 s) ago counts as stale, so the next read rescans. ComfyUI's own mtime check still runs first. A rescan is cheap: a full `models/` walk of about 1000 files took 18 ms on an exFAT SSD, and during one `/object_info` request ComfyUI scans each folder only once.

After a download, refresh the node definitions (the `R` key in the ComfyUI frontend, the refetch button in the `comfy-ts serve` panel) and the new file is in the list.

## Install

Copy this folder into `ComfyUI/custom_nodes/` and restart ComfyUI once. The startup log says `[fresh-model-lists] model lists rescan after 2.0s`.

Uninstall by deleting the folder. It touches no file, only one function in memory.

## Tests

`python3 -m unittest test_fresh_model_lists` runs without ComfyUI, against a stub `folder_paths` whose directory mtimes never move. The control case shows the new file staying invisible without the extension.
