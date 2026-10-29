"""Build API-format graphs for the MiniMax H3 reference-to-video spike.

Writes:
  h3_r2v.api.json       Faithful flattening of templates/video_minimax_h3_r2v.json (no subgraph).
                        Node ids are kept from the template. Notes (116/117/140) dropped.
  fixtures_t2i.api.json FLUX.2 Klein 4B distilled t2i: synthetic person + synthetic product (refs).

Differences from the template (Cloud model availability / spike sizing):
  - 119 video VAE: Cloud ships minimax_h3_video_vae_fp16 (int8_convrot not in /object_info).
  - 115 ResolutionSelector: 9:16 @ 0.4 MP (template: 16:9 @ 0.4 MP widget, 1344x768 node default).
  - 146 turbo defaults to True (4-step ref2v Lightning LoRA).
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent

PROMPT = (
    "Vertical social-media product video, bright natural daylight in a minimal modern kitchen. "
    "<Picture 1> is the woman: keep her face, curly auburn hair, gold hoop earrings and charcoal t-shirt exactly. "
    "<Picture 2> is the product: keep the amber glass dropper bottle with its white label exactly as shown. "
    "Medium close-up, static camera. The woman from <Picture 1> holds the bottle from <Picture 2> up beside her face, "
    "turns it slightly toward the camera so the label is visible, smiles and says in a warm, friendly voice: "
    "\"This is my new favourite serum.\" Soft ambient room tone, no music."
)


def h3_r2v(prompt=PROMPT, turbo=True, duration=5.0, aspect="9:16 (Portrait Widescreen)", mp=0.4,
           seed=42, ref_image_size="match", img1="person.png", img2="product.png"):
    return {
        # --- user inputs ---
        "137": {"class_type": "LoadImage", "inputs": {"image": img1}},           # <Picture 1>
        "139": {"class_type": "LoadImage", "inputs": {"image": img2}},           # <Picture 2>
        "138": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": prompt}},
        "129": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "132": {"class_type": "PrimitiveFloat", "inputs": {"value": duration}},
        "146": {"class_type": "PrimitiveBoolean", "inputs": {"value": turbo}},
        "115": {"class_type": "ResolutionSelector", "inputs": {
            "aspect_ratio": aspect, "megapixels": mp, "multiple": 32}},
        "143": {"class_type": "PrimitiveInt", "inputs": {"value": 20}},          # base steps
        "144": {"class_type": "PrimitiveInt", "inputs": {"value": 4}},           # turbo steps
        # --- models ---
        "127": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "minimax_h3_ref2va_pruned_int8_convrot.safetensors", "weight_dtype": "default"}},
        "128": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "type": "minimax",
            "device": "default"}},
        "119": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_h3_video_vae_fp16.safetensors"}},
        "120": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_h3_audio_vae_fp32.safetensors"}},
        "145": {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": ["127", 0],
            "lora_name": "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
            "strength_model": 1.0}},
        "141": {"class_type": "ComfySwitchNode", "inputs": {
            "switch": ["146", 0], "on_false": ["127", 0], "on_true": ["145", 0]}},
        "142": {"class_type": "ComfySwitchNode", "inputs": {
            "switch": ["146", 0], "on_false": ["143", 0], "on_true": ["144", 0]}},
        # --- duration -> frame length (24 fps, 17k+5 grid) ---
        "131": {"class_type": "ComfyMathExpression", "inputs": {
            "expression": "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17",
            "values.a": ["132", 0]}},
        # --- conditioning + sampling ---
        "136": {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": {
            "clip": ["128", 0], "vae": ["119", 0], "audio_vae": ["120", 0],
            "ref_images.ref_image_0": ["137", 0],
            "ref_images.ref_image_1": ["139", 0],
            "prompt": ["138", 0],
            "width": ["115", 0], "height": ["115", 1], "length": ["131", 1],
            "ref_image_size": ref_image_size}},
        "126": {"class_type": "BasicGuider", "inputs": {"model": ["141", 0], "conditioning": ["136", 0]}},
        "123": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "124": {"class_type": "BasicScheduler", "inputs": {
            "model": ["127", 0], "scheduler": "simple", "steps": ["142", 0], "denoise": 1.0}},
        "125": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["129", 0], "guider": ["126", 0], "sampler": ["123", 0],
            "sigmas": ["124", 0], "latent_image": ["136", 1]}},
        # --- decode + mux ---
        "122": {"class_type": "VAEDecode", "inputs": {"samples": ["125", 0], "vae": ["119", 0]}},
        "121": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["125", 0], "vae": ["120", 0]}},
        "130": {"class_type": "CreateVideo", "inputs": {"images": ["122", 0], "audio": ["121", 0], "fps": 24.0}},
        "92": {"class_type": "SaveVideo", "inputs": {
            "video": ["130", 0], "filename_prefix": "video/MiniMax_H3",
            "format": "auto", "format.codec": "auto"}},
    }


def klein_t2i_pair():
    """Two synthetic references in one job (FLUX.2 Klein 4B distilled, 4 steps)."""
    g = {
        "59": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux-2-klein-4b.safetensors",
                                                      "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "flux2",
                                                     "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
    }
    shots = {
        "p": ("Photograph of a fictional woman in her early thirties, warm light-brown skin, short curly "
              "dark-auburn hair, hazel eyes, thin gold hoop earrings, plain charcoal crew-neck t-shirt, "
              "friendly slight smile, facing the camera, upper body, soft daylight, plain light-grey "
              "background, sharp focus, natural skin texture.", 512, 640, 101, "h3_ref_person"),
        "m": ("Product photograph of a single small amber glass dropper bottle with a black rubber dropper "
              "cap and a plain white rectangular label with the word GLOW in simple black letters, centred "
              "on a pure white seamless background, soft studio light, gentle contact shadow, front view.",
              512, 512, 202, "h3_ref_product"),
    }
    for k, (text, w, h, seed, prefix) in shots.items():
        g.update({
            f"{k}4": {"class_type": "CLIPTextEncode", "inputs": {"text": text, "clip": ["2", 0]}},
            f"{k}58": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": [f"{k}4", 0]}},
            f"{k}44": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
            f"{k}70": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
            f"{k}71": {"class_type": "Flux2Scheduler", "inputs": {"steps": 4, "width": w, "height": h}},
            f"{k}72": {"class_type": "CFGGuider", "inputs": {"model": ["59", 0], "positive": [f"{k}4", 0],
                                                             "negative": [f"{k}58", 0], "cfg": 1.0}},
            f"{k}73": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
            f"{k}7": {"class_type": "SamplerCustomAdvanced", "inputs": {
                "noise": [f"{k}70", 0], "guider": [f"{k}72", 0], "sampler": [f"{k}73", 0],
                "sigmas": [f"{k}71", 0], "latent_image": [f"{k}44", 0]}},
            f"{k}8": {"class_type": "VAEDecode", "inputs": {"samples": [f"{k}7", 0], "vae": ["3", 0]}},
            f"{k}9": {"class_type": "SaveImage", "inputs": {"images": [f"{k}8", 0], "filename_prefix": prefix}},
        })
    return g


if __name__ == "__main__":
    (HERE / "h3_r2v.api.json").write_text(json.dumps(h3_r2v(), indent=2))
    (HERE / "h3_r2v_base20.api.json").write_text(json.dumps(h3_r2v(turbo=False), indent=2))
    (HERE / "fixtures_t2i.api.json").write_text(json.dumps(klein_t2i_pair(), indent=2))
    print("wrote h3_r2v.api.json, h3_r2v_base20.api.json, fixtures_t2i.api.json")
