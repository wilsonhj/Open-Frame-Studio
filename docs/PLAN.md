# Open Soul Studio — open-weights clone of Higgsfield Soul ID + Product Photoshoot + Marketplace Cards

## Context

Comfy's **Open Source Higgsfield** challenge closes **Oct 30, 9am PT (16:00 UTC)**. At planning time (Oct 29 06:30 UTC) that leaves **~33.5 h**. Winners are announced Nov 6.

**Prizes we target:**
- Grand Prize ($10K)
- Open Weights Only track (RTX 5090s)
- FLUX credits
- MiniMax H3 credits

**Entry rules:** an OSS licence, setup instructions, and built on the Comfy API, Router or SDK.

**Why this target.** The research (17 competitor repos, Higgsfield skills/CLI/SDKs, Comfy docs/SDK/templates) found two gaps no entry covers:
1. a persistent **Soul ID**: photos → identity → reused everywhere;
2. **product photoshoot + marketplace cards**.

Re-shoot and Cinema Studio clones are saturated. Nobody builds around MiniMax H3.

**The pitch.** "Higgsfield's Soul ID costs $2.50 or 25 credits per training and is locked to their platform. Ours trains on open weights, runs on Comfy, and the Soul is a `.safetensors` file you own."

**Decisions already made by the user:**
- **Compute:** Comfy Cloud on a paid plan. Self-hosted `comfy-api-proxy` is a documented fallback using the same code.
- **Headline:** Soul ID + Photoshoot.
- **Orchestration:** the Workflow tool in this session.
- **Code location:** a new MIT repo.

**What "reverse engineering" means here.** Clean-room behavioural reimplementation from public contracts: skills, CLI docs and binary metadata, SDK source, and Comfy reference apps.
- No bypassing of auth or billing.
- **No copying of `higgsfield-ai/app-templates` code.** That repo has no LICENSE file.
- We reproduce its UX from a written spec instead. Comfy's MIT reference apps supply the code pattern.

## Blockers to clear before Wave 0 (user actions)

> **Status (Oct 29):** network allowlist done in the cloud environment; `COMFY_API_KEY` added as a secret but not yet confirmed in a session; repo created (this one). Alternative: run on your Mac with Remote Control and `COMFY_API_KEY` in the shell.

1. **Network allowlist.** This environment's policy blocks:
   - `cloud.comfy.org` and `*.run.comfy.app` (Comfy API);
   - `api.comfy.org` (Router);
   - `huggingface.co`.

   Add them under the cloud environment menu → Edit → Network access → Allowed domains ([docs](https://code.claude.com/docs/en/cloud-environments#network-access)). Without this, agents can build and mock-test but cannot run real generations.
2. **Secret.** Add `COMFY_API_KEY` (from platform.comfy.org/profile/api-keys) as an environment secret. Never commit it.
3. **Plan tier.** Comfy Cloud must be **Creator or higher** if we want to import the demo Soul LoRA from Hugging Face.
4. **Repo.** Create `wilsonhj/open-soul-studio` (MIT), or let me create it. Add it to the session with push access.

## What we reverse-engineer: behavioural spec

Sources are the local skills (`higgsfield-ai/skills (local clone)`), the CLI `README.md` and `MODELS.md`, and the app-templates UX.

### Product Photoshoot
Source: `higgsfield-product-photoshoot/SKILL.md:50-200`.

- **10 modes:** `product_shot`, `lifestyle_scene`, `closeup_product_with_person`, `moodboard_pin` (2:3), `hero_banner` (≥16:9), `social_carousel` (3–10 slides, one shared style), `ad_creative_pack`, `virtual_model_tryout`, `conceptual_product`, `restyle`.
- **Request handling:** keyword/intent routing with tie-breakers. A ≤4-question interview with labelled chips across request types A–F.
- **Count and format:** 1–10 outputs that vary preset, lighting, angle and palette. Fixed 2k resolution. Aspect whitelist `1:1,4:5,5:4,3:4,4:3,2:3,3:2,9:16,16:9`.
- **Hidden on Higgsfield's side:** the per-mode prompt templates, default aspect ratios and the variation scheme. **We author these.**

### Marketplace Cards
Source: `higgsfield-marketplace-cards/SKILL.md:40-85`.

- **Scopes:** `main`, `product-images` (main + 5), `aplus` (main + 7), `full-set` (13).
- **Assets:** `main_image`, `infographic`, `multi_angle`, `detail_shot`, `lifestyle`, `whats_in_box`, `aplus_{hero_banner,pain_points,features,ingredients,efficacy,how_to_use,endorsement}`.
- **Main-image anchor:** secondary and A+ images are conditioned on the main image (`--main-job`).
- **Hidden on Higgsfield's side:** compliance rules and templates. **We author these:** pure-white background, product filling ~85% of the frame, no text on the main image.

### Soul ID
Source: `higgsfield-soul-id/SKILL.md` and `references/photo-guide.md:5-37`.

- **Input:** 5–20 photos, 8–12 ideal. One face per photo, varied angles and lighting, ≥1024 px. Reject group shots and sunglasses.
- **Output:** an id that generation consumes, `custom_reference_id`. Higgsfield's own product page says training takes 3–5 minutes.

### Coordinates
Every spec line in `docs/RE-FINDINGS.md` cites `file:line`, following `assets/findings-template.md` from the reverse-engineering skill. The findings doc also maps:
- Higgsfield's REST contract: `POST /<model>`, `GET /requests/{id}/status`, upload URL;
- CLI internals: `fnf-api-gw.higgsfield.ai/fnf`, Clerk PKCE;

and tags each claim *read in source*, *read in binary strings* or *inferred*.

## Architecture

Copy the Comfy reference-app pattern (MIT: comfy-reshoot, comfy-openjutsu, comfy-examples):

```
Next.js 16 App Router + React 19 + TS, Tailwind/shadcn (our own components)
app/api/jobs/route.ts              POST  validate → assets.fromBytes → setInput → comfy.submit → 202
app/api/jobs/[id]/route.ts         GET   jobs.get(id) → normalized {status, progress, outputs}
app/api/jobs/[id]/outputs/[oid]    GET   getDownloadUrl → fetch → stream (re-host; signed URLs die in ~6h)
app/api/pipelines/*                multi-step DAGs (soul, photoshoot, cards, motion) built on lib/pipeline.ts
lib/comfy.ts                       @comfyorg/sdk 0.5.0 client (pattern from comfy-reshoot lib/comfy.ts)
lib/bindings/<workflow>.ts         typed node-id/field maps per workflow (pattern from openjutsu lib/swap.ts)
lib/enhancer/                      deterministic mode templates + variation engine (+ optional open LLM upsampler)
lib/cards/                         sharp/canvas text+badge renderer with real fonts, compliance checker
workflows/*.api.json               API-format exports (subgraphs UNPACKED before export)
apps/*.app.json                    App Mode versions of each workflow (shown in demo + README)
comfy-pack/                        node pack: example_workflows/ + subgraphs/ blueprints (H3 r2v, Soul train)
```

**Runtime switch.** With no `COMFY_BASE_URL`, the app runs on Comfy Cloud. With `COMFY_BASE_URL=http://127.0.0.1:8189` it runs on self-hosted ComfyUI behind `comfy-api-proxy` (proves open weights end to end).

**Pipelines.**

| Tool | Steps | Base templates (`comfyui-workflow-templates` 0.11.98) |
|---|---|---|
| **Soul ID: Instant** (zero-shot, always available) | Photo QA (face count, size; client and server) → BiRefNet crops → pick best 3–6 refs → FLUX.3 Klein edit with `ReferenceMultiLatent` → identity preview sheet | `image_flux3_klein_image_edit.json` (no subgraph; inputs `LoadImage` 54, prompt 4/`Flux3LayoutPrompt` 49, `KSampler` 7) |
| **Soul ID: Trained** | One Cloud job: `LoadImage`×N → `ImageBatch` → resize → `MakeTrainingDataset` (trigger caption) → `TrainLoraNode` (Klein base int8, `bypass_mode` on, rank 16, lr 2e-4, ~400 steps, grad-ckpt) → `SaveLoRA` (job output = downloadable `.safetensors`) **and** in-graph `LoraModelLoader` → preview grid | `comfy_extras/nodes_train.py:955,1313,1364`; `nodes_dataset.py:1854` |
| **Photoshoot** | Mode router + interview chips → enhancer builds N varied prompts with a style lock → Klein edit with refs [product cutout, (+Soul refs or Soul LoRA)] → optional SeedVR2 2k upscale | Klein edit; BiRefNet `utility_birefnet_remove_background.json` (flatten); SeedVR2 `utility_seedvr2_7b_int8_upscale_image.json` (flatten) |
| **Marketplace Cards** | Main: BiRefNet cutout → deterministic composite on #FFFFFF at 85% fill (code, not diffusion) → compliance check. Secondary/A+: Klein edit conditioned on the main image + asset template → text/badges/infographic copy rendered in code | Klein edit + BiRefNet |
| **Motion** (H3 prize) | Soul still + product still → H3 reference-to-video (`<Picture 1>`, `<Picture 2>` prompt), turbo 4-step for live, 20-step for hero | `video_minimax_h3_r2v.json` (no subgraph; `LoadImage` 137/139, prompt 138, `MiniMaxH3ReferenceToVideo` 136, seed 129, duration 132, turbo 146) |

**Shared plumbing to reuse rather than reinvent:**
- Comfy SDK `Comfy`/`Job`/`Output` API (`comfy-python-sdk`, `comfy-typescript-sdk` 0.5.0).
- comfy-reshoot `lib/comfy.ts` and its outputs route.
- openjutsu's `swapWorkflow` graph-editing pattern.
- The official templates listed in the table.

**Known traps** (verified in SDK/proxy source). Bake each into `lib/comfy.ts`:
- Always pass a `timeout`. A proxy job can sit at `unknown` forever.
- Never auto-retry `submit()`. A reused idempotency key returns 422, and a fresh key double-bills.
- Don't pass `metadata`.
- Poll; don't rely on SSE.
- Re-host outputs.
- Export workflows in API format with subgraphs unpacked.

## Team plan: Workflow tool, 48 agents in 5 waves

**General rules:**
- **Contracts are frozen at the end of Wave 1.** These are `lib/types.ts`, the binding maps, the pipeline step interface and the API routes.
- **Each agent owns explicit paths only.** All agents run with `isolation: "worktree"`. The orchestrator merges team branches into `main` after each wave and runs the full checks.
- **Each brief includes:** the goal, owned paths, the contract files to import, the reference sources (paths above), the definition of done, and "no code from higgsfield-ai/app-templates".
- **Load the `workflow-authoring` skill before writing the script.**

### Wave 0: spikes and scaffold (T+0 → T+2h, 5 agents, needs network + key)

| # | Agent | Deliverable / definition of done |
|---|---|---|
| 1 | Spike: Cloud LoRA training | Minimal Klein-base `TrainLoraNode` graph runs on Cloud. Record wall time for 100/400 steps, whether `SaveLoRA` appears as a downloadable output, and whether in-graph `LoraModelLoader` works. **This sets go/no-go for trained Soul.** |
| 2 | Spike: Klein multi-ref identity | Export `image_flux3_klein_image_edit` in API format. Run with 3 face refs + 1 product ref. Measure identity quality and seconds per image. |
| 3 | Spike: H3 r2v on Cloud | Run `video_minimax_h3_r2v` turbo at 0.4 MP, 5 s. Record latency, cost and output. Confirm that commercial rights come with Cloud outputs. |
| 4 | Spike: BiRefNet + SeedVR2 flattened | Unpack the subgraphs, export API JSON, run both, and record node ids. |
| 5 | Scaffold | Repo skeleton: Next.js, `lib/comfy.ts` with traps handled, a mock Comfy server for offline tests (statuses `queued`/`running`/`succeeded`/`failed`/`unknown`), CI (lint, typecheck, `node --test`), MIT LICENSE. |

**Human checkpoint (15 min).** Choose a trained or instant Soul based on spike 1. If training on Cloud takes more than 10 min or fails, the trained Soul becomes a pre-trained demo character imported via Hugging Face, and Instant Soul carries the live demo.

### Wave 1: reverse-engineering specs and contracts (T+2 → T+4h, 6 agents)

| # | Agent | Deliverable |
|---|---|---|
| 6 | RE: Photoshoot spec | `docs/spec/photoshoot.md`: modes, routing rules, interview trees A–F, counts, aspects, with `file:line` citations |
| 7 | RE: Marketplace spec | `docs/spec/marketplace.md`: 13 assets, scopes, our compliance rules (main image: white, 85% fill, no text), per-asset aspect ratios |
| 8 | RE: Soul + platform contract | `docs/spec/soul.md` + `docs/RE-FINDINGS.md`: Higgsfield REST/CLI/SDK contract map and photo rules, with confidence tags |
| 9 | Contracts | `lib/types.ts` (Job, Asset, PipelineStep, ModeTemplate, CardAsset), `lib/bindings/*.ts` from spike node ids, OpenAPI for our routes |
| 10 | UX spec | `docs/spec/ux.md`: written description of the studio layout (sidebar, hero, prompt dock with mode rail and chips, gallery, Soul library). Text spec only, no copied code. |
| 11 | Test harness | Golden fixtures (sample product photos and a consenting demo face set), `tests/e2e/*.spec.ts` skeletons (Playwright), mock-server scenarios |

### Wave 2: parallel build (T+4 → T+14h, 24 agents)

| Team | Agents | Owned paths | Definition of done |
|---|---|---|---|
| **Graphs** | 8: `soul_train`, `soul_instant`, `photoshoot_edit`, `restyle_relight` (Qwen-2509 relight, optional), `cutout`, `upscale`, `motion_r2v`, `motion_i2v` (fallback) | `workflows/<name>.api.json`, `lib/bindings/<name>.ts`, `tests/graphs/<name>.test.ts` | Validates against Cloud `/object_info` (no unknown classes). One real golden run is saved to `fixtures/golden/`. Binding test proves every exposed input changes the graph. |
| **Enhancer** | 4: modes 1–5, modes 6–10, marketplace 13 templates, variation/style-lock engine + optional open LLM upsampler (Klein's `qwen3.5_9b_flux3_prompt_upsampler` via `TextGenerate`, keeping open weights) | `lib/enhancer/**` | Snapshot tests per mode. N variants differ in preset, light, angle and palette. Carousel shares a style block. |
| **Backend** | 5: job routes + output re-hosting; pipeline DAG runner (fan-out, per-step timeout, no auto-resubmit, resumable by job id); Soul registry (refs, LoRA file, export/download, HF-import guide); cards renderer (sharp + bundled OFL fonts, badges, infographic layouts) + compliance checker; cost/latency meter (Router `X-Comfy-Credits-Used`, timings) | `app/api/**`, `lib/pipeline.ts`, `lib/soul/**`, `lib/cards/**`, `lib/metrics.ts` | Unit tests against the mock server. No key appears in client bundles (grep the build output). |
| **Frontend** | 5: studio shell + gallery + history; Soul wizard (upload, live photo-quality checks, train/instant toggle, progress); Photoshoot dock (mode rail, interview chips, count, aspect); Cards board (scope picker, 13-tile grid, per-tile regenerate, ZIP export); Motion panel + job progress/cost HUD | `app/(studio)/**`, `components/**` | Playwright happy-path per tool on the mock server. Mobile layout passes. |
| **DevEx** | 2: README (quickstart for Cloud and self-host via `comfy-api-proxy`, `model-files.md` with HF URLs and sizes, H3 licence note, Klein gated-repo note); `apps/*.app.json` + `comfy-pack/` (example_workflows, subgraph blueprints for H3 r2v and Soul train, missing from official blueprints today) | `README.md`, `docs/setup/**`, `apps/**`, `comfy-pack/**` | A fresh clone reaches a running app in ≤10 min with only `COMFY_API_KEY` set. |

### Wave 3: integration and QA (T+14 → T+20h, 8 agents)

| # | Agent | Deliverable |
|---|---|---|
| 35–37 | E2E per tool on real Cloud | Soul → Photoshoot (6 modes) → Cards (full-set 13) → Motion. Fix-forward PRs. |
| 38 | Reviewer: correctness | Adversarial diff review: retry and double-billing, timeouts, binding drift |
| 39 | Reviewer: security and privacy | Key never client-side; upload validation (type, size, origin); face data deleted after the job; no PII in logs |
| 40 | Eval harness | Run the skills repo's eval scenarios (`evals/scenarios.md:99-200`) against our mode router. Report the pass rate. |
| 41 | Perf/cost tuning | Turbo vs full step counts, batch sizes. Target: Instant Soul preview <60 s, 4-image photoshoot <90 s, card set <4 min, H3 clip <3 min. |
| 42 | Golden demo assets | Pre-generate the hero set (trained demo Soul, product, 13 cards, 2 H3 clips) as the backup for the live demo |

**Human checkpoint.** Feature freeze at T+20h.

### Wave 4: demo and submission (T+20 → T+26h, 5 agents)

| # | Agent | Deliverable |
|---|---|---|
| 43 | Demo script | 3-minute live script: upload selfies → Instant Soul in ~1 min → photoshoot with you holding the product → 13-card Amazon set → H3 clip → "download your Soul". Trained-Soul results from a pre-run, plus a live training progress bar. |
| 44 | Demo video | ffmpeg-cut 2-minute recording from real runs (fallback if the live demo fails) |
| 45 | Comparison page | Higgsfield vs Open Soul Studio: features, price per output (Higgsfield API prices from research), ownership, open weights. Facts sourced. |
| 46 | Submission pack | Form text, licence check of all deps/models (FLUX.3 Klein licence, H3 commercial note, BiRefNet, SeedVR2), repo topics `open-source-higgsfield` |
| 47 | Final verifier | Fresh clone → setup → run all 4 tools on Cloud and on the self-hosted proxy path (if a GPU is available) → sign-off checklist |
| 48 | Orchestrator/merger | Merges, CI, tags `v1.0.0` |

**Buffer.** T+26 → T+33h covers slippage, live-demo rehearsal, and submission before 16:00 UTC Oct 30.

## Workflow script shape

```
phases: Spikes → Specs → Build → Integrate → Ship
- Spikes: parallel(5) → write docs/spikes/*.md; orchestrator pauses for human go/no-go.
- Specs: parallel(6) → contracts merged → freeze tag `contracts-v1`.
- Build: pipeline(teams) — each team's agents run in parallel worktrees; as each team finishes, a verifier agent
  runs its tests and opens fix tasks (bounded to 2 fix rounds) before merge.
- Integrate: parallel(8) with reviewers' findings fed back as targeted fix agents.
- Ship: parallel(5).
```

Run each wave as its own Workflow invocation, so a failure resumes with `resumeFromRunId` without re-running finished agents.

## Verification

- **Per graph:** `/object_info` class check plus a real Cloud run with outputs in `fixtures/golden/`. Binding tests prove that each exposed input mutates the graph.
- **Unit and mock:** `pnpm lint && pnpm typecheck && pnpm test` against the mock Comfy server (covers `unknown` status, 422 idempotency, timeout).
- **End to end:** Playwright drives Soul → Photoshoot → Cards → Motion on real Cloud. Assertions:
  - outputs exist;
  - main card background ≥99% #FFFFFF in border pixels and product bbox ≥80% of frame;
  - carousel style lock (palette distance);
  - identity score: face-embedding cosine between Soul refs and outputs, logged rather than gated.
- **Open-weights proof:**
  - same pipelines via `COMFY_BASE_URL` → `comfy-api-proxy` on a rented GPU, if one becomes available;
  - grep confirms no partner/API nodes in `workflows/*.api.json`.
- **Demo readiness:** two full timed rehearsals. The backup video plays offline.

## Risks and fallbacks

| Risk | Fallback |
|---|---|
| Cloud can't run `TrainLoraNode`, or it is too slow | Instant Soul (Klein multi-ref + H3 refs) is the live path. A trained LoRA from a GPU or pre-run is imported via HF and shown as "Trained Soul". |
| H3 latency or cost too high live | Turbo 4-step at 0.4 MP; a pre-rendered hero clip. |
| Subgraph export id drift | Unpack before export; binding tests catch drift. |
| Network or key not provided | Agents finish everything against the mock server; real runs move to the user's machine. |
| Judges question "open weights on Cloud" | Self-hosted proxy path documented and, ideally, demonstrated. No partner nodes anywhere. |
