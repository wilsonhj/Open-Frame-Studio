# Spec: Open Soul Studio HTTP API

Status: Wave 1 contract, frozen with `lib/types.ts` and `lib/bindings/*.ts` (`docs/PLAN.md:143`).
The TypeScript types in `lib/types.ts` are the source of truth; this page names them and adds the HTTP behaviour.
Every route is a Next.js route handler with `runtime = "nodejs"`. The Comfy API key stays on the server: the browser never sees `COMFY_API_KEY`, a Comfy URL, or a signed URL (`lib/comfy.ts:1-20`).

## Conventions

- **Errors** always have the body `{ "error": string, "field"?: string, "code"?: string, "details"?: object }`.
- **Status codes**:

  | Code | Meaning | Source |
  |---|---|---|
  | 400 | Bad input: wrong content type, unknown workflow/mode/asset, or an `InputError` / `BindingError` naming `field` | `app/api/jobs/route.ts:25,30,37` |
  | 402 | Comfy rejected the submit for credits or plan | `app/api/jobs/route.ts:60` |
  | 404 | Unknown run, output or file | `app/api/jobs/[id]/outputs/[outputId]/route.ts:24-26` |
  | 422 | Comfy rejected the submit (invalid graph, `idempotency_key_reuse`, ...) | `app/api/jobs/route.ts:56-61` |
  | 502 | Upstream or transport failure | `app/api/jobs/route.ts:63-66` |
  | 503 | `COMFY_API_KEY` is not configured | `app/api/jobs/route.ts:54-55` |
- **No auto-resubmit.** Each Comfy submit happens exactly once (`lib/comfy.ts:136-154`, `docs/PLAN.md:134`). A retry or regenerate is always an explicit user action that creates a new job with a new seed.
- **Every wait has a timeout.** Each pipeline step carries a required `timeoutMs` (`PipelineStep`, `lib/types.ts:179-212`). When it runs out, the step becomes `timed_out` and its Comfy job is left alone (`docs/PLAN.md:133`).
- **Images in JSON** use `ImageRef` (`lib/types.ts:150`):
  - `{ "upload": "<part name>" }` refers to a file part in the same multipart request. Each file must be PNG, JPEG or WebP and ≤ 20 MB (`lib/inputs.ts:7-8`).
  - `{ "assetId": "<id>" }` refers to an existing Comfy asset, for example `OutputRef.id` from an earlier job. This is how steps and runs chain.
- **Outputs** are `OutputRef` objects (`lib/types.ts:38-50`). Their `url` is app-relative: `/api/jobs/{jobId}/outputs/{outputId}`. Files rendered by code steps, such as composed cards, are served under `/api/pipelines/{kind}/{runId}/files/{name}`.
- **Polling.** Clients poll a `GET` route, starting at about 1 s and backing off to 5 s. There is no SSE (`docs/PLAN.md:136`).

---

## 1. Jobs (implemented)

These routes run one registered graph. Wave 2 pipelines use the same job and output routes for their Comfy steps.

### `POST /api/jobs`

Source: `app/api/jobs/route.ts:14-68`.

- **Request:** `multipart/form-data` with:
  - `workflow`: a key of the `/api/jobs` registry (`lib/bindings/index.ts`; today only `image_resize_smoke`);
  - one field per bound input, validated by `resolveInputs` (`lib/inputs.ts:27-35`). Images are file parts. Numbers, booleans and choices are text.
- **Response:** `202` with a `Job` (`lib/types.ts:52-65`):

  ```json
  { "id": "…", "status": "queued", "terminal": false, "progress": null,
    "queuePosition": 3, "outputs": [], "error": null }
  ```
- **Errors:**
  - `400 {error}` when the body is not multipart, or the workflow is unknown;
  - `400 {error, field}` when an input is invalid;
  - `503`;
  - `402` or `422 {error, code, details}`;
  - `502`.

### `GET /api/jobs/:id`

Source: `app/api/jobs/[id]/route.ts:7-20`.

- Polls once and returns `200 Job` with `Cache-Control: no-store`.
- `terminal: true` tells the client to stop polling.
- Errors: `503`, `502`.

### `GET /api/jobs/:id/outputs/:outputId`

Source: `app/api/jobs/[id]/outputs/[outputId]/route.ts:10-32`.

- Streams the output bytes with the asset's `Content-Type` and `Cache-Control: private, max-age=300`.
- The short-lived signed URL is fetched on the server; the browser never sees it.
- Errors: `404` (no such output on this job), `503`, `502`.

---

## 2. Pipelines (planned, Wave 2)

A pipeline is a small DAG of `PipelineStep`s (`lib/types.ts:167-212`):

- **`comfy` steps** run one graph from `workflows/<WorkflowName>.api.json`. Their inputs go through `applyBindings` (`lib/bindings/apply.ts`), with the binding in `lib/bindings/<workflow>.ts`.
- **`code` steps** run in process: photo QA, crop, prompt building, compose, compliance checks and card rendering.

### Routes shared by all four kinds

`{kind}` is one of `soul | photoshoot | cards | motion` (`PipelineKind`).

| Route | Purpose | Response |
|---|---|---|
| `POST /api/pipelines/{kind}` | Validate the request, create the run, start it | `202 PipelineRun<kind>` |
| `GET /api/pipelines/{kind}/{runId}` | Snapshot of the run (single poll) | `200 PipelineRun<kind>`, `no-store` |
| `POST /api/pipelines/{kind}/{runId}/cancel` | Stop scheduling new steps and cancel running Comfy jobs | `200 PipelineRun<kind>` (status `canceled`) |
| `GET /api/pipelines/{kind}/{runId}/files/{name}` | Bytes of a file a code step produced | file stream; `404` if missing |

**POST body.** Send `multipart/form-data` with:
- a `request` part holding JSON of the per-kind request type;
- one file part for each `{ "upload": name }` the JSON refers to.

A request that uses only `assetId` refs may instead be sent as `application/json` (the bare request object).

**Validation** happens before any submit. It returns `400 {error, field}`, where `field` is a JSON path such as `bullets[2]` or `images[0]`. An unknown mode or asset id returns `400`, and the error lists the valid ids.

**`PipelineRun<K>`** (`lib/types.ts:241-257`):

```ts
{
  id, kind, status: "pending"|"running"|"succeeded"|"partial"|"failed"|"canceled",
  createdAt, updatedAt,           // ISO-8601
  timeoutMs,                      // overall budget
  progress,                       // 0..1
  steps: PipelineStep[],          // per-step status, timeoutMs, jobId, outputs, error
  request: PipelineRequestMap[K],
  result: PipelineResultMap[K] | null,  // set when terminal
  error: JobErrorInfo | null
}
```

**Step status** is `PipelineStepStatus`, a superset of `JobStatus`: `pending | queued | running | succeeded | failed | canceled | expired | unknown | skipped | timed_out | needs_input`.

**Run status** is decided like this:
- `succeeded`: every step succeeded.
- `partial`: the run finished, but at least one step is `failed`, `timed_out` or `needs_input`, and at least one deliverable exists.
- `failed`: nothing deliverable exists, or a gating step failed. For example, a failed main-image compliance check fails the run before fan-out (`docs/spec/marketplace.md:176`).

**Resumability.** The run state is persisted on the server, keyed by `runId`. After a restart, a step that has a `jobId` is resumed by polling that job, never by resubmitting it. Default step budgets are in `DEFAULT_STEP_TIMEOUT_MS` (`lib/types.ts:215-222`).

### 2.1 `POST /api/pipelines/soul`

| | |
|---|---|
| Request | `SoulRequest` (`lib/types.ts:304-310`): `{ name, photos: ImageRef[3..12], preview?: boolean }` |
| Steps | photo QA (code) → `cutout` per kept photo → crop + pHash dedupe (code) → choose the best 3–6 → `klein_edit_multiref` preview sheet (optional) → write `soul.json` (code) |
| Result | `SoulResult` (`lib/types.ts:321-326`): `{ soul: Soul, rejected: [{index, reason}], preview: OutputRef \| null }` |

`Soul` (`lib/types.ts:293-302`) is the exact contents of `soul.json`:

```json
{ "schema": "open-soul-studio/soul@1", "id": "…", "name": "Maya", "createdAt": "…",
  "refs": [ { "assetId": "…", "crop": {"x":0,"y":0,"width":768,"height":1024},
              "phash": "c3a1f0e07c3e1f0f", "qaScore": 0.92 } ],
  "styleCard": { "description": "…", "traits": {"hair": "short curly dark-auburn"},
                 "keep": ["small mole above the left lip"] } }
```

- **Refs and paths.** In an exported bundle, each ref uses `path` (relative to `soul.json`) instead of `assetId`.
- **No LoRA.** Soul ID is Instant only (`docs/PLAN.md:7`).
- **Registry routes (planned):**
  - `GET /api/souls` → `Soul[]`;
  - `GET /api/souls/{id}` → `Soul`;
  - `GET /api/souls/{id}/export` → a zip of `soul.json` plus `refs/NN.png`;
  - `POST /api/souls/import` (multipart zip) → `201 Soul`.

### 2.2 `POST /api/pipelines/photoshoot`

| | |
|---|---|
| Request | `PhotoshootRequest` (`lib/types.ts:332-350`): `{ mode, prompt, images: ImageRef[], count, aspectRatio?, soulId?, styleRef?, quality?: "fast"\|"final", transparent?, seed? }` |
| Steps | `cutout` of the product (cached by content hash) → prompt builder (code) → N × `klein_edit_multiref` (or `klein_t2i` for text-only `product_shot`) → optional N × `upscale` (`final`) → optional `cutout` (`transparent`) |
| Result | `PhotoshootResult` (`lib/types.ts:363-370`): `{ mode, aspectRatio, count, notices[], items: [{ index, seed, status, variation: {preset, lighting, angle, palette}, output, error }] }` |

- **Field names.** The request fields follow Higgsfield's `{mode, prompt, images[], count, aspect_ratio}` (`docs/spec/photoshoot.md:314`), written in camelCase (`aspectRatio`).
- **Prompt.** `prompt` is the user's short intent, never the assembled prompt.
- **Clamping and snapping.** Out-of-range `count` and off-whitelist aspect ratios are clamped or snapped, and each change adds a line to `notices` (not an error).
- **Retry (planned).** `POST /api/pipelines/photoshoot/{runId}/items/{index}/retry` submits one new job with a new seed. It returns `202 PipelineRun`.

### 2.3 `POST /api/pipelines/cards`

| | |
|---|---|
| Request | `CardsRequest` (`lib/types.ts:374-403`): `scope?` or `assets?: CardAssetId[]` (assets win; default `main`), `mainJobId?`, `productImages: ImageRef[1..6]`, plus the copy fields from `docs/spec/marketplace.md:197-220` (`productName`, `bullets`, `painPoints`, `efficacyClaims` + `efficacySource`, `howToUse`, `endorsement`, …) |
| Steps | main: `cutout` → trim (code) → `upscale` if needed → compose + compliance checks (code). Then the fan-out, in parallel, per asset: `klein_edit_multiref` (anchor cutout → `image_1`, node 54) or `klein_t2i` → render the card (code). |
| Result | `CardsResult` (`lib/types.ts:428-434`): `{ assets, main: MainImageResult \| null, tiles: [{ asset, state, seed, url, missing[], error }], styleBlock }` |

- **Tile states.** `CardTile.state` is `queued | running | done | needs_input | failed`.
- **Missing copy.** A tile whose user copy is missing is `needs_input`, and `missing` lists the request fields it needs. The run then ends `partial` (`docs/spec/marketplace.md:246`, T-T3).
- **Regenerate (planned).** `POST /api/pipelines/cards/{runId}/tiles/{assetId}/regenerate` re-runs only that tile. It keeps the anchor and `styleBlock` and changes only the seed (R-A3). It returns `202 PipelineRun`.
- **Export (planned).** `GET /api/pipelines/cards/{runId}/export` returns a zip of the `done` tiles plus `cards.json`.

### 2.4 `POST /api/pipelines/motion`

| | |
|---|---|
| Request | `MotionRequest` (`lib/types.ts:439-455`): `{ soulId? \| personImage?, productImage, prompt, duration?, aspectRatio?, quality?: "preview"\|"final", refFidelity?: "match"\|"max", seed? }` |
| Steps | resolve `<Picture 1>` (the Soul's best ref, or the uploaded person) → prompt builder (code; adds `<Picture N>` role tags) → `h3_r2v` |
| Result | `MotionResult` (`lib/types.ts:457-461`): `{ video: OutputRef \| null, seed, frames }` |

- **Person reference.** Exactly one of `soulId` or `personImage` is required.
- **Quality.** `quality: "final"` (the default) sets `turbo=false` with 20 base steps. `preview` uses the 4-step turbo LoRA (`docs/spikes/h3-r2v.md:104`).
- **Aspect ratio.** `aspectRatio` maps to a `ResolutionSelector` option through `H3_ASPECT_OPTIONS` (`lib/bindings/h3_r2v.ts`).

---

## 3. Graph bindings (contract for Comfy steps)

Each `lib/bindings/<workflow>.ts` exports a `GraphBinding` (`lib/types.ts:129-134`) of the form `{ workflow, inputs: {name: {node, field, kind, mirrors?}}, outputs: {name: nodeId} }`. `kind` is one of `image | text | int | float | bool`.

| Workflow | Inputs | Outputs | Graph source |
|---|---|---|---|
| `klein_edit_multiref` | `image_1..image_4` (54, 60, 61, 62), `prompt` 4.text, `width`/`height` 44 (mirrored to 71), `batch_size`, `seed` 70.noise_seed, `steps` 71, `cfg` 72, `ref_megapixels` 17.resolution.megapixels, `model` 59.unet_name | `image` 9 | `spikes/klein-multiref/flux2_klein_edit_multiref.api.json` |
| `klein_t2i` | `prompt` p4.text, `width`/`height` p44 (mirrored to p71), `batch_size`, `seed` p70, `steps` p71, `cfg` p72, `model` 59 | `image` p9 | `p*` chain of `spikes/klein-multiref/flux2_klein_t2i_fixtures.api.json` |
| `cutout` | `image` 17 | `cutout` 18, `mask` 21 | `spikes/cutout-upscale/cutout.api.json` |
| `upscale` | `image` 1, `scale` 57.resize_type.multiplier, `model` 52.unet_name (3B int8 default), `seed` 54, `color_correction` 59 (`wavelet`) | `image` 9 | `spikes/cutout-upscale/upscale.api.json` |
| `h3_r2v` | `image_1` 137, `image_2` 139, `prompt` 138.value, `seed` 129, `duration` 132, `turbo` 146, `steps_base` 143, `steps_turbo` 144, `aspect_ratio`/`megapixels` 115, `ref_image_size` 136 | `video` 92 | `spikes/h3-r2v/h3_r2v.api.json` |

- **`applyBindings(graph, binding, values)`** returns a structured clone of the graph. It rejects:
  - unknown logical names;
  - values of the wrong kind;
  - targets that are missing from the graph, or that are links (binding drift).
- **`resolveAssignments`** gives the same validated `{node, field, value}` list for the SDK's `workflow.setInput`, which is used for asset handles.
- **Tests.** `tests/bindings.test.ts` proves that every logical input changes exactly its bound node fields.
