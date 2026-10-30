# Research index

Background research for [PLAN.md](PLAN.md), collected Oct 28–29, 2026.

- **Main findings:** [main-findings.md](research/main-findings.md) (exported from the private planning doc): challenge rules, Higgsfield vs ComfyUI feature map, Comfy Developer Platform traps, Higgsfield API prices, competing entries.
- **Reverse-engineering provenance:** [re-findings.md](research/re-findings.md): what was studied for the clean-room reimplementation, with coordinates and confidence tags. A record, not a runtime contract.
- **Challenge:** https://comfy.org/open-source-higgsfield/ — deadline Oct 30, 9am PT. Cutoff wording issue: https://github.com/Comfy-Org/ComfyUI_frontend/issues/21346

## Supplemental research (shared Oct 28–29)

- [Open-model product direction and Higgsfield UX research](research/open-model-product-direction-2026-10-29.md) — engineer-guidance alignment, model/component license audit, selected UX patterns, reproducibility evidence, and proposed release gates (October 29, 2026).
- [Higgsfield and ComfyUI: Research Report](research/higgsfield-comfyui-research.md) — platform comparison, how each works, GitHub popularity snapshot.
- [Higgsfield and ComfyUI: Repository Research and Reconstruction Guide](research/higgsfield-comfyui-repository-research.md) — 101-repo inventory (higgsfield-ai and Comfy-Org), Comfy reference apps, reconstruction method.

## Sources to re-clone (all public)

| What | Where |
|---|---|
| Higgsfield behaviour spec (skills: product-photoshoot, marketplace-cards, soul-id, evals) | https://github.com/higgsfield-ai/skills (0.14.0) |
| Higgsfield CLI docs and model schemas | https://github.com/higgsfield-ai/cli (README.md, MODELS.md) |
| Higgsfield API SDKs | https://github.com/higgsfield-ai/higgsfield-client, https://github.com/higgsfield-ai/higgsfield-js |
| Higgsfield studio UI (no licence: read for UX only, do not copy code) | https://github.com/higgsfield-ai/app-templates |
| Comfy docs source | https://github.com/Comfy-Org/docs |
| Comfy SDKs and self-host proxy (MIT) | https://github.com/Comfy-Org/comfy-python-sdk, https://github.com/Comfy-Org/comfy-typescript-sdk, https://github.com/Comfy-Org/comfy-api-proxy |
| Comfy reference apps (MIT, code pattern to copy) | https://github.com/Comfy-Org/comfy-reshoot, https://github.com/Comfy-Org/comfy-openjutsu, https://github.com/Comfy-Org/comfy-cinematic-studio, https://github.com/Comfy-Org/comfy-examples |
| Official workflow templates | PyPI `comfyui-workflow-templates==0.11.98` (JSON in `comfyui-workflow-templates-json==0.1.124`) |
| ComfyUI core (TrainLoraNode, SaveLoRA, dataset nodes) | https://github.com/Comfy-Org/ComfyUI `comfy_extras/nodes_train.py`, `nodes_dataset.py` |
| Competing entries | https://github.com/topics/open-source-higgsfield |

## Key doc pages (in Comfy-Org/docs)

- `development/api-development/sdks.mdx` — SDK usage and idempotency trap
- `development/comfyui-server/api-proxy.mdx` — self-hosted proxy
- `cloud/import-models.mdx` — Cloud LoRA import (Creator plan or higher, from Hugging Face or Civitai only)
- `interface/app-mode.mdx` — App Mode (`.app.json`)
- `built-in-nodes/TrainLoraNode.mdx`
- `tutorials/flux/flux-3-klein.mdx`
- `tutorials/video/minimax/minimax-h3.mdx` — H3 commercial-licence note for local outputs
