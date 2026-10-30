# Open-Source Higgsfield on ComfyUI: main findings

> Exported Oct 29, 2026 from the planning research doc (origin: (private planning document, not published), private). This file is the durable copy; cite its sections, not the origin. Facts were gathered Oct 28–29, 2026 and may change.

Most Higgsfield features can be rebuilt with open-weights models already supported in ComfyUI; speech/TTS and Virality Predictor are the exceptions. This merges an analysis of the higgsfield-ai-skills and ComfyUI repos with an earlier Higgsfield vs ComfyUI research report.

## The challenge

Submissions to Comfy Org's Open Source Higgsfield challenge close Oct 30, 2026 at 9am PT, and winners are announced Nov 6, 2026. The prize pool is about $25,000. Comfy announced it on Oct 15 after challenging Higgsfield to open-source its platform; Higgsfield's help center says its platform and models are proprietary.

| Item | Detail |
| --- | --- |
| Rule: licence | App code published under an open-source licence, with setup instructions |
| Rule: platform | Built on the Comfy Developer Platform: Comfy API, Comfy Router and/or Comfy SDK |
| Track: Grand Prize | Best overall rebuild |
| Track: Open Weights Only | No partner nodes or closed-source APIs |
| Model prize: LTX | $2,000 cash |
| Model prize: FLUX | $1,000 / $500 / $250 in API credits |
| Model prize: MiniMax H3 | $1,000 in API credits |

The comfy.org page itself could not be fetched at the time (network policy), so these details come from news coverage and search results. Later secondary sources describe the prizes differently: a $10K grand prize, RTX 5090s for the Open Weights track, a $2K LTX VFX bonus, FLUX 3 API credits and $1K in MiniMax H3 credits. The site's wording on the cutoff time is inconsistent ([frontend issue #21346](https://github.com/Comfy-Org/ComfyUI_frontend/issues/21346)), so treat 9am PT as the hard deadline.

## Higgsfield vs ComfyUI

Higgsfield is a hosted suite organised around finished deliverables; ComfyUI is an open-source graph engine organised around reusable pipelines. They are not strictly either/or: ComfyUI already calls Higgsfield's Genjutsu as a paid partner node.

| Dimension | Higgsfield | ComfyUI |
| --- | --- | --- |
| Product | Hosted creative suite (Cinema Studio, Marketing Studio, Soul ID, Canvas, Supercomputer, Genjutsu, Audio) | Open-source engine and node-graph editor |
| Interaction | Task workspaces, prompts, references, Canvas boards, agents | Nodes, templates, subgraphs/blueprints, App Mode |
| Execution | Hosted only | Local, self-hosted, Comfy Cloud, optional partner API nodes |
| Developer access | CLI + agent skills, MCP, Python/JS SDKs, async API | Workflow JSON, HTTP/WebSocket API, Python/TS SDKs, custom nodes |
| Billing | Website credits; developer API is a separate prepaid USD balance | Local compute free; Comfy credits for Cloud and partner nodes |
| Output retention | API outputs kept at least 7 days, then may be removed | Local files kept by you |
| Trade-off | Packaged convenience, closed models | Full pipeline control; you own models, dependencies, versions |

Running a workflow through the Comfy SDK against a self-hosted ComfyUI needs an extra proxy (`comfy-api-proxy`).

## Feature map

Ten of twelve Higgsfield capabilities have an open-weights path in ComfyUI today; vector logos and Virality Predictor have none, and narrated video still needs an API for speech. "Powered by" comes from the Higgsfield skill files.

| Higgsfield capability | Powered by (per skills repo) | Open weights in ComfyUI | Partner/API node fallback |
| --- | --- | --- | --- |
| Soul ID (trained identity) | Per-person training on 5–20 photos (~30 min per the skills repo), then Soul image models | `TrainLoraNode` + dataset nodes; zero-shot Flux2 multi-reference, Qwen-Image-Edit 2509/2511, MiniMax H3 ReferenceToVideo | Nano Banana Pro/2, HeyGen Create Avatar |
| Product photoshoot | LLM prompt enhancer (10 modes) → GPT Image 2 | Qwen-Image-Edit / Flux2 + BiRefNet background removal + compositor | Bria Product Holding, Relight, Replace Background |
| Marketplace cards | Compliance-aware enhancer → Nano Banana Pro (main, secondary, A+) | Same edit stack + text overlay | Nano Banana |
| Marketing Studio UGC ads | Undisclosed reference-to-video with avatar and lipsync | Wan 2.2 S2V, HuMo, InfiniteTalk, LTXAV, MiniMax H3 | Kling Avatar 2.0, VEED Fabric, HeyGen |
| Video explainer | Seed Audio narration + Gemini Omni clips + server assembler | Wan / LTX / H3 image-to-video + video nodes; **no local TTS** | ElevenLabs, Fish Audio, Seed Audio |
| Genjutsu motion transfer | Higgsfield in-house | Wan Animate 2 and SCAIL-2 blueprints | Higgsfield Genjutsu node itself |
| Camera presets | Cinema Studio controls | `WanCameraEmbedding`, `CameraAngle`, WanMove tracks | Luma Concepts, Kling Motion Control |
| Reframe / outpaint | `reframe` workflow | Qwen-Image outpainting blueprint, Flux Fill | Luma Ray 3.2 Reframe, Bria Expand |
| Upscale | `bytedance_image_upscale` and similar | SeedVR2, SUPIR, MiniMax H3 latent upscaler | Topaz, Magnific, Flux Video Upscale V2 |
| YouTube thumbnail | Nano Banana Pro 4K + Seedream edits | Flux2 / Qwen-Image-Edit multi-reference + text overlay | Nano Banana Pro |
| Brandkit vector logos | Recraft V4.1 vector | No open vector-logo model | Recraft |
| Virality Predictor | Brain-response scoring model (`brain_activity`) | None | None |

PuLID, IP-Adapter and InstantID are not in core ComfyUI; they exist only as custom nodes, and IP-Adapter Plus has been maintenance-only since April 2025.

## higgsfield-ai-skills repo

The repo (v0.13.0 in the fork; upstream 0.14.0) ships agent skills that drive the `higgsfield` CLI; all generation runs on Higgsfield's servers.

| Skill | What it does | SKILL.md lines |
| --- | --- | --- |
| higgsfield-generate | 30+ image/video/audio/3D models, Marketing Studio, Virality Predictor | 322 (over the 300-line rule) |
| higgsfield-soul-id | Trains a face identity, returns `reference_id` | 85 |
| higgsfield-product-photoshoot | 10 modes, backend enhancer, GPT Image 2 | 215 |
| higgsfield-marketplace-cards | Main, secondary and A+ images via Nano Banana Pro | 88 |
| higgsfield-video-explainer | Seed Audio + Gemini Omni blocks, `explainer_video` assembly | 281 |
| higgsfield-websites | Sites, apps and browser games on Cloudflare Workers | 254 |
| higgsfield-brandkit | Palette, Recraft SVG logos, mockups, PPTX/PDF brandbook | 202 |
| higgsfield-youtube-thumbnail | 4K thumbnails with identity references and Seedream edits | 180 |

**Verified issues, most serious first**

1. The game pipeline's "first reference", `game-design-system.md`, points to `build-game.md` and `multiplayer.md`; neither exists.
2. COOKBOOK Recipe 3 promises a founder video with "face and voice" (no skill clones voices) and runs the image model `soul_cinematic` as a 60-second video.
3. Soul ID claims video use, but no skill routes `--soul-id` to a video model.
4. Skills contradict each other: `nano_banana_2` means Nano Banana Pro in some places; `--generate-audio` vs `--generate_audio`; `--timeout` vs `--wait-timeout`.
5. Stale project files: CLAUDE.md, CODEOWNERS (`/higgsfield-soul/`), issue templates, evals README.

## ComfyUI fork

The fork (wilsonhj/ComfyUI) is identical to upstream at v0.43.0. Recent upstream work adds MiniMax H3 support (Sol-H3 VAE, latent upscaler, six H3 nodes, an image-to-video blueprint).

**The existing Higgsfield node.** `comfy_api_nodes/nodes_higgsfield.py` wraps Genjutsu Motion Transfer (`genjutsu-v1.0`): a 4–30 s source video plus 1–8 reference images, at 480p/720p/1080p, billed through the Comfy proxy at $0.45, $0.97 or $2.33 per second.

**Coverage relevant to the contest:** Flux 2/3, Qwen-Image 2.1 and Edit, Z-Image; Wan 2.1/2.2 (S2V, Animate 2, HuMo, InfiniteTalk, Camera, VACE), LTX 2.x with joint audio, MiniMax H3; Stable Audio 3, ACE-Step 1.5 (no local TTS); Hunyuan3D, Trellis2; generic `TrainLoraNode`; 117 blueprints; 44 partner-node providers.

**Verified runtime issues (inherited from upstream):** `/upload/mask` returns 200 on a rejected save (`server.py:508`); the `__pycache__` skip never matches (`main.py:212`); an exception outside per-node execution kills the prompt worker; no authentication with `--listen`.

## Building on the Comfy Developer Platform

| Piece | What it is | Base URL | Package |
| --- | --- | --- | --- |
| Comfy API v2 | Runs a whole workflow graph: upload assets, submit job, poll, download outputs | `cloud.comfy.org`, `{deployment}.run.comfy.app`, or local proxy `127.0.0.1:8189` | in both SDKs |
| Comfy Router | One partner model per call, provider's native JSON body; "not generally available yet" | `api.comfy.org/v2/models/{provider}/{model}` | in both SDKs |
| Comfy SDK | Python (sync + async) and TypeScript clients | `COMFY_BASE_URL` / `COMFY_ROUTER_BASE_URL` | `comfy-sdk` 0.5.0, `@comfyorg/sdk` 0.5.0 |
| comfy-api-proxy | Serves API v2 in front of a local ComfyUI | `127.0.0.1:8189` | `comfy-api-proxy` 0.1.6 |
| App Mode | Turns any workflow into a one-screen app (`.app.json`); share links only on Comfy Cloud | n/a | frontend 1.41.13+ |

**Traps, verified in the docs or source**

1. A reused idempotency key is rejected (`422`), not replayed, and every `submit()` mints a new key, so a naive retry loop double-bills. Router keys replay instead.
2. Through the proxy, a job can report `unknown` after a ComfyUI restart; `run()` without a timeout loops forever.
3. Passing `metadata=` to the proxy fails (dict vs string).
4. No webhooks. Polling is authoritative; signed output URLs expire after about 6 hours, so re-host outputs.
5. The Cloud workflow API needs a paid Comfy Cloud plan (1 to 5 concurrent jobs by tier); free-tier keys get 403 on job submission. Router costs 211 credits per $1.
6. MiniMax H3 open weights: commercial use of locally generated outputs needs a licence bought from Comfy; Cloud outputs include it.
7. Comfy's docs have no LoRA training tutorial; `TrainLoraNode` has only a reference page, and no official template trains a LoRA. Comfy Cloud has no `SaveLoRA`, and imports LoRAs only from public Hugging Face or Civitai links (Creator plan or higher).
8. Comfy Cloud cannot list jobs (`GET /api/v2/jobs` → 501), so a lost job id cannot be recovered.

Best open starting templates (`comfyui-workflow-templates` 0.11.98, ~650 workflows, ~258 open weights): `video_minimax_h3_r2v`, `video_ltx2_3_id_lora`, `image_flux2_fp8`.

## Higgsfield today

Higgsfield claims more than 40M users and a $1B+ annual revenue run rate (Series B extension, Oct 23, 2026), and kept shipping during the contest (Genjutsu Lite Oct 19, Kling 4.0 Oct 21). Product facts come from search snippets.

**Developer API prices (open.higgsfield.ai, search snippets, approximate)**

| Model | Path | Price |
| --- | --- | --- |
| Soul 2 image | `higgsfield-ai/soul/v2/standard` | $0.003–0.006 per image |
| Soul ID training | `soul-id` | $2.50 per training |
| Genjutsu Light | `higgsfield/genjutsu-light/motion-transfer/v1.0` | $0.05–0.20 per second |
| MiniMax H3 | `minimax/h3/text-to-video` | about $0.065 per second at 2K |
| Kling 4.0 | `kling-video/v4.0/text-to-video` | about $0.07–0.16 per second |
| Seedance 2.5 | `bytedance/seedance-2.5/text-to-video` | about $0.14–0.21 per second |

The API is separate from the website: a prepaid USD balance ($5 minimum, 2 concurrent jobs for new accounts), `Authorization: Key id:secret`, `POST https://api.higgsfield.ai/<model-id>`, then poll `/requests/{id}/status`. The official JS SDK keeps polling a cancelled job until its 300-second limit because its status type omits `canceled`.

**Consumer product facts**

- Soul ID trains in about 3–5 minutes for 25 credits from 20–80 photos, and is not exportable.
- Cinema Studio 4.0: multi-shot scenes up to 30 s, up to 50 references, 3/7/16 credits per second at 480p/720p/1080p.
- Plans (Higgsfield's blog): Starter about $15/month, Plus $49, Ultra $129.

**CLI and repos**

- The `higgsfield` CLI is closed source (Go, private `cli-src`). The v1.2.3 binary calls `fnf-api-gw.higgsfield.ai/fnf`, logs in with Clerk OAuth plus PKCE (not device flow), detects the calling coding agent, and reports errors to Sentry.
- Four public workflows: `draw_to_video`, `reframe`, `voice-change`, `dubbing`.
- Upstream skills are at 0.14.0 with nine skills; `higgsfield-faceless-video` replaces the video explainer.
- The Cursor plugin uses only a hosted MCP server at `mcp.higgsfield.ai/mcp`.

## Competing entries

Of 17 public entries reviewed (Oct 29), none trains a persistent identity, builds product or marketplace images, or is built around MiniMax H3. Re-shoot and Cinema Studio clones are the most crowded.

| Entry | Clones | Open weights | Maturity |
| --- | --- | --- | --- |
| [comfyfield](https://github.com/ergophobian/comfyfield) | Marketing Studio: 22 UGC and viral formats | No (partner models) | Very high, about 56K LOC |
| [U-TTU-Studio](https://github.com/eNudimmud/U-TTU-Studio) | Cinema Studio as 3D previs, LTX re-shoot | Toggle | Very high, about 65K LOC |
| [gobo](https://github.com/RickBL99/gobo) | Cinema Studio: one line to a full film | No (Router) | High, live demo |
| [CreatorOS-Studio](https://github.com/thePloggy/CreatorOS-Studio) | Recurring AI-influencer studio, talking avatar | Yes | High, about 30K LOC |
| [dvsll/open-higgsfield](https://github.com/dvsll/open-higgsfield) | Local Director studio, experimental LoRA training | Yes | High |
| [one-shot-multicam](https://github.com/apsolut/one-shot-multicam) | One take to a multicam edit | Yes | High, live app |
| [freefield](https://github.com/droppedmyza/freefield) | Viral photo-to-clip effects | Yes | High |
| [seam](https://github.com/jdnichollsc/seam) | Transitions between images, clips, 3D | Yes | High |
| [opensfield](https://github.com/codyclack/opensfield) | Whole-platform clone, 146 tools | Mixed | Broad but shallow |
| [openjutsu](https://github.com/SydFloyd/openjutsu) | Genjutsu: recast, swap, restyle | Yes | Small, credible |
| [ReAngle](https://github.com/Tekholms-LW/ReAngle) | Re-shoot from a drawn 3D path | Yes | Solid |
| [pyoonpyoon/open-higgsfield](https://github.com/pyoonpyoon/open-higgsfield) | Angles plus camera moves | Yes | Medium |
| [fxjutsu](https://github.com/audriu/fxjutsu) | LTX VFX presets | Yes | Medium; no LICENSE file |

The remaining four (toybox-director, comfield, kevin9327, wide-trace) add little: kevin9327's showcase renders come from Blender scripts rather than models, and wide-trace calls Higgsfield's own API, not Comfy.

**Uncovered:** a persistent Soul reused across generators; product photoshoot and marketplace cards; an open-weights UGC talking-head ad; a model-based virality critic; anything built around MiniMax H3.

## Sources

- [Open Source Higgsfield · Comfy](https://comfy.org/open-source-higgsfield/)
- [ComfyUI Wiki: Open Source Higgsfield challenge](https://comfyui-wiki.com/en/news/2026-10-15-open-source-higgsfield)
- [ArtRealm AI: Comfy's $25K bounty](https://artrealmai.com/article/comfy-open-source-higgsfield-25k-challenge)
- [Comfy blog: Higgsfield promised to open source](https://blog.comfy.org/p/higgsfield-promised-to-open-source)
- [Comfy Developer Platform](https://comfy.org/platform/) and [Comfy SDK documentation](https://docs.comfy.org/development/api-development/sdks)
- Comfy-Org/docs, comfy-python-sdk, comfy-typescript-sdk, comfy-api-proxy (read from clones)
- [Higgsfield: what is Higgsfield](https://higgsfield.ai/creator-hub/help-center/getting-started/what-is-higgsfield), [API guide](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-the-higgsfield-api), [Genjutsu guide](https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-genjutsu), [changelog](https://higgsfield.ai/creator-hub/changelog), [Series B post](https://higgsfield.ai/blog/higgsfield-series-b-extension-tcv-nvidia)
- [Higgsfield developer API explore](https://open.higgsfield.ai/explore) and [quick start](https://open.higgsfield.ai/quick-start) (search snippets only)
- Higgsfield repos: [higgsfield-client](https://github.com/higgsfield-ai/higgsfield-client), [higgsfield-js](https://github.com/higgsfield-ai/higgsfield-js), [cli](https://github.com/higgsfield-ai/cli), [skills](https://github.com/higgsfield-ai/skills), [cursor-plugin](https://github.com/higgsfield-ai/cursor-plugin)
- [ComfyUI repository](https://github.com/Comfy-Org/ComfyUI), [IPAdapter Plus notice](https://github.com/cubiq/ComfyUI_IPAdapter_plus)
- [GitHub topic open-source-higgsfield](https://github.com/topics/open-source-higgsfield)
