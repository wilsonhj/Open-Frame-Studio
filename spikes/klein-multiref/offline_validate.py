"""Offline structural validation of API graphs with the real ComfyUI validator (CPU, no weights).

Placeholder (empty) model files and input images are created in a temp dir so combo lists contain
the names the graph uses; everything else (class names, dotted DynamicCombo/Autogrow keys, link
types, ranges) is checked by ComfyUI's own execution.validate_prompt.

usage: COMFY_DIR=<workspace>/ComfyUI python offline_validate.py GRAPH.json [...]
"""
import asyncio
import json
import os
import sys
import tempfile

COMFY = os.environ.get("COMFY_DIR", "<workspace>/ComfyUI")
sys.path.insert(0, COMFY)
sys.argv = [sys.argv[0], "--cpu"] + [a for a in sys.argv[1:]]
graphs = [a for a in sys.argv[2:]]
sys.argv = sys.argv[:2]

import comfy.options  # noqa: E402
comfy.options.enable_args_parsing()
import folder_paths  # noqa: E402

tmp = tempfile.mkdtemp(prefix="kv_")
for sub in ("diffusion_models", "text_encoders", "vae", "input"):
    os.makedirs(os.path.join(tmp, sub), exist_ok=True)

wanted = {"diffusion_models": set(), "text_encoders": set(), "vae": set()}
loaded = [json.load(open(p)) for p in graphs]
for g in loaded:
    for n in g.values():
        i = n["inputs"]
        if n["class_type"] == "UNETLoader":
            wanted["diffusion_models"].add(i["unet_name"])
        if n["class_type"] == "CLIPLoader":
            wanted["text_encoders"].add(i["clip_name"])
        if n["class_type"] == "VAELoader":
            wanted["vae"].add(i["vae_name"])
for folder, names in wanted.items():
    for name in names:
        open(os.path.join(tmp, folder, name), "wb").close()
    folder_paths.add_model_folder_path(folder, os.path.join(tmp, folder), is_default=True)

from PIL import Image  # noqa: E402
for k in range(4):
    Image.new("RGB", (64, 64), (128, 128, 128)).save(os.path.join(tmp, "input", f"ref_{k}.png"))
folder_paths.set_input_directory(os.path.join(tmp, "input"))

import nodes  # noqa: E402
import execution  # noqa: E402


async def main():
    await nodes.init_extra_nodes(init_custom_nodes=False, init_api_nodes=False)
    rc = 0
    for path, g in zip(graphs, loaded):
        ok, err, outs, node_errors = await execution.validate_prompt("x", g, None)
        print(f"{os.path.basename(path)}: valid={ok} outputs={outs}")
        if not ok:
            rc = 1
            print("  ", json.dumps(err)[:600])
            print("  ", json.dumps(node_errors)[:2000])
    return rc

sys.exit(asyncio.run(main()))
