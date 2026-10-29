"""Build the flattened API-format graphs for spike 4 (cutout + upscale) plus the fixture t2i graph.

Flattened from the official templates:
  utility_birefnet_remove_background.json   (subgraph node 19)
  utility_seedvr2_7b_int8_upscale_image.json (subgraph node 66)
Node ids keep the template's inner-subgraph ids so they can be traced back.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent

# --- cutout: LoadImage -> RemoveBackground(BiRefNet) -> InvertMask -> JoinImageWithAlpha -> SaveImage (RGBA PNG)
cutout = {
    "17": {"class_type": "LoadImage", "inputs": {"image": "product.png"}},          # USER INPUT: 17.image
    "14": {"class_type": "LoadBackgroundRemovalModel", "inputs": {"bg_removal_name": "birefnet.safetensors"}},
    "13": {"class_type": "RemoveBackground", "inputs": {"bg_removal_model": ["14", 0], "image": ["17", 0]}},
    "15": {"class_type": "InvertMask", "inputs": {"mask": ["13", 0]}},
    "16": {"class_type": "JoinImageWithAlpha", "inputs": {"image": ["17", 0], "alpha": ["15", 0]}},
    "18": {"class_type": "SaveImage", "inputs": {"images": ["16", 0], "filename_prefix": "oss_cutout"}},
    "20": {"class_type": "MaskToImage", "inputs": {"mask": ["13", 0]}},
    "21": {"class_type": "SaveImage", "inputs": {"images": ["20", 0], "filename_prefix": "oss_cutout_mask"}},
}

# --- upscale: LoadImage(+alpha) -> JoinImageWithAlpha -> ResizeImageMaskNode(xN lanczos) -> SeedVR2Preprocess
#     -> VAEEncodeTiled -> SeedVR2Conditioning -> KSampler(1 step) -> VAEDecodeTiled -> SeedVR2PostProcessing -> SaveImage
upscale = {
    "1": {"class_type": "LoadImage", "inputs": {"image": "input.png"}},              # USER INPUT: 1.image
    "50": {"class_type": "JoinImageWithAlpha", "inputs": {"image": ["1", 0], "alpha": ["1", 1]}},
    "57": {"class_type": "ResizeImageMaskNode", "inputs": {
        "input": ["50", 0], "resize_type": "scale by multiplier",
        "resize_type.multiplier": 2.0,                                                 # USER INPUT: 57.resize_type.multiplier
        "scale_method": "lanczos"}},
    "58": {"class_type": "SeedVR2Preprocess", "inputs": {"resized_images": ["57", 0]}},
    "51": {"class_type": "VAELoader", "inputs": {"vae_name": "seedvr2_ema_vae_fp16.safetensors"}},
    "52": {"class_type": "UNETLoader", "inputs": {"unet_name": "seedvr2_7b_int8_convrot.safetensors", "weight_dtype": "default"}},
    "48": {"class_type": "VAEEncodeTiled", "inputs": {"pixels": ["58", 0], "vae": ["51", 0],
                                                      "tile_size": 512, "overlap": 128, "temporal_size": 4096, "temporal_overlap": 8}},
    "61": {"class_type": "SeedVR2Conditioning", "inputs": {"model": ["52", 0], "vae_conditioning": ["48", 0]}},
    "54": {"class_type": "KSampler", "inputs": {"model": ["52", 0], "positive": ["61", 0], "negative": ["61", 1],
                                                "latent_image": ["48", 0], "seed": 959948902156062, "steps": 1, "cfg": 1.0,
                                                "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
    "55": {"class_type": "VAEDecodeTiled", "inputs": {"samples": ["54", 0], "vae": ["51", 0],
                                                      "tile_size": 512, "overlap": 128, "temporal_size": 4096, "temporal_overlap": 8}},
    "59": {"class_type": "SeedVR2PostProcessing", "inputs": {"images": ["55", 0], "original_resized_images": ["57", 0],
                                                             "color_correction_method": "wavelet"}},  # lab left red/blue streaks on flat colour (spike 4); template ships "none"
    "9": {"class_type": "SaveImage", "inputs": {"images": ["59", 0], "filename_prefix": "oss_upscale"}},
}

# --- fixture: Flux.2 Klein 4B distilled t2i, synthetic product on a deliberately busy background (512x512, 4 steps)
PROMPT = ("Product photograph of a single matte burnt-orange insulated stainless steel water bottle with a black "
          "screw cap and a small loop handle, standing upright on a cluttered wooden kitchen counter, busy background "
          "with colourful fruit bowls, patterned tiles, plants and utensils, shallow depth of field, natural window "
          "light, no text, no logo.")
fixture = {
    "59": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux-2-klein-4b.safetensors", "weight_dtype": "default"}},
    "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "flux2", "device": "default"}},
    "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
    "4": {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": ["2", 0]}},
    "58": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},
    "44": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
    "70": {"class_type": "RandomNoise", "inputs": {"noise_seed": 404}},
    "71": {"class_type": "Flux2Scheduler", "inputs": {"steps": 4, "width": 512, "height": 512}},
    "72": {"class_type": "CFGGuider", "inputs": {"model": ["59", 0], "positive": ["4", 0], "negative": ["58", 0], "cfg": 1.0}},
    "73": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
    "7": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["70", 0], "guider": ["72", 0], "sampler": ["73", 0],
                                                          "sigmas": ["71", 0], "latent_image": ["44", 0]}},
    "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
    "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "oss_fixture_product_busy"}},
}

for name, g in (("cutout.api.json", cutout), ("upscale.api.json", upscale), ("fixture_t2i.api.json", fixture)):
    (HERE / name).write_text(json.dumps(g, indent=2) + "\n")
    print("wrote", name, len(g), "nodes")
