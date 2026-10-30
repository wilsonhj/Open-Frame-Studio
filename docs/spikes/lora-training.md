# Spike 1: Cloud LoRA training

**Verdict: NO-GO for a live trained Soul on Comfy Cloud, as things stand.** There are two hard blockers and one model gap. Nothing ran on Cloud (0 real submissions, 0 credits spent).

1. **Job submission is blocked for this account.** Every submit returns `403`. `POST https://cloud.comfy.org/api/v2/jobs` returns `{"error":{"code":"forbidden","message":"API key authentication is not available for free tier accounts"}}`, and the legacy `POST /api/prompt` returns the same message with `type: FREE_TIER_NOT_ALLOWED`. Read endpoints still work (`/api/object_info` and `/api/experiment/models/*` both return 200). This also blocks **every other Wave 0 spike** that submits jobs. The account needs a paid Cloud tier before any run (PLAN.md already notes "Creator or higher").
2. **`SaveLoRA` does not exist on Cloud.** It is missing from `/api/object_info`, and no other Cloud node takes a `LORA_MODEL` input except `LoraModelLoader`. So even on a paid tier, the trained LoRA **cannot come back as a downloadable `.safetensors` job output**. It can only be used in-graph by the same job (`TrainLoraNode` → `LoraModelLoader` → sampler). `LossGraphNode` exists, so a loss plot image can be returned.
3. **FLUX.3 Klein weights are not on Cloud.** The `flux3` CLIPLoader type and the `qwen3vl_4b_bf16` / `qwen3vl_4b_fp8_scaled` text encoders are deployed. But `/api/experiment/models/diffusion_models` (377 files) has **no `flux3-image-klein-*`** checkpoint, and `qwen3vl_4b_int8_convrot.safetensors` (used by the official template) is also missing. The base model that trains on Cloud today is **FLUX.2 Klein base 4B**.

## What was checked (step 1, done)

Training nodes in Cloud `/api/object_info` (fetched 2026-10-29 19:01 UTC, 10.8 MB):

| Node | On Cloud | Notes |
|---|---|---|
| `TrainLoraNode` | yes | `is_input_list: true`. Outputs `lora` (LORA_MODEL), `loss_map`, `steps`. Inputs: model, latents, positive, batch_size, grad_accumulation_steps, steps, learning_rate, rank, optimizer, loss_function, seed, training_dtype, lora_dtype, quantized_backward, algorithm (LoRA/LoHa/LoKr/OFT), gradient_checkpointing, checkpoint_depth, offloading, existing_lora (combo of Cloud loras + `[None]`), bucket_mode, bypass_mode |
| `MakeTrainingDataset` | yes | images, vae, clip, optional `texts` (forceInput STRING). Outputs latents and conditioning lists |
| `LoraModelLoader` | yes | model, lora (LORA_MODEL), strength_model, bypass |
| `LossGraphNode` | yes | output node (saves a loss plot image) |
| `SaveLoRA` | **no** | present in local ComfyUI `comfy_extras/nodes_train.py:1364` but stripped from Cloud |
| `ResizeImagesByShorterEdge`, `ShuffleDataset`, `LoadLoraModel` | yes | |

Models (exact Cloud filenames):

- Diffusion models: `flux-2-klein-base-4b.safetensors`, `flux-2-klein-base-4b-fp8.safetensors`, `flux-2-klein-base-9b-fp8.safetensors`, `flux-2-klein-4b.safetensors` (distilled), `flux-2-klein-4b-fp8.safetensors`, `flux-2-klein-9b.safetensors`. No FLUX.3 Klein.
- Text encoders: `qwen_3_4b.safetensors` (FLUX.2 Klein 4B, CLIPLoader type `flux2`), `qwen_3_8b*.safetensors`, `qwen3vl_4b_bf16.safetensors`, `qwen3vl_4b_fp8_scaled.safetensors` (FLUX.3, type `flux3`).
- VAE: `flux2-vae.safetensors`.
- `/api/experiment/models/checkpoints` has no Klein files. `loras` has 652 entries, including several community FLUX.2 Klein LoRAs.

## What was prepared (steps 2–4, built and validated, not run)

All files are in `spikes/lora-training/`:

- `build_graphs.py` writes both API graphs. The trigger word is `ohwx_mira` (a fictional, synthetic subject).
- `dataset_t2i.json` is the step 2 graph. It uses FLUX.2 Klein 4B distilled (`flux-2-klein-4b.safetensors` + `qwen_3_4b` + `flux2-vae`), 4 steps, cfg 1, 512×512, `batch_size` 6, and saves to node `13`.
- `train_lora_50.json` is the step 3 graph. Pass `--steps 300` to `build_graphs.py` for the second run. `SaveLoRA` is left out because Cloud would reject the graph with it.
- `validate.py` runs an offline check against the saved object_info (class names, required and unknown inputs, combo values, link slots). Both graphs pass.
- `run_job.py` uploads assets, calls `submit()` exactly once with no retry loop, polls with `refresh()`, logs status timings and downloads outputs.

Node bindings for the app (`train_lora_*.json`):

| User input | Node id | Field |
|---|---|---|
| Reference photos 1–6 (uploaded assets) | `1`–`6` (`LoadImage`) | `image` |
| Caption / trigger | `20` (`PrimitiveString`) | `value` |
| Training steps / rank / LR | `30` (`TrainLoraNode`) | `steps`, `rank`, `learning_rate` |
| Preview prompt (must contain the trigger) | `40` (`CLIPTextEncode`) | `text` |
| Preview seed | `47` (`RandomNoise`) | `noise_seed` |
| Outputs | `50` (`SaveImage`, preview), `51` (`LossGraphNode`, loss plot) | — |

Graph shape: the six `LoadImage` nodes feed an `ImageBatch` chain (`7`–`11`). Images must all be the same size; the app should resize to 512 first. The chain feeds `MakeTrainingDataset` (`21`, single caption repeated), which feeds `TrainLoraNode` (`30`: rank 16, AdamW, bf16, grad-ckpt, `bypass_mode` false because the bf16 model is used). `LoraModelLoader` (`31`) applies the trained LoRA to the same `UNETLoader` (`12`); training deep-copies the model, so the base model is not changed. The sampler is `CFGGuider` cfg 4 + `Flux2Scheduler` 20 steps at 512², then `VAEDecode` → `SaveImage` (`50`).

To run once the account is upgraded (≤3 submissions):

```bash
cd spikes/lora-training
OUT=../../spike-out/lora-training  # spike-out/ is gitignored
mkdir -p $OUT
python3 run_job.py dataset_t2i.json --out $OUT --label dataset --timeout 600
# split the 6 outputs if returned as one file each: soul_dataset_0000x_.png
python3 run_job.py train_lora_50.json --out $OUT --label train50 --timeout 2400 \
  --upload 1=$OUT/a.png --upload 2=$OUT/b.png ... --upload 6=$OUT/f.png
python3 build_graphs.py --steps 300 && python3 run_job.py train_lora_300.json ... --label train300
```

## Timings

None. Nothing could be submitted. The failed submit and the read-only probes took under 1 s each.

## Problems and workarounds

- **Free-tier 403 on submit.** There is no workaround from code. The account owner must upgrade the Cloud plan, or point `COMFY_BASE_URL` at a self-hosted ComfyUI behind comfy-api-proxy or at a serverless deployment. This is an orchestrator and human decision, and it affects all spikes.
- **No `SaveLoRA`.** If training on Cloud works after the upgrade, the trained Soul only lives inside a single job. Every use means retraining plus generating in one graph, so "export LoRA" is impossible on Cloud. Options:
  - train on our own GPU or self-hosted ComfyUI, and import the LoRA via HF as a Cloud-visible lora (PLAN.md fallback);
  - check whether Cloud's custom-model import (Creator tier) can then load it with `LoraLoaderModelOnly`;
  - ask Comfy whether `SaveLoRA` / `SaveTrainingDataset` are intentionally disabled.
- **No FLUX.3 Klein on Cloud yet.** The FLUX.3 Klein templates (`image_flux3_klein_t2i.json` etc.) reference `flux3-image-klein-base-int8-convrot.safetensors` and `qwen3vl_4b_int8_convrot.safetensors`, and neither is deployed. Until they land, Instant Soul and Photoshoot graphs that assume FLUX.3 Klein will fail validation on Cloud. FLUX.2 Klein 4B/9B are the available substitutes. Re-check `/api/experiment/models/diffusion_models` before the human checkpoint.

## Recommendation

> Superseded (Oct 29): the user chose Instant Soul only (docs/PLAN.md, Update after Wave 0); no HF-imported trained Soul.

Use the PLAN.md fallback. Instant Soul (multi-reference, no training) carries the live demo, and "Trained Soul" is a LoRA trained off-Cloud and imported via HF. Re-run this spike (3 submissions, graphs ready) only if the account is upgraded. Even then it can at best be PARTIAL (train and preview in one job, no downloadable LoRA) unless `SaveLoRA` is enabled on Cloud.
