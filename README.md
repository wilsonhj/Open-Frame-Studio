# Open Soul Studio

Open Soul Studio is an open-weights rebuild of three Higgsfield tools: Soul ID, Product Photoshoot and Marketplace Cards. It runs on ComfyUI through the Comfy API, either on Comfy Cloud or on your own GPU. You upload photos of a person once and get a "Soul": a reusable identity, and in trained mode a LoRA `.safetensors` file you download and own. You then use it to shoot your products in ten photoshoot modes, build a marketplace image set (a compliant white-background main image plus secondary and A+ images anchored on it), and animate the result. Every model in the pipeline is open weights and every workflow is a plain ComfyUI graph you can inspect.

> Status: Wave 0 scaffold. The app shell, the Comfy client wrapper, the generic job API and an offline mock are in place. The tool pages are placeholders.

## Quickstart

Requirements: Node 22.18+ and pnpm 10.

```bash
pnpm install
cp .env.example .env.local      # then set COMFY_API_KEY
pnpm dev                         # http://127.0.0.1:3000
```

- `COMFY_API_KEY` is your key from [platform.comfy.org](https://platform.comfy.org/profile/api-keys). It is read only on the server and is never exposed to the browser.
- `COMFY_BASE_URL` is optional. Leave it unset to use Comfy Cloud. Set it (for example `http://127.0.0.1:8189`) to use a self-hosted ComfyUI behind `comfy-api-proxy`; the code is the same.

To work offline, run against the bundled mock Comfy API v2 server:

```bash
PORT=8189 pnpm mock-comfy                         # terminal 1
COMFY_BASE_URL=http://127.0.0.1:8189 pnpm dev     # terminal 2, then open /smoke
```

| Script | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js dev server, production build, production server |
| `pnpm lint` | ESLint (`eslint-config-next`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | `node --test` unit tests against `tests/mock-comfy` (no network, no credits) |
| `pnpm mock-comfy` | Standalone mock Comfy API v2 server |

## How it maps to Higgsfield

| Higgsfield | Open Soul Studio | Built on (open weights, ComfyUI) |
|---|---|---|
| **Soul ID**: 5–20 photos → `custom_reference_id` | `/soul`. **Instant** mode picks the best reference crops; **Trained** mode trains a LoRA in one Comfy job and returns a downloadable `.safetensors` | FLUX.3 Klein edit with multi-reference latents; `TrainLoraNode` + `SaveLoRA`; BiRefNet crops |
| **Product Photoshoot**: 10 modes, 1–10 varied outputs | `/photoshoot`. The same 10 mode ids, with our own prompt templates and variation engine (preset, lighting, angle, palette), optionally with your Soul in frame | FLUX.3 Klein edit with product and Soul references; optional SeedVR2 upscale |
| **Marketplace Cards**: main, product-images, A+, full set (13 assets) | `/cards`. The main image is a deterministic cutout composited on #FFFFFF at ~85% fill and compliance-checked. Secondary and A+ images are conditioned on it, and their text is rendered in code | BiRefNet; FLUX.3 Klein edit |
| **Motion** | `/motion`. A Soul still and a product still become one reference-to-video clip | MiniMax H3 reference-to-video template |

## Architecture

```
app/api/jobs/route.ts                       POST multipart → workflows/<name>.api.json → bind inputs → submit once → 202
app/api/jobs/[id]/route.ts                  GET  normalized job {status, terminal, progress, outputs, error}
app/api/jobs/[id]/outputs/[outputId]        GET  re-hosts the output bytes (signed URLs expire; key stays server-side)
lib/comfy.ts                                server-only @comfyorg/sdk 0.5.0 wrapper (traps below)
lib/bindings/index.ts                       registry: workflow name → {input → node id + field}
lib/inputs.ts                               multipart validation + binding application
lib/types.ts                                contracts: Job, OutputRef, PipelineStep, ModeTemplate, CardAsset, PhotoshootMode
workflows/*.api.json                        API-format graphs (subgraphs unpacked)
tests/mock-comfy/server.ts                  mock Comfy API v2 (succeeded / failed / unknown-forever / expired / 422 reuse)
```

`lib/comfy.ts` handles the known SDK and API traps:

- Every poll needs a timeout. A job stuck in `unknown` becomes terminal with a `poll_timeout` error.
- `submit()` is never retried. A 422 `idempotency_key_reuse` is surfaced, not resubmitted, because a fresh key would bill a second job.
- No `metadata` is sent.
- Status comes from polling, not SSE.
- Outputs are re-hosted through our own route.
- UI-format workflows are rejected locally.

## Licence and NOTICE

MIT. See [LICENSE](./LICENSE).

**NOTICE: third-party code patterns.** The app architecture is adapted from [Comfy-Org/comfy-reshoot](https://github.com/Comfy-Org/comfy-reshoot), Copyright (c) 2026 Comfy Org, MIT License. We adapted the client wrapper in `lib/comfy.ts`, the `app/api/jobs` route structure, the output re-hosting route, and the polling pattern in `components/job-runner.tsx`. The MIT permission notice applies to those portions:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

This is a clean-room behavioural reimplementation. It contains no code from `higgsfield-ai/app-templates`, and it does not bypass any Higgsfield authentication or billing. "Higgsfield" and "Soul ID" are referenced only to describe compatible behaviour.
