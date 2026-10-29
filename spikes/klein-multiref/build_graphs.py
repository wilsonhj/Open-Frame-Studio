"""Build API-format graphs for the Klein multi-reference spike.

Writes:
  klein_edit_multiref.api.json        FLUX.3 Klein (template image_flux3_klein_image_edit, flattened,
                                      upsampler branch removed, 3 face refs + 1 product ref)
  flux2_klein_edit_multiref.api.json  Same topology on FLUX.2 Klein (runs on Comfy Cloud today)
  flux2_klein_t2i_fixtures.api.json   Synthetic portrait + product (fixtures)
  flux2_klein_views.api.json          Two extra views of the synthetic person (edit graph, 1 ref)

Node ids are kept from the FLUX.3 template where the node exists there
(54 LoadImage, 4 positive prompt, 58 negative prompt, 17 ReferenceMultiLatent,
44 EmptyFlux2LatentImage, 7 sampler, 8 VAEDecode, 9 SaveImage).
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent

LORES = 1.0  # ReferenceMultiLatent "resize" megapixels per reference


def flux3_multiref(prompt, refs=4, width=1024, height=1024, steps=50, cfg=1.0,
                   distilled=False, seed=1):
    """Faithful flattening of image_flux3_klein_image_edit.json (base) or the distilled variant."""
    g = {
        "59": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "flux3-image-klein-int8-convrot.safetensors" if distilled
            else "flux3-image-klein-base-int8-convrot.safetensors",
            "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": "qwen3vl_4b_int8_convrot.safetensors", "type": "flux3", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "17": {"class_type": "ReferenceMultiLatent", "inputs": {
            "positive": ["4", 0], "negative": ["58", 0], "vae": ["3", 0],
            "resolution": "resize", "resolution.megapixels": LORES}},
        "44": {"class_type": "EmptyFlux2LatentImage", "inputs": {
            "width": width, "height": height, "batch_size": 1}},
        "7": {"class_type": "KSampler", "inputs": {
            "model": ["59", 0], "positive": ["17", 0], "negative": ["17", 1],
            "latent_image": ["44", 0], "seed": seed, "steps": steps, "cfg": cfg,
            "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "klein_multiref"}},
    }
    if distilled:  # distilled template: negative = ConditioningZeroOut(positive)
        g["58"] = {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}}
    else:          # base template: negative = empty CLIPTextEncode
        g["58"] = {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["2", 0]}}
    load_ids = ["54", "60", "61", "62"][:refs]
    for i, nid in enumerate(load_ids):
        g[nid] = {"class_type": "LoadImage", "inputs": {"image": f"ref_{i}.png"}}
        g["17"]["inputs"][f"images.image{i}"] = [nid, 0]
    return g


# FLUX.2 Klein model sets available on Comfy Cloud (2026-10-29)
F2 = {
    "4b_distilled": dict(unet="flux-2-klein-4b.safetensors", clip="qwen_3_4b.safetensors", steps=4, cfg=1.0, zero_neg=True),
    "4b_base": dict(unet="flux-2-klein-base-4b.safetensors", clip="qwen_3_4b.safetensors", steps=20, cfg=5.0, zero_neg=False),
    "9b_distilled": dict(unet="flux-2-klein-9b.safetensors", clip="qwen_3_8b_fp8mixed.safetensors", steps=4, cfg=1.0, zero_neg=True),
}


def _f2_loaders(g, variant, p=""):
    m = F2[variant]
    g[p + "59"] = {"class_type": "UNETLoader", "inputs": {"unet_name": m["unet"], "weight_dtype": "default"}}
    g[p + "2"] = {"class_type": "CLIPLoader", "inputs": {"clip_name": m["clip"], "type": "flux2", "device": "default"}}
    g[p + "3"] = {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}}
    return m


def _f2_branch(g, m, prefix, loaders, prompt, width, height, seed, ref_ids, save_prefix, steps=None):
    """One generation branch. loaders = (model_id, clip_id, vae_id). ref_ids = LoadImage ids or []."""
    mid, cid, vid = loaders
    P = prefix
    g[P + "4"] = {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": [cid, 0]}}
    if m["zero_neg"]:
        g[P + "58"] = {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": [P + "4", 0]}}
    else:
        g[P + "58"] = {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": [cid, 0]}}
    pos, neg = [P + "4", 0], [P + "58", 0]
    if ref_ids:
        g[P + "17"] = {"class_type": "ReferenceMultiLatent", "inputs": {
            "positive": pos, "negative": neg, "vae": [vid, 0],
            "resolution": "resize", "resolution.megapixels": LORES}}
        for i, rid in enumerate(ref_ids):
            g[P + "17"]["inputs"][f"images.image{i}"] = [rid, 0]
        pos, neg = [P + "17", 0], [P + "17", 1]
    g[P + "44"] = {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}}
    g[P + "70"] = {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}}
    g[P + "71"] = {"class_type": "Flux2Scheduler", "inputs": {"steps": steps or m["steps"], "width": width, "height": height}}
    g[P + "72"] = {"class_type": "CFGGuider", "inputs": {"model": [mid, 0], "positive": pos, "negative": neg, "cfg": m["cfg"]}}
    g[P + "73"] = {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}
    g[P + "7"] = {"class_type": "SamplerCustomAdvanced", "inputs": {
        "noise": [P + "70", 0], "guider": [P + "72", 0], "sampler": [P + "73", 0],
        "sigmas": [P + "71", 0], "latent_image": [P + "44", 0]}}
    g[P + "8"] = {"class_type": "VAEDecode", "inputs": {"samples": [P + "7", 0], "vae": [vid, 0]}}
    g[P + "9"] = {"class_type": "SaveImage", "inputs": {"images": [P + "8", 0], "filename_prefix": save_prefix}}


def flux2_multiref(prompt, variant="4b_distilled", refs=4, width=1024, height=1024, seed=1):
    g = {}
    m = _f2_loaders(g, variant)
    ids = ["54", "60", "61", "62"][:refs]
    for i, nid in enumerate(ids):
        g[nid] = {"class_type": "LoadImage", "inputs": {"image": f"ref_{i}.png"}}
    _f2_branch(g, m, "", ("59", "2", "3"), prompt, width, height, seed, ids, "klein_multiref")
    return g


def write(name, g):
    (HERE / name).write_text(json.dumps(g, indent=2))
    print("wrote", name, len(g), "nodes")


PORTRAIT = ("Studio headshot photograph of a fictional woman in her early thirties, warm light-brown skin, "
            "short curly dark-auburn hair, hazel eyes, a small mole above the left side of her lip, thin gold hoop earrings, "
            "plain charcoal crew-neck t-shirt, neutral expression with a slight smile, facing the camera, "
            "soft even daylight, plain light-grey seamless background, sharp focus, natural skin texture.")
MUG = ("Product photograph of a single matte sage-green ceramic coffee mug with a speckled glaze, a thick rounded "
       "handle on the right and an unglazed sand-coloured rim and base, centred on a pure white seamless background, "
       "soft studio lighting with a gentle contact shadow, three-quarter front view, no text, no logo.")

VIEW_A = ("Create a photograph of the same woman from image 1, keeping her face, curly dark-auburn hair, hazel eyes, "
          "the small mole above her lip and gold hoop earrings identical. Three-quarter left profile, head turned to her right, "
          "looking off-camera, same charcoal t-shirt, soft daylight, plain light-grey background.")
VIEW_B = ("Create a photograph of the same woman from image 1, keeping her face, curly dark-auburn hair, hazel eyes, "
          "the small mole above her lip and gold hoop earrings identical. Medium shot from the waist up, laughing naturally, "
          "wearing a denim jacket over the charcoal t-shirt, outdoors in a city park with soft bokeh, golden-hour light.")

SCENE_A = ("Create a lifestyle photograph of the woman shown in images 1, 2 and 3, keeping her face, curly dark-auburn hair, "
           "hazel eyes, the small mole above her lip and gold hoop earrings exactly the same. She sits at a sunlit wooden "
           "cafe table by a window in the morning, smiling, holding the sage-green speckled ceramic mug from image 4 in both "
           "hands near her chest. Cream knit sweater, warm natural light, shallow depth of field, candid 35mm photo.")
SCENE_B = ("Create a clean studio product photograph for an e-commerce banner: the woman shown in images 1, 2 and 3, keeping "
           "her face, curly dark-auburn hair, hazel eyes, the small mole above her lip and gold hoop earrings exactly the same, "
           "stands against a seamless terracotta-orange backdrop and presents the sage-green speckled ceramic mug from image 4 "
           "toward the camera in one hand at shoulder height. White linen shirt, soft key light from the left, crisp shadows, "
           "the mug is sharp and fully visible.")

if __name__ == "__main__":
    # Target graph (FLUX.3 Klein, base, as in the template) - not runnable on Cloud yet (weights absent)
    g3 = flux3_multiref(SCENE_A.replace("images 1, 2 and 3", "<ref_image_0>, <ref_image_1> and <ref_image_2>")
                        .replace("image 4", "<ref_image_3>"), refs=4, width=1024, height=1024, steps=50, cfg=1.0)
    write("klein_edit_multiref.api.json", g3)
    write("klein_edit_multiref_distilled.api.json",
          flux3_multiref(g3["4"]["inputs"]["text"], refs=4, steps=16, cfg=1.0, distilled=True))

    # Runnable FLUX.2 Klein variant, same bindings
    write("flux2_klein_edit_multiref.api.json", flux2_multiref(SCENE_A, "4b_distilled", width=1024, height=1024))

    # Run 1: fixtures (t2i, one job, two branches sharing loaders)
    g = {}
    m = _f2_loaders(g, "4b_distilled")
    _f2_branch(g, m, "p", ("59", "2", "3"), PORTRAIT, 768, 1024, 101, [], "fixture_portrait")
    _f2_branch(g, m, "m", ("59", "2", "3"), MUG, 768, 768, 202, [], "fixture_mug")
    write("flux2_klein_t2i_fixtures.api.json", g)

    # Run 2: two extra views of the person, edit graph with 1 reference
    g = {}
    m = _f2_loaders(g, "4b_distilled")
    g["54"] = {"class_type": "LoadImage", "inputs": {"image": "ref_0.png"}}
    _f2_branch(g, m, "a", ("59", "2", "3"), VIEW_A, 768, 1024, 303, ["54"], "view_a")
    _f2_branch(g, m, "b", ("59", "2", "3"), VIEW_B, 768, 1024, 404, ["54"], "view_b")
    write("flux2_klein_views.api.json", g)

    # Run 3/4: multi-ref scenes (3 face + 1 product), both scenes in one job, per model variant
    for variant in ("4b_distilled", "9b_distilled", "4b_base"):
        g = {}
        m = _f2_loaders(g, variant)
        ids = ["54", "60", "61", "62"]
        for i, nid in enumerate(ids):
            g[nid] = {"class_type": "LoadImage", "inputs": {"image": f"ref_{i}.png"}}
        _f2_branch(g, m, "a", ("59", "2", "3"), SCENE_A, 1024, 1024, 505, ids, f"sceneA_{variant}")
        _f2_branch(g, m, "b", ("59", "2", "3"), SCENE_B, 832, 1216, 606, ids, f"sceneB_{variant}")
        write(f"flux2_klein_scenes_{variant}.api.json", g)
