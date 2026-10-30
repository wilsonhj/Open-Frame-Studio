# Self-hosting: fetch and verify the models

How to put every model our workflows use into a self-hosted ComfyUI (behind `comfy-api-proxy`, with
`COMFY_BASE_URL` pointing at it) and prove the files are the ones we pinned.

Source of truth: `models/manifest.json`. Each row has the ComfyUI `folder`, the `filename` the
workflow expects, `source.download` (a Hugging Face URL pinned to `source.revision`), `sizeBytes`
and `sha256`. The size and hash are Hugging Face's LFS values at that revision, read through the
public API (`POST /api/models/<repo>/paths-info/<revision>`) on 2026-10-30. They are what the file
*should* be; `--verify` below checks what you actually have.

## What each workflow needs

| Workflow | Files | Download |
|---|---|---|
| `cutout` | `birefnet.safetensors` | 0.4 GB |
| `upscale` | `seedvr2_3b_int8_convrot`, `seedvr2_ema_vae_fp16` | 4.0 GB |
| `klein_t2i`, `klein_edit_multiref` | `flux-2-klein-4b`, `qwen_3_4b`, `flux2-vae` | 16.1 GB |
| `h3_r2v` | 5 MiniMax H3 files (DiT, Qwen3-VL text encoder, video VAE, audio VAE, turbo LoRA) | 44.4 GB |
| all | 11 files | 65.0 GB |

`image_resize_smoke` needs no model.

## Licences before you download

- FLUX.2 Klein 4B (and its VAE), Qwen3 4B, SeedVR2: Apache-2.0. BiRefNet: MIT.
- **MiniMax H3 is not permissive.** All five H3 files follow the conditional MiniMax H3 Community
  License; it excludes some territories, and self-hosted commercial outputs need a licence bought
  from Comfy (https://comfy.org/minimax/license). Comfy Cloud generations carry commercial rights;
  self-hosted ones don't by default. Read the licence before fetching the H3 rows.

## Fetch

From the ComfyUI root (the directory that holds `models/`). This prints one `curl` per manifest row;
drop the rows you don't need (H3 above all) before running it:

```bash
node -e '
const m = require("<path-to-this-repo>/models/manifest.json");
for (const e of m.models) console.log(
  `mkdir -p "models/${e.folder}" && curl -fL --retry 3 -C - -o "models/${e.folder}/${e.filename}" "${e.source.download}"`);
' > fetch-models.sh
less fetch-models.sh   # check it, then:
bash fetch-models.sh
```

The URLs are pinned to a revision, so a later upstream change can't swap a file under you. None of
the Comfy-Org repos are gated; no Hugging Face token is needed.

## Verify

```bash
node scripts/check-models.mjs --verify /path/to/ComfyUI/models
```

It checks each present file's size, then its sha256 (minutes for the 21 GB H3 DiT), and reports
`ok`, `mismatched` or `not present`. Exit status 1 means at least one mismatch. A file that isn't
there is reported but not an error, so a partial install (no H3) verifies cleanly.

## Then

1. Start ComfyUI and `comfy-api-proxy`, and set `COMFY_BASE_URL` (no `COMFY_API_KEY` needed).
2. `node scripts/check-object-info.mjs` checks the graphs against the saved Cloud snapshot. To
   check against your own server instead, save its `GET /object_info` and run
   `node scripts/check-object-info.mjs --refresh saved.json` in a scratch checkout. That rewrites
   `fixtures/golden/object_info.cloud.json`, so don't commit it as the Cloud snapshot.
3. `node scripts/golden-run.mjs --live --spend-credits --workflow cutout,upscale` runs golden jobs
   on your server. "spend-credits" is the same guard as for Cloud; on your own GPU it costs only time.

Until such a run is recorded, the README may say the app is *designed to* run on your own ComfyUI,
not that it does (docs/PLAN.md, "Licences and claims").
