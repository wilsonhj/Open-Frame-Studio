# Spike 2: FLUX.3 Klein multi-reference identity ("Instant Soul" + photoshoot core)

**Verdict: PARTIAL (blocked; nothing ran on Cloud).** The graphs are built and validated, but there are 0 real runs.
There are two separate blockers, both outside the graph itself:

1. **This account cannot submit jobs with an API key.** `POST https://cloud.comfy.org/api/v2/jobs` and the legacy `/api/prompt` both return
   `403 {"code":"forbidden","message":"API key authentication is not available for free tier accounts"}`.
   This happens before any validation, even for a graph whose only node is an unknown class. Read endpoints still work with the same key
   (`/api/object_info`, `/api/experiment/models/*`, `/api/user` all return 200), and asset upload also succeeded.
   **This affects every Wave-0 spike that submits jobs.** The fix is to upgrade the Comfy Cloud plan, or to use a key from a paid account.
2. **The FLUX.3 Klein weights are not on Comfy Cloud yet** (checked 2026-10-29). These files are missing from `/api/experiment/models/{diffusion_models,text_encoders}`
   and from the `/object_info` combo lists:
   `flux3-image-klein-base-int8-convrot.safetensors`, `flux3-image-klein-int8-convrot.safetensors`,
   `qwen3vl_4b_int8_convrot.safetensors` and `qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors`. `flux2-vae.safetensors` is present.
   The code side is ready: `CLIPLoader` already lists `type=flux3`, and `ReferenceMultiLatent` and `Flux3LayoutPrompt` both exist.
   The closest stand-in is `qwen3vl_4b_bf16`/`fp8_scaled`, which is not the BFL-quantised encoder the template names.
   The weights live in a gated Hugging Face repo, so Cloud cannot pull them on its own.

Because neither blocker can be worked around from here, I added a **runnable fallback on FLUX.2 Klein**. Those weights are on Cloud today:
`flux-2-klein-4b` (distilled), `flux-2-klein-base-4b` and `flux-2-klein-9b`, with the encoders `qwen_3_4b` and `qwen_3_8b_fp8mixed`.
The fallback uses the same `ReferenceMultiLatent` multi-reference topology and the same node ids. It is ready to run once the account can submit.

Quality and speed were **not measured**. No timings exist. There is no local GPU (CPU-only container, 4 cores, 15 GB RAM), so a local run would not have been representative.

## What was built

All files are in `./spikes/klein-multiref/`:

| File | What it is |
|---|---|
| `klein_edit_multiref.api.json` | **Target graph.** A flattened API-format version of `image_flux3_klein_image_edit.json` (base int8, 50 steps, cfg 1, euler/simple). It has 3 face refs and 1 product ref, and the prompt uses `<ref_image_0>`…`<ref_image_3>`. |
| `klein_edit_multiref_distilled.api.json` | The same graph on the distilled checkpoint: 16 steps, cfg 1, negative = `ConditioningZeroOut` (as in `image_flux3_klein_distilled_image_edit.json`). |
| `flux2_klein_edit_multiref.api.json` | The runnable fallback: FLUX.2 Klein 4B distilled with the same refs and bindings. The sampler follows the FLUX.2 templates: `Flux2Scheduler` + `CFGGuider` + `SamplerCustomAdvanced`. |
| `flux2_klein_t2i_fixtures.api.json` | Planned run 1: a synthetic portrait (768×1024) and a sage-green mug (768×768) in one job. |
| `flux2_klein_views.api.json` | Planned run 2: two more views of the person from 1 reference (three-quarter profile; waist-up in a park). |
| `flux2_klein_scenes_{4b_distilled,9b_distilled,4b_base}.api.json` | Planned runs 3–5: (a) a lifestyle café scene at 1024², and (b) a studio banner with the person presenting the mug at 832×1216. Each uses 3 face refs + 1 product ref. |
| `build_graphs.py` | Generates every graph above. The prompts and the model and step presets are defined here. |
| `run.py` | Validates a graph against a saved `/object_info`, then submits it **once** with `comfy_sdk`. It never retries, uses `wait(timeout=…)`, saves outputs, and records the wall time. |
| `offline_validate.py` | Runs ComfyUI's real `execution.validate_prompt` on CPU, with empty placeholder model files. |
| `run_all.sh` | The 4-submission runbook to use once the account is upgraded. |
| `make_placeholder_product.py`, `artifacts/placeholder_mug.png` | A procedurally drawn mug (plain test image, no diffusion). |

**Template changes made while flattening:**
- The prompt-upsampler branch is dropped: `TextGenerate` 47, `PrimitiveStringMultiline` 48, `BatchImagesNode` 50, `ComfySwitchNode` 51 and `PreviewAny` 34/52. In the template the switch is set to `false` anyway. Prompt text now goes straight into `CLIPTextEncode` 4.
- The bounding-box nodes (`CreateBoundingBoxes` 55, `Flux3LayoutPrompt` 49) are dropped. Multi-reference tokens are plain text in the prompt. Only add `Flux3LayoutPrompt` back if you want `<obj_N>` regional boxes.
- **Output size:** the template feeds `ReferenceMultiLatent` output 2 to `KSampler.latent_image`. That output is the first reference multiplied by 0, so the output size always equals the size of face ref 0. I connected `EmptyFlux2LatentImage` 44 instead, so the app can choose the aspect ratio.
- **Extra references:** added `LoadImage` nodes 60, 61 and 62. In API format, Autogrow and DynamicCombo inputs are dotted keys: `"images.image0".."images.image3"`, `"resolution": "resize"`, `"resolution.megapixels": 1.0`. Following the template note, references are attached to both positive and negative.

## Validation results (free; no runs)

- Local check against Cloud `/api/object_info` (class names, input names, combo values):
  - All FLUX.2 graphs pass.
  - The FLUX.3 graphs fail **only** on the missing model files (`unet_name`, `clip_name`).
- ComfyUI's own validator (`<workspace>/ComfyUI` HEAD `0df1646`, 2026-10-28, CPU torch 2.15) returns `valid=True` for all 8 graphs. This covers the dotted Autogrow and DynamicCombo keys and link types.
  - A negative test (wrong link type) was rejected correctly, so the validator does catch real errors.
- I could not get a server-side 422 check, because the 403 comes back before validation.

## App bindings (API node id → field)

Target FLUX.3 graph (`klein_edit_multiref.api.json`):

| User input | Node.field |
|---|---|
| Face ref 1 / 2 / 3 | `54.image`, `60.image`, `61.image` (`LoadImage`; set with `wf.set_input(id,"image",asset)`) |
| Product ref | `62.image` |
| Prompt (use `<ref_image_0..3>`) | `4.text` |
| Output size | `44.width`, `44.height` (multiples of 16) |
| Seed / steps / cfg | `7.seed`, `7.steps`, `7.cfg` (`KSampler`) |
| Reference detail / cost | `17.resolution.megapixels` (1.0 by default; `"resolution":"keep resolution"` disables resizing) |
| Checkpoint | `59.unet_name` (base vs distilled; with distilled use `58` = `ConditioningZeroOut`, 16 steps, cfg 1) |
| Result | `SaveImage` node `9` |

To use fewer references, delete the `images.imageN` key and its `LoadImage` node. To use more, add `images.image4` and so on, up to 100.

FLUX.2 fallback (`flux2_klein_edit_multiref.api.json`) uses the same ids for 54/60/61/62, 4, 17, 44 and 9. The sampler fields move:

| Field | Node.field |
|---|---|
| Seed | `70.noise_seed` (`RandomNoise`) |
| Steps | `71.steps` (`Flux2Scheduler`; keep `71.width/height` equal to `44`) |
| cfg | `72.cfg` (`CFGGuider`) |

FLUX.2 prompts refer to references as "image 1…4" in plain words, not `<ref_image_N>`.

## Run plan once unblocked (≤4 submissions)

`run_all.sh`:
1. Run 1: fixtures.
2. Run 2: two more views.
3. Run 3: both scenes on 4B distilled (4 steps).
4. Run 4: both scenes on 9B distilled.
5. Optional run 5: 4B base (20 steps, cfg 5), only if a base-vs-distilled speed comparison is needed.

Then swap in `klein_edit_multiref*.api.json` once Cloud lists the FLUX.3 files.

Record `wall_s` from `artifacts/r*/job_*.json`. Each job runs two images that share loaders, so divide by 2 for a rough per-image cost after the first cold load.

## Licensing notes (for model choice)
- FLUX.2 Klein **4B**, base and distilled: Apache-2.0. **This is the safest default for the app.**
- FLUX.2 Klein **9B**: FLUX non-commercial licence.
- FLUX.3 Klein: FLUX Kommunity License; check the terms before shipping.

## Fixtures
- No synthetic portrait exists, because generating one needs a Cloud run. Other spikes should not expect `fixtures/portrait*.png` from this spike.
- `.../scratchpad/spike-out/fixtures/product_mug_placeholder.png` is a procedural test image (768², white background). It is usable for cutout and composite tests, but not for photoreal quality checks.

## Recommendation
- Instant Soul's design is unaffected. The graph shape is the same on FLUX.2 and FLUX.3; only the loaders and sampler nodes differ.
- Ship the **FLUX.2 Klein 4B distilled** fallback as the default model preset. Keep FLUX.3 behind a flag until Cloud hosts its weights.
- Re-run this spike as soon as the account tier allows API-key jobs.
