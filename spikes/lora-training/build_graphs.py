"""Build API-format graphs for the Cloud LoRA training spike.

Writes:
  dataset_t2i.json   - FLUX.2 Klein 4B distilled t2i, batch of 6 synthetic portraits
  train_lora.json    - LoadImage x6 -> ImageBatch -> MakeTrainingDataset -> TrainLoraNode
                       -> LoraModelLoader -> sample preview (+ LossGraphNode)

Usage: python build_graphs.py [--steps 50] [--rank 16] [--lr 0.0005]
"""
import argparse
import json
from pathlib import Path

HERE = Path(__file__).parent

TRIGGER = "ohwx_mira"
SUBJECT = (
    "a young woman with a sharp teal bob haircut, round yellow glasses, "
    "freckles, small silver nose ring, wearing a mustard turtleneck"
)
DATASET_PROMPT = (
    f"portrait photo of {SUBJECT}, head and shoulders, plain light grey studio "
    "background, soft daylight, 50mm photo, natural skin texture"
)
CAPTION = f"photo of {TRIGGER} woman"
PREVIEW_PROMPT = f"photo of {TRIGGER} woman sitting in a sunny cafe, candid, 35mm photo"

UNET_BASE = "flux-2-klein-base-4b.safetensors"
UNET_DISTILLED = "flux-2-klein-4b.safetensors"
TEXT_ENCODER = "qwen_3_4b.safetensors"
VAE = "flux2-vae.safetensors"


def loaders(unet):
    return {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": TEXT_ENCODER, "type": "flux2", "device": "default"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
    }


def dataset_graph(size=512, batch=6, seed=4242):
    L = loaders(UNET_DISTILLED)
    return {
        "1": L["unet"],
        "2": L["clip"],
        "3": L["vae"],
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": DATASET_PROMPT, "clip": ["2", 0]}},
        "5": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},
        "6": {"class_type": "CFGGuider", "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0], "cfg": 1.0}},
        "7": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "8": {"class_type": "Flux2Scheduler", "inputs": {"steps": 4, "width": size, "height": size}},
        "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "10": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": size, "height": size, "batch_size": batch}},
        "11": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["9", 0], "guider": ["6", 0], "sampler": ["7", 0], "sigmas": ["8", 0], "latent_image": ["10", 0]}},
        "12": {"class_type": "VAEDecode", "inputs": {"samples": ["11", 0], "vae": ["3", 0]}},
        "13": {"class_type": "SaveImage", "inputs": {"images": ["12", 0], "filename_prefix": "soul_dataset"}},
    }


def train_graph(steps=50, rank=16, lr=0.0005, n_images=6, preview_size=512, preview_steps=20, seed=7):
    """Node ids the app binds:
      "1".."6"  LoadImage.image      <- user reference photos (uploaded assets)
      "20"      PrimitiveString.value <- caption with trigger word
      "30"      TrainLoraNode.steps / rank / learning_rate
      "40"      CLIPTextEncode.text  <- preview prompt (must contain trigger)
      "47"      RandomNoise.noise_seed
      "50"      SaveImage (preview output)    "51" LossGraphNode (loss plot output)
    """
    L = loaders(UNET_BASE)
    g = {}
    for i in range(1, n_images + 1):
        g[str(i)] = {"class_type": "LoadImage", "inputs": {"image": f"placeholder_{i}.png"}}
    # chain ImageBatch: 7 = 1+2, 8 = 7+3, ...
    prev = "1"
    for k, i in enumerate(range(2, n_images + 1)):
        nid = str(6 + 1 + k)  # 7..11
        g[nid] = {"class_type": "ImageBatch", "inputs": {"image1": [prev, 0], "image2": [str(i), 0]}}
        prev = nid
    g["12"] = L["unet"]
    g["13"] = L["clip"]
    g["14"] = L["vae"]
    g["20"] = {"class_type": "PrimitiveString", "inputs": {"value": CAPTION}}
    g["21"] = {"class_type": "MakeTrainingDataset", "inputs": {"images": [prev, 0], "vae": ["14", 0], "clip": ["13", 0], "texts": ["20", 0]}}
    g["30"] = {
        "class_type": "TrainLoraNode",
        "inputs": {
            "model": ["12", 0],
            "latents": ["21", 0],
            "positive": ["21", 1],
            "batch_size": 1,
            "grad_accumulation_steps": 1,
            "steps": steps,
            "learning_rate": lr,
            "rank": rank,
            "optimizer": "AdamW",
            "loss_function": "MSE",
            "seed": 0,
            "training_dtype": "bf16",
            "lora_dtype": "bf16",
            "quantized_backward": False,
            "algorithm": "LoRA",
            "gradient_checkpointing": True,
            "checkpoint_depth": 1,
            "offloading": False,
            "existing_lora": "[None]",
            "bucket_mode": False,
            "bypass_mode": False,
        },
    }
    g["31"] = {"class_type": "LoraModelLoader", "inputs": {"model": ["12", 0], "lora": ["30", 0], "strength_model": 1.0, "bypass": False}}
    g["40"] = {"class_type": "CLIPTextEncode", "inputs": {"text": PREVIEW_PROMPT, "clip": ["13", 0]}}
    g["41"] = {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["13", 0]}}
    g["42"] = {"class_type": "CFGGuider", "inputs": {"model": ["31", 0], "positive": ["40", 0], "negative": ["41", 0], "cfg": 4.0}}
    g["43"] = {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}
    g["44"] = {"class_type": "Flux2Scheduler", "inputs": {"steps": preview_steps, "width": preview_size, "height": preview_size}}
    g["45"] = {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": preview_size, "height": preview_size, "batch_size": 1}}
    g["47"] = {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}}
    g["48"] = {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["47", 0], "guider": ["42", 0], "sampler": ["43", 0], "sigmas": ["44", 0], "latent_image": ["45", 0]}}
    g["49"] = {"class_type": "VAEDecode", "inputs": {"samples": ["48", 0], "vae": ["14", 0]}}
    g["50"] = {"class_type": "SaveImage", "inputs": {"images": ["49", 0], "filename_prefix": "soul_lora_preview"}}
    g["51"] = {"class_type": "LossGraphNode", "inputs": {"loss": ["30", 1], "filename_prefix": "soul_lora_loss"}}
    return g


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=50)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--lr", type=float, default=0.0005)
    a = ap.parse_args()
    (HERE / "dataset_t2i.json").write_text(json.dumps(dataset_graph(), indent=1))
    (HERE / f"train_lora_{a.steps}.json").write_text(json.dumps(train_graph(a.steps, a.rank, a.lr), indent=1))
    print("wrote dataset_t2i.json and", f"train_lora_{a.steps}.json")
