# model lists (loras, checkpoints, …) that follow the disk on exFAT and other filesystems
# whose directory mtime does not move when a file is added. ComfyUI's filename cache is
# valid while every scanned directory keeps its mtime, so there a new file stays invisible
# until a restart. This adds an age limit: an entry older than TTL_SECONDS is rescanned.
# a full models/ rescan measured 18 ms on an exFAT ssd, and object_info scans each folder once.
import logging

import folder_paths

TTL_SECONDS = 2.0

_MARK = "_fresh_model_lists_original"


def _install() -> None:
    import time

    current = folder_paths.cached_filename_list_
    original = getattr(current, _MARK, current)

    def cached_filename_list_(folder_name):
        out = original(folder_name)
        # out[2] is the perf_counter taken when the list was scanned
        if out is not None and time.perf_counter() - out[2] > TTL_SECONDS:
            return None
        return out

    setattr(cached_filename_list_, _MARK, original)
    folder_paths.cached_filename_list_ = cached_filename_list_
    logging.info(f"[fresh-model-lists] model lists rescan after {TTL_SECONDS}s")


_install()

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
