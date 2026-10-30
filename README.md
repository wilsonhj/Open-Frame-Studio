# Open Frame Studio

Open Frame Studio is an open-weights creative studio built on the ComfyUI inference engine, made for Comfy's Open Source Higgsfield challenge. It takes the best ideas from hosted AI photo studios and rebuilds them as open, inspectable ComfyUI graphs, with its own names, flows and design. It runs through the Comfy API, either on Comfy Cloud or on your own GPU.

You upload 5–20 photos of a person once and get an **identity**: a checked reference set of the best 3–6 crops, saved as a portable file you keep. You can then put that identity and your product into a **product shoot** (pick a shot style and an output format), build **listing images** (a compliant white-background hero image plus gallery and story panels anchored on it), and turn the result into a short **motion** clip. Every model in the pipeline is open weights (FLUX.2 Klein 4B, MiniMax H3, BiRefNet, SeedVR2), and every workflow is a plain ComfyUI graph you can open and change.

> Status: Wave 0 scaffold. The app shell, the Comfy client wrapper, the generic job API and an offline mock are in place. The tool pages are placeholders.

## Quickstart

Requirements: Node 22.18+ and pnpm 10.

```bash
pnpm install
cp .env.example .env.local      # then set COMFY_API_KEY
pnpm dev                         # http://127.0.0.1:3000
```

- `COMFY_API_KEY` is your key from [platform.comfy.org](https://platform.comfy.org/profile/api-keys). It is read only on the server and is never exposed to the browser.
- `SESSION_SECRET` signs the per-browser job handles. Set a long random value in production; in development a per-process secret is generated.
- `STUDIO_ACCESS_CODE` gates job submission, because every job is billed to your key. In production the app refuses to submit jobs unless this is set or you explicitly opt in with `ALLOW_PUBLIC_SUBMIT=true`. `SUBMITS_PER_HOUR_PER_IP` (default 20) and `SUBMITS_PER_HOUR` (default 200) add in-memory rate limits per server instance.
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

## What we built, and what inspired it

We studied what makes hosted AI studios pleasant to use (one reusable identity, guided choices instead of blank prompts, sets that stay visually consistent) and built our own version of each idea on ComfyUI. The names, taxonomy, flows and visuals are ours. See [docs/UX-PATTERNS.md](./docs/UX-PATTERNS.md) for the pattern teardown.

| Surface | What it does | Built on (open weights, ComfyUI) |
|---|---|---|
| **Identity** (`/identity`) | Photo checks on upload, then the best 3–6 crops become a reusable reference set with a style card, saved as a portable file. Reference-based, so it is ready in about a minute with no training step | FLUX.2 Klein 4B edit with multi-reference latents; BiRefNet crops |
| **Product Shoot** (`/photoshoot`) | Our own model: a shot style (`packshot`, `in_context`, `with_person`, `flat_lay`, `concept`, `restage`) times an output format (`single`, `series`, `banner`, `ad_set`), with a variation engine over setting, lighting, angle and palette | FLUX.2 Klein 4B edit with product and identity references; optional SeedVR2 upscale |
| **Listing Images** (`/listing`) | A deterministic cutout hero composited on #FFFFFF at ~85% fill and compliance-checked, then gallery and story panels conditioned on it. All text is rendered in code | BiRefNet; FLUX.2 Klein 4B edit |
| **Motion** (`/motion`) | An identity still and a product still become one reference-to-video clip | MiniMax H3 reference-to-video template |

## Architecture

```
app/api/jobs/route.ts                       POST multipart → access code + rate limit → workflows/<name>.api.json → bind inputs → submit once → 202 {id: signed handle}
app/api/jobs/[id]/route.ts                  GET  normalized job {status, terminal, progress, outputs, error}; cancels jobs past their deadline
app/api/jobs/[id]/outputs/[outputId]        GET  re-hosts the output bytes with safe headers (signed URLs expire; key stays server-side)
lib/access.ts                               access code, rate limits, per-browser signed job handles
lib/brand.ts                                product name and surface labels
lib/comfy.ts                                server-only @comfyorg/sdk 0.5.0 wrapper (traps below)
lib/bindings/index.ts                       registry: workflow name → {input → node id + field}
lib/inputs.ts                               multipart validation + binding application
lib/types.ts                                contracts: Job, OutputRef, PipelineStep, ShotStyle × OutputFormat, ListingSlot
workflows/*.api.json                        API-format graphs (subgraphs unpacked)
tests/mock-comfy/server.ts                  mock Comfy API v2 (succeeded / failed / unknown-forever / expired / 422 reuse)
```

`lib/comfy.ts` handles the known SDK and API traps:

- Every poll needs a timeout. A job stuck in `unknown`, or running past its 15-minute budget, is canceled on Comfy and becomes terminal with a `poll_timeout` error.
- `submit()` is never retried. A 422 `idempotency_key_reuse` is surfaced, not resubmitted, because a fresh key would bill a second job.
- No `metadata` is sent.
- Status comes from polling, not SSE.
- Outputs are re-hosted through our own route, only from the workflow's declared output nodes. Media types are served inline; anything else (HTML, SVG, scripts) is a sandboxed download.
- The browser can only address a job through a handle signed for its own session cookie, so one visitor can't read another visitor's jobs (or any other job on the account) even if they learn its id.
- UI-format workflows are rejected locally.

## Licence and NOTICE

MIT. See [LICENSE](./LICENSE).

**NOTICE: third-party code patterns.** The app architecture is adapted from [Comfy-Org/comfy-reshoot](https://github.com/Comfy-Org/comfy-reshoot), Copyright (c) 2026 Comfy Org, MIT License. We adapted the client wrapper in `lib/comfy.ts`, the `app/api/jobs` route structure, the output re-hosting route, and the polling pattern in `components/job-runner.tsx`. The MIT permission notice applies to those portions:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

This is an independent, clean-room project. It contains no code from `higgsfield-ai/app-templates`, does not bypass any Higgsfield authentication or billing, and does not use Higgsfield's product names, identifiers or assets in its UI. "Higgsfield" appears only to name the challenge and the products that inspired it. The repository slug `open-soul-studio` predates the rename.
