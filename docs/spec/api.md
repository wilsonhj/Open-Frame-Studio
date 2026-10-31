# Spec: Open Frame Studio HTTP API

Status: Wave 1 contract, frozen with `lib/contracts/*.ts` (barrel: `lib/types.ts`) and `lib/bindings/*.ts` (`docs/PLAN.md:144`).
The TypeScript types in `lib/contracts/*.ts` (re-exported by `lib/types.ts`) are the source of truth; this page names them and adds the HTTP behaviour.
Every route is a Next.js route handler with `runtime = "nodejs"`. The Comfy API key stays on the server: the browser never sees `COMFY_API_KEY`, a Comfy URL, or a signed URL (`lib/comfy.ts:1-20`).

## Conventions

- **Errors** always have the body `{ "error": string, "field"?: string, "code"?: string, "details"?: object }`.
- **Status codes**:

  | Code | Meaning | Source |
  |---|---|---|
  | 400 | Bad input: wrong content type, unknown workflow/mode/asset, or an `InputError` / `BindingError` naming `field` | `app/api/jobs/route.ts:30,35,55` |
  | 402 | Comfy rejected the submit for credits or plan | `app/api/jobs/route.ts:70` |
  | 404 | Unknown run, output or file | `app/api/jobs/[id]/outputs/[outputId]/route.ts:24-26` |
  | 422 | Comfy rejected the submit (invalid graph, `idempotency_key_reuse`, ...) | `app/api/jobs/route.ts` |
  | 502 | Upstream or transport failure; for a submit, the outcome is unknown (`SubmitAmbiguousError`: a job may exist) | `app/api/jobs/route.ts` |
  | 503 | `COMFY_API_KEY` is not configured | `app/api/jobs/route.ts:57-58` |
- **No auto-resubmit.** A submit is never retried under a new idempotency key (`lib/comfy.ts`, `docs/PLAN.md` Known traps). After an ambiguous failure, a pipeline may re-send once more under the *same* key (§2.0). A retry or regenerate is always an explicit user action that mints a new key and creates a new job with a new seed.
- **Every wait has a timeout.** Each pipeline step carries a required `timeoutMs` (`PipelineStep`, `lib/contracts/pipeline.ts:39-110`). When it runs out, the step becomes `timed_out` and its Comfy job is left alone (`docs/PLAN.md:134`).
- **Images in JSON** use `ImageRef` (`lib/contracts/job.ts:72`):
  - `{ "upload": "<part name>" }` refers to a file part in the same multipart request. Each file must be PNG, JPEG or WebP and ≤ 20 MB (`lib/inputs.ts:10-11`).
  - `{ "assetId": "<id>" }` refers to an existing Comfy asset, for example `OutputRef.id` from an earlier job. This is how steps and runs chain.
- **Outputs** are `OutputRef` objects (`lib/contracts/job.ts:35-47`). Their `url` is app-relative: `/api/jobs/{jobId}/outputs/{outputId}`. Files rendered by code steps, such as composed cards, are served under `/api/pipelines/{kind}/{runId}/files/{name}`.
- **Polling.** Clients poll a `GET` route, starting at about 1 s and backing off to 5 s. There is no SSE (`docs/PLAN.md:137`).

---

## 1. Jobs (implemented)

These routes run one registered graph. Wave 2 pipelines use the same job and output routes for their Comfy steps.

`POST /api/jobs` is a single-shot smoke and debug route: it keeps no run state, so an ambiguous submit returns 502 `submit_ambiguous` and cannot be safely re-sent. Product flows go through `/api/pipelines`, which persists the key before submitting (§2.0).

### `POST /api/jobs`

Source: `app/api/jobs/route.ts:19-78`.

- **Request:** `multipart/form-data` with:
  - `workflow`: a `WorkflowName` key of the `BINDINGS` registry (`lib/bindings/index.ts`; the same `GraphBinding`s as §3);
  - one field per bound input. `parseInputs` (`lib/inputs.ts:34`) validates each one by its `kind` (plus `required` / `min` / `max` / `choices`) into `BindingValues`, turning image file parts into SDK asset handles; `applyBindings` (§3) then sets them on the graph. Numbers, booleans and text are text fields. An absent optional field keeps the graph's own value.
- **Response:** `202` with a `Job` (`lib/contracts/job.ts:49-62`):

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

A pipeline is a flat list of `PipelineStep`s (`lib/contracts/pipeline.ts:27-110`). Each step names the steps it waits on in `dependsOn`, fixed when the run is created. The runner starts every ready step (pending, with all `dependsOn` succeeded) in parallel; a step whose dependency failed becomes `skipped`. There is no general graph engine. Step kinds:

- **`comfy` steps** run one graph from `workflows/<WorkflowName>.api.json`. Their inputs go through `applyBindings` (`lib/bindings/apply.ts`), with the binding in `lib/bindings/<workflow>.ts`.
- **`code` steps** run in process: photo QA, crop, prompt building, compose, compliance checks and card rendering.

### Routes shared by all four kinds

`{kind}` is one of `identity | photoshoot | cards | motion` (`PipelineKind`).

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

**`PipelineRun<K>`** (`lib/contracts/pipeline.ts:139-165`):

```ts
{
  id, kind, status: "pending"|"running"|"succeeded"|"partial"|"failed"|"canceled",
  createdAt, updatedAt,           // ISO-8601
  timeoutMs,                      // overall budget
  progress,                       // 0..1
  steps: PipelineStep[],          // per-step status, timeoutMs, deadlineAt, submission, jobId, outputs, error
  request: PipelineRequestMap[K],
  result: PipelineResultMap[K] | null,  // set when terminal
  error: JobErrorInfo | null,
  schema: "open-frame-studio/run@1",
  cancelRequested?: boolean
}
```

**Step status** is `PipelineStepStatus`, a superset of `JobStatus`: `pending | queued | running | succeeded | failed | canceled | expired | unknown | skipped | timed_out | needs_input`.

**Run status** is decided like this:
- `succeeded`: no step failed, and no Comfy step was skipped. A code step may be `skipped` on purpose.
- `partial`: the run finished with a deliverable, and a step is `failed`, `timed_out`, or `needs_input`, or a Comfy step was `skipped`. A deliverable is a `succeeded` step that no other step depends on, or whose dependents are all `needs_input`. So a Listing run whose hero succeeded and whose other tiles all wait for copy ends `partial`, not `failed`.
- `failed`: nothing deliverable exists, or a gating step failed. For example, a failed main-image compliance check fails the run before fan-out (`docs/spec/listing.md:176`).

### 2.0 Durable run state and restart

**Store.** One JSON document per run at `${DATA_DIR:-.data}/runs/<runId>.json`, with `schema: "open-frame-studio/run@1"` (`RUN_SCHEMA`, `lib/contracts/pipeline.ts`). Files written by code steps live under `.data/runs/<runId>/files/`; the identity registry lives in `.data/identities/<id>/`. `.data/` is gitignored.
- A single process owns the store. All writes go through `lib/store.ts` (Wave 2), with a per-run write queue and temp-write + `fsync` + `rename`, so a crash leaves either the old or the new document, never a torn one.
- Every state transition is one awaited write. Nothing that matters for restart lives only in memory.
- `GET /api/pipelines/{kind}/{runId}` reads the store; it returns `404` if the document is absent.

**Planning is fixed before persist.** `POST` does all of this before it returns `202`:
1. upload every `{ "upload": … }` part and rewrite it to `{ "assetId": … }` (the persisted `request` holds no file parts);
2. resolve seeds and enhancer prompts into concrete step inputs;
3. build the full step list (every step, with `dependsOn` and `timeoutMs`);
4. persist the run, then answer `202`.

A restarted runner therefore never re-plans: it only executes the persisted steps.

**Submit protocol for a `comfy` step** (normative order):
1. Mint `submission = { idempotencyKey: randomUUID(), state: "sending", mintedAt, attempts: 1 }`, set `startedAt` and `deadlineAt = startedAt + timeoutMs`, and **persist**.
2. `submitOnce(client, workflow, { idempotencyKey })` with that key.
3. On `201`: set `jobId` and `submission.state = "accepted"`, and **persist before polling**.
4. Definitive reject (validation, insufficient credits, `queue_full` after the SDK's own retry budget, any 4xx except a 422 `idempotency_key_reuse`): `submission.state = "rejected"`, the step becomes `failed`. No resubmit.
5. Ambiguous (transport error, abort or timeout after the request was sent, any 5xx; `SubmitAmbiguousError`): keep `state: "sending"` and reconcile the step now (table below).

**Reconcile** (on boot, on lazy load, and after an ambiguous submit):

| Step state | Action |
|---|---|
| Terminal | Keep as is |
| `jobId` set | `pollJob` with the remaining deadline (`deadlineAt − now`). If the deadline has passed: one `getJob`; take the result if terminal, else `timed_out`. Never resubmit |
| `submission.state = "sending"`, no `jobId` | If `now − mintedAt > 23 h`: `unconfirmed`. Otherwise re-send once under the **same** key (`attempts ≤ 3`, persisted before sending): `201` → record as in step 3; 422 `idempotency_key_reuse` → `state: "unconfirmed"`, step `failed` with error `submit_unconfirmed` ("A job may have been created and billed; its id was lost. Not resubmitted. Use Regenerate."); definitive reject → as in step 4; ambiguous again → back off and retry while `attempts < 3`, then `unconfirmed` |
| No submission | `pending`: schedule normally |
| `code` step `running` | Re-run it (code steps are idempotent) |

**Why a same-key re-send is not an auto-retry.** The API v2 idempotency key makes the re-send safe: if the first POST landed, the server answers 422 `idempotency_key_reuse` instead of creating a second job, so at most one job is ever billed. A fresh key is minted only by an explicit user Regenerate. The key window is assumed to be about 24 h, hence the 23 h cut-off.

**Lost job ids.** Comfy Cloud cannot list jobs (`GET /api/v2/jobs` returns 501), so a job whose id was lost cannot be recovered. That is why `submit_unconfirmed` exists and is never resubmitted.

**Boot.** `instrumentation.ts` `register()` (nodejs runtime only) calls `resumeRuns()`, which reconciles every non-terminal run in the store. A `GET` of a run that is not loaded yet triggers `resumeRun(id)`. The runner is a `globalThis` singleton, so dev hot reloads and route modules share one instance. `cancelRequested: true` is persisted by the cancel route; on reconcile, such a run schedules nothing new, cancels jobs it holds ids for, and ends `canceled`.

**Run status.** `submit_unconfirmed` counts as `failed` when deciding `partial` / `failed`.

**Storage choice.** A JSON document per run, not `better-sqlite3`, to avoid a native build under pnpm 10. `node:sqlite` is the upgrade path if runs outgrow files.

Default step budgets are in `DEFAULT_STEP_TIMEOUT_MS` (`lib/contracts/pipeline.ts`). `deadlineAt` survives a restart, so a restart never extends a step's budget.

### 2.1 `POST /api/pipelines/identity`

| | |
|---|---|
| Request | `IdentityRequest` (`lib/contracts/identity.ts:57-63`): `{ name, photos: ImageRef[3..12], preview?: boolean }` |
| Steps | photo QA + crop + pHash dedupe (code, CPU) → choose the best 3–6 → `klein_edit_multiref` preview sheet (optional; the only Comfy step) → write `identity.json` (code) |
| Result | `IdentityResult` (`lib/contracts/identity.ts:74-79`): `{ identity: Identity, rejected: [{index, reason}], preview: OutputRef \| null }` |

`identity` (`lib/contracts/identity.ts:46-55`) is the exact contents of `identity.json`:

```json
{ "schema": "open-frame-studio/identity@1", "id": "…", "name": "Maya", "createdAt": "…",
  "refs": [ { "assetId": "…", "crop": {"x":0,"y":0,"width":768,"height":1024},
              "phash": "c3a1f0e07c3e1f0f", "qaScore": 0.92 } ],
  "styleCard": { "description": "…", "traits": {"hair": "short curly dark-auburn"},
                 "keep": ["small mole above the left lip"] } }
```

- **Refs and paths.** In an exported bundle, each ref uses `path` (relative to `identity.json`) instead of `assetId`.
- **No LoRA.** Identity is Instant only (`docs/PLAN.md:7`).
- **Registry routes (planned):**
  - `GET /api/identities` → `identity[]`;
  - `GET /api/identities/{id}` → `identity`;
  - `GET /api/identities/{id}/export` → a zip of `identity.json` plus `refs/ref_N.png` (no `assetId`s or Comfy URLs);
  - `POST /api/identities/import` (multipart zip) → `201 identity`. Import validates `refs[].sha256`, uploads every ref and assigns fresh `assetId`s (`docs/spec/identity.md` §6.5, §6.6).

### 2.2 `POST /api/pipelines/photoshoot`

| | |
|---|---|
| Request | `PhotoshootRequest` (`lib/contracts/photoshoot.ts:12-30`): `{ mode, prompt, images: ImageRef[], count, aspectRatio?, identityId?, styleRef?, quality?: "fast"\|"final", transparent?, seed? }` |
| Steps | `cutout` of the product (cached by content hash) → prompt builder (code) → N × `klein_edit_multiref` (or `klein_t2i` for text-only `packshot`) → optional N × `upscale` (`final`) → optional `cutout` (`transparent`) |
| Result | `PhotoshootResult` (`lib/contracts/photoshoot.ts:43-50`): `{ mode, aspectRatio, count, notices[], items: [{ index, seed, status, variation: {preset, lighting, angle, palette}, output, error }] }` |

- **Field names.** The request fields follow Higgsfield's `{mode, prompt, images[], count, aspect_ratio}` (`docs/spec/photoshoot.md:314`), written in camelCase (`aspectRatio`).
- **Prompt.** `prompt` is the user's short intent, never the assembled prompt.
- **Clamping and snapping.** Out-of-range `count` and off-whitelist aspect ratios are clamped or snapped, and each change adds a line to `notices` (not an error).
- **Retry (planned).** `POST /api/pipelines/photoshoot/{runId}/items/{index}/retry` submits one new job with a new seed. It returns `202 PipelineRun`.

### 2.3 `POST /api/pipelines/listing`

| | |
|---|---|
| Request | `CardsRequest` (`lib/contracts/listing.ts:17-46`): `scope?` or `assets?: CardAssetId[]` (assets win; default `hero`), `mainJobId?`, `productImages: ImageRef[1..6]`, plus the copy fields from `docs/spec/listing.md:197-220` (`productName`, `bullets`, `painPoints`, `efficacyClaims` + `efficacySource`, `howToUse`, `endorsement`, …) |
| Steps | main: `cutout` → trim (code) → `upscale` if needed → compose + compliance checks (code). Then the fan-out, in parallel, per asset: `klein_edit_multiref` (anchor cutout → `image_1`, node 54) or `klein_t2i` → render the card (code). |
| Result | `CardsResult` (`lib/contracts/listing.ts:71-77`): `{ assets, main: MainImageResult \| null, tiles: [{ asset, state, seed, url, missing[], error }], styleBlock }` |

- **Tile states.** `CardTile.state` is a `CardTileState`: `PipelineStepStatus | "needs_input"` (`lib/contracts/listing.ts:15`), e.g. `queued | running | succeeded | needs_input | failed`.
- **Missing copy.** A tile whose user copy is missing is `needs_input`, and `missing` lists the request fields it needs. The run then ends `partial` (`docs/spec/listing.md:246`, T-T3).
- **Regenerate (planned).** `POST /api/pipelines/listing/{runId}/tiles/{assetId}/regenerate` re-runs only that tile. It keeps the anchor and `styleBlock` and changes only the seed (R-A3). It returns `202 PipelineRun`.
- **Export (planned).** `GET /api/pipelines/listing/{runId}/export` returns a zip of the `succeeded` tiles plus `cards.json`.

### 2.4 `POST /api/pipelines/motion`

| | |
|---|---|
| Request | `MotionRequest` (`lib/contracts/motion.ts:14-30`): `{ identityId? \| personImage?, productImage, prompt, duration?, aspectRatio?, quality?: "preview"\|"final", refFidelity?: "match"\|"max", seed? }` |
| Steps | resolve `<Picture 1>` (the identity's best ref, or the uploaded person) → prompt builder (code; adds `<Picture N>` role tags) → `h3_r2v` |
| Result | `MotionResult` (`lib/contracts/motion.ts:32-36`): `{ video: OutputRef \| null, seed, frames }` |

- **Person reference.** Exactly one of `identityId` or `personImage` is required.
- **Quality.** `quality: "final"` (the default) sets `turbo=false` with 20 base steps. `preview` uses the 4-step turbo LoRA (`docs/spikes/h3-r2v.md:104`).
- **Aspect ratio.** `aspectRatio` maps to a `ResolutionSelector` option through `H3_ASPECT_OPTIONS` (`lib/bindings/h3_r2v.ts`).

---

## 3. Graph bindings (contract for Comfy steps)

There is one binding model. Each `lib/bindings/<workflow>.ts` exports a `GraphBinding` (`lib/contracts/bindings.ts:47-52`) of the form `{ workflow, inputs: {name: {node, field, kind, mirrors?, required?, min?, max?, choices?}}, outputs: {name: nodeId} }`. `kind` is one of `image | text | int | float | bool`. `BINDINGS` (`lib/bindings/index.ts`) registers one per `WorkflowName`; both `POST /api/jobs` and pipeline `comfy` steps use it. A value is a `GraphValue`: `string | number | boolean | AssetHandle`, where an `AssetHandle` is an SDK `Asset` or a `core/ASSET` reference (`lib/contracts/bindings.ts:54-68`).

| Workflow | Inputs | Outputs | Graph source |
|---|---|---|---|
| `image_resize_smoke` | `image` 1 (required), `scale` 2.scale_by (0.05–2), `method` 2.upscale_method (`nearest-exact`, `bilinear`, `area`, `bicubic`, `lanczos`) | `image` 3 | `workflows/image_resize_smoke.api.json` (plumbing smoke test) |
| `klein_edit_multiref` | `image_1..image_4` (54, 60, 61, 62), `prompt` 4.text, `width`/`height` 44 (mirrored to 71), `batch_size`, `seed` 70.noise_seed, `steps` 71, `cfg` 72, `ref_megapixels` 17.resolution.megapixels, `model` 59.unet_name | `image` 9 | `workflows/klein_edit_multiref.api.json` (from `spikes/klein-multiref/flux2_klein_edit_multiref.api.json`) |
| `klein_t2i` | `prompt` p4.text, `width`/`height` p44 (mirrored to p71), `batch_size`, `seed` p70, `steps` p71, `cfg` p72, `model` 59 | `image` p9 | `workflows/klein_t2i.api.json` (the `p*` chain of `spikes/klein-multiref/flux2_klein_t2i_fixtures.api.json`) |
| `cutout` | `image` 17 | `cutout` 18, `mask` 21 | `workflows/cutout.api.json` (from `spikes/cutout-upscale/cutout.api.json`) |
| `upscale` | `image` 1, `scale` 57.resize_type.multiplier, `model` 52.unet_name (3B int8 default), `seed` 54, `color_correction` 59 (`wavelet`) | `image` 9 | `workflows/upscale.api.json` (from `spikes/cutout-upscale/upscale.api.json`) |
| `h3_r2v` | `image_1` 137 (required), `image_2` 139 (required: an unset `LoadImage` keeps the graph's placeholder file, which Comfy rejects), `prompt` 138.value, `seed` 129, `duration` 132, `turbo` 146, `steps_base` 143, `steps_turbo` 144, `aspect_ratio`/`megapixels` 115, `ref_image_size` 136 | `video` 92 | `workflows/h3_r2v.api.json` (from `spikes/h3-r2v/h3_r2v.api.json`) |

- **`applyBindings(graph, binding, values)`** returns a structured clone of the graph. It rejects:
  - unknown logical names;
  - values of the wrong kind, or outside the input's `min` / `max` / `choices`;
  - targets that are missing from the graph, or that are links (binding drift).
- **`resolveAssignments`** gives the same validated `{node, field, value}` list for the SDK's `workflow.setInput`, which is used for asset handles.
- **Tests.** `tests/bindings.test.ts` proves that every `BINDINGS` entry passes `checkBinding` against its `workflows/<name>.api.json`, and that every logical input changes exactly its bound node fields.
