# Spike 3: MiniMax H3 reference-to-video on Comfy Cloud ("Motion")

**Verdict: PARTIAL.** The graph is built, and every model it needs exists on Cloud. Nothing has run: job submission is blocked for this account (free tier, 403), the same blocker found in `lora-training.md`.

- **Built:** `h3_r2v.api.json` is a flattened API-format version of `video_minimax_h3_r2v.json`. Every class_type, input name and model filename was checked against live Cloud `/object_info`, and the dynamic-input key encoding was checked against the ComfyUI source.
- **Not run:** generation never ran. There are no timings, no frame, fps or audio checks, and no sample video.
- **Credits spent:** 0. Real submissions: 1 attempt (the fixtures job), refused with 403 before anything executed.
- **To finish:** once the account is on a paid tier (Creator or higher, see PLAN.md), `spikes/h3-r2v/spike.sh` finishes the spike in 2 submissions, or 3 with `--base`.

## Blocker

`client.submit()` returns `403 forbidden: "API key authentication is not available for free tier accounts"`. Read endpoints still return 200. There is no workaround in code. The options are to upgrade the Cloud plan, or to point `COMFY_BASE_URL` at a self-hosted ComfyUI.

Self-hosting H3 is heavy. The models total about 38 GB: a 19.5 GB DiT, a 14.6 GB text encoder and about 3 GB of VAEs. It also loses the Cloud commercial-rights benefit (see the licensing section below).

I attempted one submit (the fixtures job) and did not retry it.

## What was built

All files are in `./spikes/h3-r2v/`:

| File | Purpose |
|---|---|
| `build_graphs.py` | Generates the three graphs below. The prompt and sizes live here. |
| `h3_r2v.api.json` | The app graph, with turbo on (4 steps). |
| `h3_r2v_base20.api.json` | The same graph with turbo off (20 steps), for the comparison run. |
| `fixtures_t2i.api.json` | FLUX.2 Klein 4B (distilled, 4 steps). Makes a synthetic person (512x640) and a synthetic amber "GLOW" serum bottle (512x512) in one job. |
| `run.py` | Validates a graph against `/object_info`, submits it once, then waits with a timeout and saves the outputs. Copied from the klein-multiref spike. |
| `spike.sh` | One-shot re-run once the account is upgraded. It runs fixtures, then the turbo clip, then optionally `--base`, and probes each MP4 with ffprobe for frames, fps, audio stream and size. If the MP4 is under 5 MB it also copies it here. |

All three graphs pass local validation against Cloud `/object_info`, fetched 2026-10-29.

## Models on Cloud (confirmed via `/object_info`)

| Role | Template file | On Cloud? | Used |
|---|---|---|---|
| DiT (ref2va) | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | yes | same |
| Text encoder | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | yes (an `int8_convrot` version also exists) | same |
| Video VAE | `minimax_h3_video_vae_int8_convrot.safetensors` | **no** | `minimax_h3_video_vae_fp16.safetensors` (the only video VAE on Cloud) |
| Audio VAE | `minimax_h3_audio_vae_fp32.safetensors` | yes | same |
| Turbo LoRA | `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` | yes | same |

## Graph (node ids kept from the template; notes 116/117/140 dropped)

The chain is:

`137/139 LoadImage` → `136 MiniMaxH3ReferenceToVideo` (clip from 128, video VAE 119, audio VAE 120) → `126 BasicGuider` (model from `141 ComfySwitchNode`, which picks the base UNET 127 or LoRA 145) → `125 SamplerCustomAdvanced` (sampler `123 res_multistep`, scheduler `124 BasicScheduler simple`, steps from `142 ComfySwitchNode`, which picks 20 from 143 or 4 from 144; noise from 129) → `122 VAEDecode` and `121 VAEDecodeAudio` (both read the same joint latent) → `130 CreateVideo` (24 fps, with audio) → `92 SaveVideo`.

Supporting nodes:
- `115 ResolutionSelector` sets width and height.
- `132 PrimitiveFloat` feeds `131 ComfyMathExpression`, which turns duration into the frame `length`.

These API key encodings were verified in the ComfyUI source (`comfy_api/latest/_io.py`, where `finalize_prefix` joins keys with `.`):
- Autogrow inputs: `"ref_images.ref_image_0"`, `"ref_images.ref_image_1"`. This holds for up to 9 images (`ref_image_8`), and likewise for `ref_videos.ref_video_N`, `ref_video_audios.ref_video_audio_N` and `ref_audios.ref_audio_N`.
- Math input: `"values.a"`. Use output slot **1 (INT)** of node 131.
- Save format (a DynamicCombo): `"format": "auto"` plus `"format.codec": "auto"`.

Sizing for the planned run:
- `9:16 @ 0.4 MP, multiple 32` gives **480x864**.
- A duration of 5.0 gives `length = 124` frames, about 5.17 s at 24 fps. Lengths must sit on the 17k+5 grid, and the node tooltip gives the trained range as about 124–362 frames.

## App bindings (input node id → field)

| User input | Node.field | Notes |
|---|---|---|
| Person / Soul reference image (`<Picture 1>`) | `137.image` | Upload with `client.assets.from_file`, then `wf.set_input("137","image",asset)` |
| Product image (`<Picture 2>`) | `139.image` | Same as above |
| More refs (optional) | add a `LoadImage` node, then set `136.ref_images.ref_image_2` … `ref_image_8` to `[node,0]` | The tag is `<Picture N>`, where N = index + 1. Order is images, then videos, then audio. |
| Prompt | `138.value` | Must use the `<Picture N>` tags and give each reference a role |
| Seed | `129.noise_seed` | |
| Duration (s) | `132.value` | Snapped to a valid frame count by 131 |
| Turbo on/off | `146.value` | true = 4-step LoRA, false = 20 steps |
| Steps (base / turbo) | `143.value` / `144.value` | |
| Aspect / size | `115.aspect_ratio`, `115.megapixels` | |
| Reference fidelity | `136.ref_image_size` | `match` (fast) or `max` (best identity, several times slower) |
| Output | node `92` (SaveVideo) | MP4 with an audio track muxed in by 130 |

## Planned runs (not executed) and what to record

| Run | Graph | Params | Recorded |
|---|---|---|---|
| fixtures | `fixtures_t2i.api.json` | 2 images, 4 steps | — (403) |
| turbo | `h3_r2v.api.json` | 480x864, 124 frames, 4 steps, `match`, seed 42 | — |
| base (optional) | `h3_r2v_base20.api.json` | the same with 20 steps | — |

The prompt is in `build_graphs.PROMPT`: the woman from `<Picture 1>` holds up the `<Picture 2>` bottle and speaks one line.

When these run, record: wall-clock time, frame count, fps, whether there is an audio stream, and file size. `spike.sh` prints all of these.

## Licensing (verbatim from `tutorials/video/minimax/minimax-h3.mdx`)

> H3's open weights let you run the model locally. Commercial use of locally generated outputs requires a [MiniMax commercial license](https://comfy.org/minimax/license), available through Comfy, the only official reseller. Generations on Comfy Cloud already include commercial rights.

From the "Commercial licensing" section:

> Commercial use of locally generated outputs requires a license from Comfy. Comfy Cloud generations already include commercial rights.

This is a strong reason to keep Motion on Cloud rather than self-hosting.

## Problems and notes for the app

1. Free-tier 403 on submit is the blocker (see above).
2. The `int8_convrot` video VAE is not on Cloud, so the graph uses `minimax_h3_video_vae_fp16`. Any template-derived graph must make this substitution, or the server returns a 422 combo error.
3. The docs on turbo say: *"Optional 4-step Lightning LoRA (faster, weaker reference/audio). Prefer 20–25 steps when references must hold."* For Soul-consistent product presenters, the app should treat turbo as a preview and the 20-step run as the final render.
4. The template note says the `beta` or `normal` scheduler tends to beat `simple` for reference-heavy prompts. The graph keeps the template's `simple`. Worth an A/B test once runs are possible (`124.scheduler`).
5. R2V output is very sensitive to prompt wording. Tag every reference and state its role. The app's prompt builder should generate those tags itself.
6. The SDK traps were respected: `timeout=` on wait, no retry around `submit()`, no `metadata=`, and API format only.
