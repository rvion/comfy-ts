# runs without ComfyUI: a stub `folder_paths` carries the real cache logic, and the
# filesystem is a dict whose directory mtimes never move, which is what exFAT does.
import importlib.util
import os
import sys
import time
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))

DISK = {"loras": ["a.safetensors"]}
DIR_MTIME = 1000.0


def make_folder_paths():
    fp = types.ModuleType("folder_paths")
    fp.filename_list_cache = {}
    fp.cache_helper = types.SimpleNamespace(get=lambda k, d=None: d, set=lambda k, v: None)
    fp.folder_names_and_paths = {"loras": (["/models/loras"], {".safetensors"})}
    fp.map_legacy = lambda name: name
    fp.os_getmtime = lambda path: DIR_MTIME

    def get_filename_list_(name):
        return sorted(DISK[name]), {"/models/loras": DIR_MTIME}, time.perf_counter()

    # same shape as ComfyUI's: valid while every scanned directory keeps its mtime
    def cached_filename_list_(name):
        if name not in fp.filename_list_cache:
            return None
        out = fp.filename_list_cache[name]
        for folder, mtime in out[1].items():
            if fp.os_getmtime(folder) != mtime:
                return None
        return out

    def get_filename_list(name):
        out = fp.cached_filename_list_(name)
        if out is None:
            out = get_filename_list_(name)
            fp.filename_list_cache[name] = out
        return list(out[0])

    fp.get_filename_list_ = get_filename_list_
    fp.cached_filename_list_ = cached_filename_list_
    fp.get_filename_list = get_filename_list
    return fp


def load_node(fp):
    sys.modules["folder_paths"] = fp
    spec = importlib.util.spec_from_file_location("fresh_model_lists", os.path.join(HERE, "__init__.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FreshModelListsTest(unittest.TestCase):
    def setUp(self):
        DISK["loras"] = ["a.safetensors"]

    def test_control_without_the_node_a_new_file_stays_invisible(self):
        fp = make_folder_paths()
        self.assertEqual(fp.get_filename_list("loras"), ["a.safetensors"])
        DISK["loras"].append("b.safetensors")
        self.assertEqual(fp.get_filename_list("loras"), ["a.safetensors"])

    def test_with_the_node_a_new_file_appears_once_the_ttl_passed(self):
        # why we think it is actually a bug, and not just meaning spec should change: ComfyUI's
        # cache promises a file list that follows the disk, and on exFAT a new lora never shows
        # until a restart (measured on a real exFAT drive: dir mtime unchanged after a create)
        fp = make_folder_paths()
        node = load_node(fp)
        node.TTL_SECONDS = 0.05
        self.assertEqual(fp.get_filename_list("loras"), ["a.safetensors"])
        DISK["loras"].append("b.safetensors")
        time.sleep(0.06)
        self.assertEqual(fp.get_filename_list("loras"), ["a.safetensors", "b.safetensors"])

    def test_within_the_ttl_the_cache_still_answers(self):
        fp = make_folder_paths()
        node = load_node(fp)
        node.TTL_SECONDS = 60
        fp.get_filename_list("loras")
        DISK["loras"].append("b.safetensors")
        self.assertEqual(fp.get_filename_list("loras"), ["a.safetensors"])

    def test_loading_twice_does_not_stack_wrappers(self):
        fp = make_folder_paths()
        base = fp.cached_filename_list_
        load_node(fp)
        load_node(fp)
        self.assertIs(fp.cached_filename_list_._fresh_model_lists_original, base)


if __name__ == "__main__":
    unittest.main()
