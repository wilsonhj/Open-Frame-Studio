# Update after Wave 0 (Oct 29, 19:40 UTC)

Wave 0 findings are in `docs/spikes/`. They change the plan below as follows:

- **Account:** the Comfy Cloud key was on a free tier, which refuses job submission (403). The user is moving to a paid key; a new session is needed to load it.
- **Model:** FLUX.3 Klein is not deployed on Comfy Cloud. **FLUX.2 Klein 4B distilled** (Apache-2.0, on Cloud) is the default everywhere; FLUX.3 stays behind a flag.
- **Soul ID is Instant only.** Comfy Cloud has no `SaveLoRA` node, so a trained LoRA can't be downloaded. A Soul is the curated reference set (3–6 best crops after photo QA) plus a style card, saved as a portable `soul.json` with images. The trained-LoRA path and the `soul_train` graph agent are dropped; `spikes/lora-training/` stays as research. Body references to a trained Soul, Soul LoRA, `soul_train` or a train toggle are superseded. **Reuse gate:** a Soul counts as reusable only after test S-R1 passes (`docs/spec/soul.md` §6.6).
- **H3:** use `minimax_h3_video_vae_fp16` (the int8 VAE is not on Cloud). Turbo weakens reference fidelity, so use 20–25 steps for hero clips.
- **Upscale:** SeedVR2 3B with `wavelet` colour correction (`lab` streaks flat colour).
- **Starting graphs for Wave 2:** `workflows/*.api.json` (canonical); `spikes/**/*.api.json` are frozen spike records, not sources.
- **Schedule:** Wave 1 (specs, no Cloud) now; Cloud spike re-run once the paid key works; Wave 2 from ~21:30 UTC; submit by 12:00 UTC Oct 30.
- **Identity gate:** identity preservation is an acceptance gate (`docs/eval/identity.md`): blind 2-reviewer same-person review on a fixed synthetic set (Soul preview, 3 person photoshoot modes, 1 H3 frame); pass ≥80% overall, every surface ≥2/3, decoys rejected. SFace/YuNet cosine is reported with its calibration but is advisory. Blocks feature freeze and the v1.0.0 tag.
- **Critical path (PR #1 review):** P0 = first Cloud batch (`cutout`, `klein_edit_multiref`, one H3 turbo smoke clip to de-risk) → Instant Soul → Photoshoot (table-driven; E2E covers product_shot, lifestyle_scene+Soul, virtual_model_tryout+Soul, social_carousel) → identity gate. P1 = Cards main_image + lifestyle, multi_angle, infographic, aplus_hero_banner; Motion (turbo preview + one pre-rendered 20-step hero clip, H3 track). P2 = the other 8 card assets, SeedVR2 on photoshoot outputs, self-host proxy demo, apps/*.app.json and comfy-pack, spend panel. Cut from v1: `restyle_relight`, `motion_i2v`, the LLM upsampler, VLM style-card auto-fill.

---

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

**The pitch.** "Higgsfield's Soul ID costs $2.50 or 25 credits per training and is locked to their platform. Ours needs no training, runs open weights on Comfy, and the Soul is a portable `soul.json` + reference images you own."

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
3. **Repo.** Create `wilsonhj/open-soul-studio` (MIT), or let me create it. Add it to the session with push access.

## Behaviour specs and provenance

- Behaviour specs live in `docs/spec/{photoshoot,marketplace,soul,ux,api}.md`.
- Runtime lists (modes, aspects, card assets) live in `lib/contracts/*.ts` as the single source; specs and code read them from there.
- Provenance (what was studied, with `file:line` coordinates and confidence tags) lives in `docs/research/re-findings.md`. It is a record, not a runtime contract.
- The clean-room rules are in Context above: public contracts only, no auth or billing bypass, no `higgsfield-ai/app-templates` code.

## Architecture

Copy the Comfy reference-app pattern (MIT: comfy-reshoot, comfy-openjutsu, comfy-examples):

```
Next.js 16 App Router + React 19 + TS, Tailwind/shadcn (our own components)
app/api/jobs/route.ts              POST  validate → assets.fromBytes → setInput → comfy.submit → 202
app/api/jobs/[id]/route.ts         GET   jobs.get(id) → normalized {status, progress, outputs}
app/api/jobs/[id]/outputs/[oid]    GET   getDownloadUrl → fetch → stream (re-host; signed URLs die in ~6h)
app/api/pipelines/[kind]/*         one route set for soul|photoshoot|cards|motion: a flat PipelineStep[] (dependsOn, fixed at plan time) run by lib/pipeline/ (step runner)
lib/comfy.ts                       @comfyorg/sdk 0.5.0 client (pattern from comfy-reshoot lib/comfy.ts)
lib/bindings/<workflow>.ts         typed node-id/field maps per workflow (pattern from openjutsu lib/swap.ts)
lib/enhancer/                      one MODE_TEMPLATES table (10 rows) + INTERVIEW table (A–F) + one pure variation/style-lock engine
lib/cards/                         sharp/canvas text+badge renderer with real fonts, compliance checker, CARD_SPECS table (13 rows), per-asset pure layout functions
workflows/*.api.json               CANONICAL. API format, subgraphs unpacked. The only graphs the app loads.
apps/*.app.json                    DERIVED, stretch. App Mode wrappers for judges; never loaded by the app.
comfy-pack/                        DERIVED, stretch. example_workflows/ copied from workflows/, plus the H3 r2v subgraph blueprint.
lib/store.ts                       durable run store (.data/, JSON per run)
instrumentation.ts                 boot: resumeRuns()
```

A CI check (`scripts/check-derived.mjs`) must show node ids, class_type and bound inputs in apps/ and comfy-pack/ match workflows/; without it they don't ship.

**Runtime switch.** With no `COMFY_BASE_URL`, the app runs on Comfy Cloud. With `COMFY_BASE_URL=http://127.0.0.1:8189` it runs on self-hosted ComfyUI behind `comfy-api-proxy` (proves open weights end to end).

**Pipelines.**

| Tool | Steps | Base templates (`comfyui-workflow-templates` 0.11.98) |
|---|---|---|
| **Soul ID: Instant** (zero-shot, always available) | Photo QA (face count, size; client and server) + crop + pHash dedupe (code, CPU) → pick best 3–6 refs → FLUX.2 Klein 4B edit with `ReferenceMultiLatent` → identity preview sheet (optional; the only Comfy step) → `soul.json` | `workflows/klein_edit_multiref.api.json` (FLUX.2 Klein 4B edit, multi-ref; bindings in `lib/bindings/klein_edit_multiref.ts`) |
| **Photoshoot** | Mode router + interview chips → enhancer builds N varied prompts with a style lock → Klein edit with refs [product cutout, (+Soul refs)] → optional SeedVR2 2k upscale (P2) | Klein edit; BiRefNet `utility_birefnet_remove_background.json` (flatten); SeedVR2 `utility_seedvr2_7b_int8_upscale_image.json` (flatten) |
| **Marketplace Cards** | Main: BiRefNet cutout → deterministic composite on #FFFFFF at 85% fill (code, not diffusion) → compliance check. Secondary/A+: Klein edit conditioned on the main image + asset template → text/badges/infographic copy rendered in code | Klein edit + BiRefNet |
| **Motion** (H3 prize) | Soul still + product still → H3 reference-to-video (`<Picture 1>`, `<Picture 2>` prompt), turbo 4-step for live, 20-step for hero | `video_minimax_h3_r2v.json` (no subgraph; `LoadImage` 137/139, prompt 138, `MiniMaxH3ReferenceToVideo` 136, seed 129, duration 132, turbo 146) |

**Shared plumbing to reuse rather than reinvent:**
- Comfy SDK `Comfy`/`Job`/`Output` API (`comfy-python-sdk`, `comfy-typescript-sdk` 0.5.0).
- comfy-reshoot `lib/comfy.ts` and its outputs route.
- openjutsu's `swapWorkflow` graph-editing pattern.
- The official templates listed in the table.

**Known traps** (verified in SDK/proxy source). `lib/comfy.ts` is a thin SDK wrapper (client, submit-once, poll with a required timeout, re-host outputs, reject UI-format graphs). It never retries. The run store and step runner own the key discipline below:
- Always pass a `timeout`. A proxy job can sit at `unknown` forever.
- Never auto-retry `submit()` under a new key. Mint the key, persist it, then submit. After an ambiguous failure, re-send only under the same key (API v2 rejects it with 422 if the first POST landed). A 422 reuse with no stored job id is `submit_unconfirmed` and is never resubmitted (Cloud cannot list jobs: 501).
- Don't pass `metadata`.
- Poll; don't rely on SSE.
- Re-host outputs.

## Team plan: Workflow tool, ~45 agents (Wave 2: 26)

**General rules:**
- **Contracts freeze in two stages:** public types and APIs at `contracts-v1`; graph node ids at `bindings-v1` after golden runs. Public types are `lib/contracts/*.ts` (re-exported by the barrel `lib/types.ts`).
- **Each agent owns explicit paths only.** All agents run with `isolation: "worktree"`. The orchestrator merges team branches into `main` after each wave and runs the full checks.
- **Each brief includes:** the goal, owned paths, the contract files to import, the reference sources (paths above), the definition of done, and "no code from higgsfield-ai/app-templates".
- **Load the `workflow-authoring` skill before writing the script.**

### Wave 0: spikes and scaffold (T+0 → T+2h, 5 agents, needs network + key)

| # | Agent | Deliverable / definition of done |
|---|---|---|
| 1 | Spike: Cloud LoRA training | Minimal Klein-base `TrainLoraNode` graph runs on Cloud. Record wall time for 100/400 steps, whether `SaveLoRA` appears as a downloadable output, and whether in-graph `LoraModelLoader` works. **Result: no `SaveLoRA` on Cloud; Instant Soul only (see top).** |
| 2 | Spike: Klein multi-ref identity | Export `image_flux3_klein_image_edit` in API format (superseded: FLUX.2 Klein 4B, see top). Run with 3 face refs + 1 product ref. Measure identity quality and seconds per image. |
| 3 | Spike: H3 r2v on Cloud | Run `video_minimax_h3_r2v` turbo at 0.4 MP, 5 s. Record latency; record cost from the workspace usage endpoint after an isolated run (hourly bucket, after it settles). Record the output. Confirm that commercial rights come with Cloud outputs. |
| 4 | Spike: BiRefNet + SeedVR2 flattened | Unpack the subgraphs, export API JSON, run both, and record node ids. |
| 5 | Scaffold | Repo skeleton: Next.js, `lib/comfy.ts` with traps handled, a mock Comfy server for offline tests (statuses `queued`/`running`/`succeeded`/`failed`/`unknown`), CI (lint, typecheck, `node --test`), MIT LICENSE. |

**Human checkpoint (15 min).** Decided: Instant Soul only (spike 1 found no `SaveLoRA` on Cloud; see the top section).

### Wave 1: reverse-engineering specs and contracts (T+2 → T+4h, 6 agents)

| # | Agent | Deliverable |
|---|---|---|
| 6 | RE: Photoshoot spec | `docs/spec/photoshoot.md`: modes, routing rules, interview trees A–F, counts, aspects, with `file:line` citations |
| 7 | RE: Marketplace spec | `docs/spec/marketplace.md`: 13 assets, scopes, our compliance rules (main image: white, 85% fill, no text), per-asset aspect ratios |
| 8 | RE: Soul + platform contract | `docs/spec/soul.md` + `docs/research/re-findings.md`: Higgsfield REST/CLI/SDK contract map and photo rules, with confidence tags |
| 9 | Contracts | `lib/contracts/*.ts`, barrel `lib/types.ts` (Job, Asset, PipelineStep, ModeTemplate, CardAsset), `lib/bindings/*.ts` from spike node ids, OpenAPI for our routes |
| 10 | UX spec | `docs/spec/ux.md`: written description of the studio layout (sidebar, hero, prompt dock with mode rail and chips, gallery, Soul library). Text spec only, no copied code. |
| 11 | Test harness | Golden fixtures (sample product photos and a consenting demo face set), `tests/e2e/*.spec.ts` skeletons (Playwright), mock-server scenarios |

### Wave 2: vertical slices (≈21:30 → 05:30 UTC, 18 builders + 7 verifiers)

**Ownership.** Every path has exactly one owner, listed in `docs/OWNERS.md`. `scripts/check-owners.mjs` runs in CI and fails a branch that touches paths outside its slice. The orchestrator alone owns `lib/contracts/**`, `lib/types.ts`, `lib/pipeline/{types,kinds}.ts`, `package.json`, `pnpm-lock.yaml`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `fixtures/products/**` and `docs/PLAN.md`. Slices request contract or dependency changes in their handbacks; the orchestrator applies them additively at checkpoints.

**W2.0 Skeleton (orchestrator, serial).** Commit Wave 1 and tag `contracts-v1`. Add all Wave 2 dependencies at once (sharp, a zip library, OFL fonts, a face detector). Freeze `lib/pipeline/types.ts` `PipelineDefinition<K>` `{validate, plan, handlers, buildResult, actions}`. Put stubs at every cross-slice import point: `lib/pipeline/kinds.ts` → `lib/{soul,photoshoot,cards,motion}/pipeline.ts`; `lib/soul/registry.ts` signatures (`listSouls`, `getSoul`, `bestRefs`, `ensureAssets`); `lib/bindings/prepare.ts` `prepareGraph`; `components/soul/soul-library.tsx`; `components/ui/*`; `lib/client/use-run.ts`; 501 routes under `app/api/pipelines/[kind]/`.

| Slice | Agents (sub-paths) | Owns | Imports read-only | Definition of done |
|---|---|---|---|---|
| **A Runtime** | 3: A1 store, step runner, reconcile; A2 routes, request + upload, action dispatch, runs list; A3 metrics, status, mock scenarios | `lib/pipeline/**` (not `types`/`kinds`), `lib/store.ts`, `instrumentation.ts`, `lib/comfy.ts`, `lib/inputs.ts`, `lib/metrics.ts`, `app/api/{jobs,pipelines,runs,status}/**`, `tests/mock-comfy/**`, `tests/{comfy,inputs}.test.ts`, `tests/{pipeline,store}/**`, `docs/spec/api.md` | `lib/contracts/**`, `lib/pipeline/{types,kinds}.ts`, `lib/bindings/**` | Pipeline step runner: one module, no graph engine; ready = pending steps whose `dependsOn` all succeeded, run with `Promise.all`, persist each transition (≤ ~250 lines). Durable run store (`.data/runs/<id>.json`, temp+fsync+rename) with boot reconciliation per `docs/spec/api.md` §2.0. Runner tests: crash after the key is persisted but before the POST → re-send gets 201, one job; `drop_after_create` → 422 → `submit_unconfirmed`, 2 POSTs, 1 job; restart with a `jobId` → polled, never re-POSTed; deadline not extended across a restart; a full-set cards run (13 tiles, ~17–26 Comfy steps) killed mid fan-out finishes after `resumeRuns()`. A fake definition runs end to end. Latency from v2 job metrics; no cost per job ("not reported" or a labelled estimate). No key in build output (grep). |
| **B Graphs & Cloud** | 2: B1 bindings, `prepareGraph`, object_info check, golden runner; B2 `apps/`, `comfy-pack/` (stretch) | `workflows/**`, `lib/bindings/**`, `tests/bindings.test.ts`, `tests/graphs/**`, `fixtures/golden/**`, `scripts/{golden-run,check-object-info}.mjs`, `apps/**`, `comfy-pack/**`, `docs/spikes/**` | `lib/contracts/**` | Offline `checkBinding` clean; no partner nodes. With a working key: object_info check + one golden run per workflow → tag `bindings-v1`. |
| **C Soul** | 3: C1 QA, crop, select; C2 registry, bundle, pipeline, `app/api/souls`; C3 UI + Rail library | `lib/soul/**`, `app/api/souls/**`, `app/soul/**`, `components/soul/**`, `tests/soul/**`, `tests/e2e/soul.spec.ts`, `docs/spec/soul.md` | contracts, `lib/pipeline/types.ts`, `lib/bindings/prepare.ts`, `components/ui/*`, `lib/client/*` | Refs persisted before the preview step; S-R1 on mock; wizard Playwright. |
| **D Photoshoot** | 3: D1 `lib/enhancer/modes.ts` (all 10 modes); D2 variation/style lock, router, interview, pipeline, item retry; D3 UI | `lib/enhancer/**`, `lib/photoshoot/**`, `app/photoshoot/**`, `components/photoshoot/**`, `tests/{enhancer,photoshoot}/**`, `tests/e2e/photoshoot.spec.ts`, `docs/spec/photoshoot.md` | contracts, `lib/soul/registry.ts`, `lib/pipeline/types.ts`, `lib/bindings/prepare.ts`, `components/{ui,soul}/*`, `lib/client/*` | Snapshot per table row; variants differ on 4 axes; carousel and ad pack share one style block; `photoshoot.md` §10 tests; Playwright for 2 modes. |
| **E Cards** | 3: E1 main image + compliance; E2 renderer, layouts, fonts; E3 `CARD_SPECS`, pipeline, regenerate/export, board UI | `lib/cards/**`, `assets/fonts/**`, `app/cards/**`, `components/cards/**`, `tests/cards/**`, `tests/e2e/cards.spec.ts`, `docs/spec/marketplace.md` | contracts, `lib/pipeline/types.ts`, `lib/bindings/prepare.ts`, `components/ui/*`, `lib/client/*` | Main image: ≥99% white border, product bbox ≥80%, no text. P1 assets on mock. Regenerate changes only the seed. ZIP + `cards.json`. |
| **F Motion** | 2: F1 person resolve, `<Picture N>` prompt, pipeline; F2 UI | `lib/motion/**`, `app/motion/**`, `components/motion/**`, `tests/motion/**`, `tests/e2e/motion.spec.ts` | contracts, `lib/soul/registry.ts`, `lib/pipeline/types.ts`, `lib/bindings/prepare.ts`, `components/{ui,soul}/*`, `lib/client/*` | Exactly one person source; final = turbo off, 20 steps; Playwright on mock. |
| **G Shell & DevEx** | 2: G1 shell, `components/ui`, `lib/client`; G2 README, setup, CI | `app/{layout.tsx,page.tsx,globals.css}`, `app/{runs,smoke}/**`, `components/{shell,ui}/**`, `components/{job-runner,coming-soon}.tsx`, `lib/client/**`, `tests/e2e/{smoke,shell}.spec.ts`, `playwright.config.ts`, `README.md`, `docs/setup/**`, `docs/spec/ux.md`, `.env.example`, `.github/**` | contracts, `app/api/**` responses | Mobile layout; History from server runs; fresh clone → running app in ≤10 min with only `COMFY_API_KEY` set. |

**Freeze rule.** `contracts-v1` freezes `lib/contracts/**`, the `apply.ts` exports, the `BINDINGS`/`getBinding`/`prepareGraph` API, and each workflow's logical input/output names and kinds. `bindings-v1` follows the golden runs and is owned by B only: node ids, field paths, mirrors, ranges/defaults, `workflows/*.api.json` and `DEFAULT_STEP_TIMEOUT_MS` values. After `contracts-v1`, logical names change additively only. Tool slices never use node ids (CI grep).

**Checkpoints.**
- **CP0 (~21:45):** skeleton merged and the owner check green → fan out.
- **CP1 (~00:30):** A and B merged; each tool runs plan → persist → run on mock.
- **CP2 (~03:30):** merge in order A → B → C → D → E → F → G with full checks; each slice's verifier gets ≤2 fix rounds.
- **CP3 (~05:30):** mock e2e Soul → Photoshoot → Cards → Motion green; golden runs + `bindings-v1` if the key works; then Wave 3.

### Wave 3: integration and QA (T+14 → T+20h, 8 agents)

| # | Agent | Deliverable |
|---|---|---|
| 35–37 | E2E per tool on real Cloud | Soul → Photoshoot (6 modes) → Cards (full-set 13) → Motion, plus S-R1 (Soul reuse across separate jobs after export/import). Fix-forward PRs. |
| 38 | Reviewer: correctness | Adversarial diff review: retry and double-billing, timeouts, binding drift |
| 39 | Reviewer: security and privacy | Key never client-side; upload validation (type, size, origin); face data deleted after the job; no PII in logs |
| 40 | Eval harness | Run the skills repo's eval scenarios (`evals/scenarios.md:99-200`) against our mode router. Report the pass rate. Add the identity eval (`docs/eval/identity.md`, `scripts/eval-identity.mjs`) and run it. |
| 41 | Perf/cost tuning | Turbo vs full step counts, batch sizes. Target: Instant Soul preview <60 s, 4-image photoshoot <90 s, card set <4 min, H3 clip <3 min. Record latency; record cost from the workspace usage endpoint after an isolated run (hourly bucket, after it settles). Produce the calibration table for cost estimates. |
| 42 | Golden demo assets | Pre-generate the hero set (demo Soul (.soul.zip), product, 13 cards, 2 H3 clips) as the backup for the live demo |

**Human checkpoint.** Feature freeze at T+20h. Requires an identity-gate pass (`docs/eval/identity.md`).

### Wave 4: demo and submission (T+20 → T+26h, 5 agents)

| # | Agent | Deliverable |
|---|---|---|
| 43 | Demo script | 3-minute live script: upload selfies → Instant Soul in ~1 min → photoshoot with you holding the product → 13-card Amazon set → H3 clip → "download your Soul" (.soul.zip), then re-import it and shoot again. |
| 44 | Demo video | ffmpeg-cut 2-minute recording from real runs (fallback if the live demo fails) |
| 45 | Comparison page | Higgsfield vs Open Soul Studio: features, price per output (Higgsfield API prices from research), ownership, open weights. Facts sourced. |
| 46 | Submission pack | Form text, licence check of all deps/models (FLUX.2 Klein 4B licence (Apache-2.0), H3 commercial note, BiRefNet, SeedVR2), repo topics `open-source-higgsfield` |
| 47 | Final verifier | Fresh clone → setup → run all 4 tools on Cloud and on the self-hosted proxy path (if a GPU is available) → `pnpm eval:identity --check` → sign-off checklist |
| 48 | Orchestrator/merger | Merges, CI, tags `v1.0.0` |

**Buffer.** T+26 → T+33h covers slippage, live-demo rehearsal, and submission before 16:00 UTC Oct 30.

## Workflow script shape

```
phases: Spikes → Specs → Build → Integrate → Ship
- Spikes: parallel(5) → write docs/spikes/*.md; orchestrator pauses for human go/no-go.
- Specs: parallel(6) → contracts merged → freeze tag `contracts-v1`.
- Build: skeleton (serial) → parallel(7 slices; sub-agents per slice in worktrees) → per-slice verifier (≤2 fix rounds) → ordered merge A→G
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
  - identity: gated by the identity eval (`docs/eval/identity.md`): blind 2-reviewer review, ≥80% of genuine items pass, every surface ≥2/3, decoys rejected; SFace cosine reported as advisory.
- **Open-weights proof:**
  - same pipelines via `COMFY_BASE_URL` → `comfy-api-proxy` on a rented GPU, if one becomes available;
  - grep confirms no partner/API nodes in `workflows/*.api.json`.
- **Demo readiness:** two full timed rehearsals. The backup video plays offline.

## Risks and fallbacks

| Risk | Fallback |
|---|---|
| Instant Soul identity too weak | More refs (A/B 3/4/6), 20-step H3 final; identity gate (docs/eval/identity.md). No trained Soul (Cloud has no SaveLoRA). |
| H3 latency or cost too high live | Turbo 4-step at 0.4 MP; a pre-rendered hero clip. |
| Subgraph export id drift | Unpack before export; binding tests catch drift. |
| Network or key not provided | Agents finish everything against the mock server; real runs move to the user's machine. |
| v1 billing endpoint deprecated or drifted | Spend panel optional; hides on error; jobs never depend on it. |
| Judges question "open weights on Cloud" | Self-hosted proxy path documented and, ideally, demonstrated. No partner nodes anywhere. |
