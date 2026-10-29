# Spike 4: BiRefNet cutout + SeedVR2 upscale (flattened API graphs) + marketplace main-image check

**Verdict: PARTIAL (GO on the graphs, Cloud execution not yet proven).**
Both flattened API graphs run end to end on a real ComfyUI (local, CPU, the same ComfyUI 0.43.0 source and the same JSON), and the marketplace compliance check passes. Nothing ran on Comfy Cloud. The fixture submit returned `403 forbidden: "API key authentication is not available for free tier accounts"`, the same blocker reported in `lora-training.md` and `h3-r2v.md`. That submit was attempted once and not retried. Credits spent: 0.

- **Cutout:** works. BiRefNet IoU against the exact ground-truth mask is **0.9997**. The output is an RGBA PNG with a clean alpha, and the hole inside the loop handle is correctly transparent.
- **Upscale:** works, with RGBA in and RGBA out (alpha carried through). One quality fix was needed: `color_correction_method` must be `wavelet`, because `lab` leaves coloured streaks (see Problems).
- **Marketplace check:** passes. The output is 2000x2000 on #FFFFFF, the product fills 85% of the canvas, and the border is 100% white. A negative control (an un-cut photo) is correctly rejected.
- **To finish on Cloud:** once the account is on a paid tier, `spikes/cutout-upscale/spike.sh <product.png>` does it in 2 submissions: cutout, then 7B int8 x2 upscale.

## Graphs (flattened from the official templates)

The node ids are the template's inner-subgraph ids, so each node can be traced back. Every class_type, input name and combo value was checked against the Cloud `/api/object_info` dump from 2026-10-29 by `run.py` (local validation OK).

### `spikes/cutout-upscale/cutout.api.json` (from `utility_birefnet_remove_background.json`, subgraph node 19)

`17 LoadImage → 13 RemoveBackground(14 LoadBackgroundRemovalModel "birefnet.safetensors") → 15 InvertMask → 16 JoinImageWithAlpha(image=17, alpha=15) → 18 SaveImage "oss_cutout"`

There is an extra branch, `13 → 20 MaskToImage → 21 SaveImage "oss_cutout_mask"`, which saves the mask. The app can drop it.

- `RemoveBackground` returns the **foreground** mask (1 = product).
- `JoinImageWithAlpha` stores `1 - alpha`, so the template's `InvertMask` is required.

### `spikes/cutout-upscale/upscale.api.json` (from `utility_seedvr2_7b_int8_upscale_image.json`, subgraph node 66)

`1 LoadImage → 50 JoinImageWithAlpha(image=1.0, alpha=1.1) → 57 ResizeImageMaskNode(scale by multiplier, lanczos) → 58 SeedVR2Preprocess → 48 VAEEncodeTiled(51 VAELoader seedvr2_ema_vae_fp16) → 61 SeedVR2Conditioning(52 UNETLoader seedvr2_7b_int8_convrot) → 54 KSampler(1 step, cfg 1, euler/simple, denoise 1) → 55 VAEDecodeTiled → 59 SeedVR2PostProcessing(original_resized_images=57, wavelet) → 9 SaveImage "oss_upscale"`

- **Tiling:** the template's tiled values are kept (`tile_size 512, overlap 128, temporal_size 4096, temporal_overlap 8`).
- **Dynamic combo encoding:** `ResizeImageMaskNode` takes `"resize_type": "scale by multiplier", "resize_type.multiplier": 2.0`.
- **Alpha handling:** Preprocess drops alpha. PostProcessing re-attaches it from node 57's RGBA, so a cutout can be upscaled directly.

### What the app should bind

| Graph | User input | Node.field | Default / notes |
|---|---|---|---|
| cutout | product photo | `17.image` | upload with `client.assets.from_file`, then `wf.set_input("17","image",asset)` |
| cutout | (output) | `18` SaveImage | RGBA PNG; `21` = mask (optional) |
| upscale | image (RGB or RGBA) | `1.image` | |
| upscale | scale factor | `57.resize_type.multiplier` | 2.0; use 4.0 for 512 → 2048 |
| upscale | model | `52.unet_name` | `seedvr2_7b_int8_convrot.safetensors`; faster option: `seedvr2_3b_int8_convrot.safetensors` (also on Cloud) |
| upscale | seed | `54.seed` | 959948902156062 (template) |
| upscale | colour correction | `59.color_correction_method` | `wavelet` (see Problems) |
| upscale | (output) | `9` SaveImage | RGBA if the input had alpha |

**Models on Cloud (from `/object_info`):**
- Background removal: `birefnet.safetensors`.
- SeedVR2 VAE: `seedvr2_ema_vae_fp16.safetensors`.
- SeedVR2 diffusion models: 3B (`int8_convrot`, `fp16`, `fp8_e4m3fn`, `mxfp8`, `nvfp4`), 7B (same set) and `7b_sharp_*`.

## What ran

| # | Where | What | Wall-clock | Result |
|---|---|---|---|---|
| 1 | Cloud | `fixture_t2i.api.json` (Klein 4B t2i, 512²) | n/a | **403 free tier**, refused before running; not retried |
| 2 | local CPU (4 cores) | cutout, `birefnet.safetensors` (HF Comfy-Org/BiRefNet), 512² input, cold | 33.4 s (32.9 s exec, includes model load) | success |
| 3 | local CPU | cutout, warm, new input (flipped) | 28.1 s | success (the CPU cost is inference; on a GPU this should be about 1 s) |
| 4 | local CPU | upscale, `seedvr2_3b_fp8_e4m3fn` + `seedvr2_ema_vae_fp16`, 256² RGBA → 512², server started with `--fp8_e4m3fn-unet` | 81.3 s (sampler step 31 s) | success, alpha preserved; `lab` showed artifacts |
| 5 | local CPU | same graph, `59.color_correction_method=wavelet` | 1.0 s (only PostProcessing re-ran; everything upstream was cached) | success, clean |

Notes on the local runs:
- The local runs used **3B fp8**, not the template's 7B int8, because of CPU and RAM limits (15 GB). The graph is identical apart from `52.unet_name`.
- An earlier attempt without `--fp8_e4m3fn-unet` was OOM-killed: the 3B model is upcast to fp32 on CPU (about 13.8 GB RSS). This does not matter on Cloud GPUs.
- Because Cloud was blocked, I had no Klein fixture. Instead, `make_fixture.py` draws a procedural synthetic product (an orange bottle with a cap and loop handle) over a deliberately busy, blurred tile and clutter background, and writes the **exact ground-truth mask**. No real photos were used.

**Cutout quality, measured against the ground truth:**
- IoU 0.9997.
- Mean absolute alpha error 0.0008.
- 11 background pixels leaked and 1 product pixel was missed, out of 40,305 product pixels.
- Handle hole alpha = 0.0; body alpha = 0.996.

**Upscale quality:**
- Alpha max difference against a Lanczos-resized reference: 2/255.
- Mean colour shift: under 1 level per channel.

## Marketplace main-image check: `spikes/cutout-upscale/marketplace_main.py` (Pillow only, no Cloud)

The script:
1. Trims the RGBA cutout to its alpha bounding box (ignoring alpha below 8).
2. Scales the product so its longer side is 85% of a 2000x2000 #FFFFFF canvas, and centres it.
3. Flattens the result to RGB and saves it.
4. **Re-opens the written file**, so JPEG ringing is included in the check.

It passes (exit code 0) only if all of these hold:
- the canvas is 2000x2000 RGB;
- pixels in a 20 px border band are at least 99% exactly (255,255,255);
- the fill ratio is within 0.85 ± 0.01;
- the cutout really has transparency (at least 5% of its bounding box).

The last rule was added after a negative control: an **un-cut** busy photo letterboxed onto white also had a 100% white border. With the rule it is now rejected (exit code 1).

| Input | border_white | fill | transparent_frac | ok |
|---|---|---|---|---|
| BiRefNet cutout (512) → JPEG | 1.0 | 0.85 | 0.148 | ✅ |
| SeedVR2 upscale (512) → PNG | 1.0 | 0.85 | 0.138 | ✅ |
| opaque busy photo (negative control) | 1.0 | 0.85 | 0.0 | ❌ (correct) |

The check takes 0.16 s locally.

**Recommended app order:** cutout → SeedVR2 x4 (512 → 2048) → `marketplace_main.py`. Composing first and upscaling the composite would let SeedVR2 touch the white pixels; upscaling the RGBA cutout keeps the background exactly #FFFFFF.

## Output samples (`spikes/cutout-upscale/out/`)

- `fixture_product_busy_512.png`: the synthetic input.
- `cutout_rgba_512.png`: BiRefNet RGBA output.
- `marketplace_main_2000.jpg`: the compliant main image.
- `upscale_seedvr2_3b_256to512_rgba.png`: SeedVR2 with wavelet colour correction.
- `upscale_lab_vs_wavelet_512.png`: `lab` on the left (red and blue streaks), `wavelet` on the right (clean).

## Problems and workarounds

1. **Cloud submit returns 403 on the free tier.** No code workaround exists. The fix is to upgrade the plan, or point `COMFY_BASE_URL` at a self-hosted ComfyUI. BiRefNet (424 MB) plus the 3B SeedVR2 would be cheap to self-host.
2. **`lab` colour correction causes artifacts.** On flat or saturated colour, SeedVR2PostProcessing `lab` produced a bright red streak along the highlight and a blue fringe at the cap edge. `wavelet` is clean. The template ships `none`; I chose `wavelet` as the default. This should be re-checked on real photographic content on Cloud with 7B int8.
3. **3B on CPU runs out of memory.** It needs `--fp8_e4m3fn-unet` locally. This only affects local testing.
4. **Prompt caching skews re-run timings.** Re-submitting an unchanged graph re-runs only the save nodes (about 1 s). For timing, change the input image or the seed.
5. **Template subgraph values are promoted widgets.** Their values live in node `properties.proxyWidgets`, and the outer `widgets_values` is empty. Read the inner nodes' `widgets_values` instead. For KSampler the order is `[seed, control_after_generate, steps, cfg, sampler, scheduler, denoise]`, and `control_after_generate` must be dropped in API format.

## Files

All under `spikes/cutout-upscale/`:
- `build_graphs.py`: writes the three graphs.
- `cutout.api.json`, `upscale.api.json`: the deliverable graphs.
- `fixture_t2i.api.json`: Klein fixture graph, for Cloud later.
- `run.py`: Cloud runner (validates first, submits once, never retries).
- `run_local.py`: the same JSON sent to a self-hosted `/prompt`.
- `make_fixture.py`: synthetic fixture plus ground-truth mask.
- `marketplace_main.py`: the compliance check.
- `spike.sh`: the Cloud re-run once on a paid tier.
- `out/`: 5 samples.
