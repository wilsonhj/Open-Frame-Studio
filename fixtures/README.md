# Test fixtures

Inputs for unit, mock-backed end-to-end (`pnpm test:e2e`) and real Comfy Cloud runs.
Everything checked in here is synthetic. **This repository contains no real faces.**

## Fixture sets

| Set | Path | Status | Used by |
|---|---|---|---|
| Products (procedural) | `fixtures/products/*.png` | checked in, generated | Photoshoot, Cards, Motion e2e; `/smoke` e2e |
| Faces (Soul ID) | `fixtures/faces/` | **not in repo** | Soul ID e2e (skipped when absent), Cloud runs |
| Golden outputs | `fixtures/golden/<graph>/` | Wave 2 (Cloud runs) | graph regression, demo backup |

### Products: `fixtures/products/`

Three 512×512 RGB PNGs made by `scripts/make-fixtures.mjs` (pure Node, no dependencies, seeded,
byte-for-byte reproducible). Each is a plain synthetic product with no text or logos, on a
deliberately busy background, so cutout and "pure white main image" steps have real work to do:

| File | Product | Background |
|---|---|---|
| `product-bottle-confetti.png` | red bottle with a white label band, black cap | diagonal stripes + coloured confetti |
| `product-mug-tiles.png` | blue mug with a white band and a handle | teal/navy tiles with warm highlights |
| `product-box-checker.png` | yellow carton, shaded top and side | black/white checkerboard + leaf shapes |

```bash
node scripts/make-fixtures.mjs          # (re)write fixtures/products/*.png
node scripts/make-fixtures.mjs --check  # exit 1 if a file is missing or differs from the generator
```

They are too small (512 px) and too clean for quality judgements. Use them for plumbing, routing,
cutout and compliance logic. Real product photos for the demo go in `fixtures/golden/` with a
source and licence line.

### Faces: `fixtures/faces/` (not checked in)

Soul ID needs 5–20 photos of one person (8–12 ideal): one face per photo, varied angles and
lighting, at least 1024 px on the short side, no group shots and no sunglasses
(`higgsfield-soul-id/references/photo-guide.md`). This set is **never** procedurally generated
and never scraped. It comes from one of two places:

1. **AI-generated on Comfy Cloud** (planned once the paid key works): a fictional person rendered
   with FLUX.2 Klein from a fixed seed and prompt, 8–12 views. Commit the prompt, seeds and
   graph, plus the images if their licence allows it, under `fixtures/faces/synthetic-<name>/`
   with a `SOURCE.md`.
2. **A consenting person** who supplies their own photos for the demo. Keep them **out of git**:
   put them in a local directory and point the tests at it with `E2E_FACES_DIR=/path/to/photos`.
   Record consent (who, date, scope: "demo + tests, no redistribution") outside the repository.

Soul e2e flows that need faces call `test.skip` when fewer than 5 images are found.

Negative cases for photo QA (no face, too small, wrong type) need no faces: the product fixtures
serve as "no face found" inputs.

### Golden outputs: `fixtures/golden/` (Wave 2)

One real Cloud run per graph, saved with the API-format graph, seed and timings, so binding or
model changes can be compared. Size budget: keep each file under 2 MB (downscale if needed).

## Mock Comfy scenarios

E2E specs drive `tests/mock-comfy/server.ts` through `tests/mock-comfy/control.ts`
(`resetMock`, `setMockScenario`, `mockRequests`). The scenarios are:

| Scenario | Behaviour |
|---|---|
| `succeeded` | queued, running, succeeded with one PNG |
| `failed` | queued, running, failed (`execution_error`) |
| `unknown_forever` | always `unknown` (client deadline path) |
| `expired` | queued, expired |
| `reject_idempotency` | every submit refused (422 `idempotency_key_reuse`) |
| `multi_output` | succeeded with two PNGs (node `9`) and one `video/mp4` stub (node `12`) |
| `slow_progress` | queued, then 10 running polls with rising `progress.value`, then succeeded |
| `queued_20s` | queued (queue position counts down) for `queuedMs` (default 20 000), then one running poll, then succeeded |

The video output is a placeholder (an MP4 `ftyp` box only). It works for content-type and
download plumbing, but it does not play.
