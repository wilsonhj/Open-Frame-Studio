# Architecture

How the code on `main` works today. All four tools (Identity, Product Shoot, Listing Images and Motion) are built on one multi-step pipeline runtime. The runtime, Product Shoot and the Listing hero landed with Wave 2 (see [Wave 2](#wave-2) at the end); later PRs added the Listing panels, Identity and Motion.

For the HTTP contract, including the planned pipeline routes, see [spec/api.md](spec/api.md). The TypeScript types in `lib/contracts/` are the source of truth.

## What exists

| Surface | State |
|---|---|
| `/smoke` | Works. Uploads an image, runs `image_resize_smoke` through `/api/jobs`, shows the output. |
| `/identity` | Works. Intake (name, likeness consent, 5–20 photos; the picker stays locked until consent is given), YuNet photo checks and reference selection, a preview sheet, and `identity.json` export and import, through `/api/souls/**`. |
| `/photoshoot` | Works. Product cutout, then FLUX.2 Klein frames in five shoot modes (`lib/enhancer/modes.ts`). Uses the product photo only; an identity is ignored for now. |
| `/listing` | Works. The compliant white-background hero (checks A1–A7, C3), then gallery and story panels anchored on it, with a ZIP export. |
| `/motion` | Works. A person still (Picture 1) and a product still become one MiniMax H3 reference-to-video clip. Using a saved identity as Picture 1 is off for now (`MOTION_IDENTITIES_ENABLED` in `lib/motion/options.ts`), so an `identityId` is refused with a 400. |
| `/runs` | Recent runs in this tab. |
| `/api/jobs` | Single-job API, used by `/smoke`. Described below. |
| Pipelines | `/api/pipelines/[kind]/**` (create, status, actions, step files) over the registry in `lib/pipeline/kinds.ts`: `identity` (`lib/soul/pipeline.ts`), `photoshoot`, `listing` (`lib/cards/pipeline.ts`) and `motion`. Contract in `lib/contracts/pipeline.ts` and [spec/api.md §2](spec/api.md). |

Product name and surface labels live in `lib/brand.ts`. The package and repository are still called `open-soul-studio`.

## Single-job flow (`/api/jobs`)

```
POST /api/jobs  (multipart: workflow, access_code?, one field per bound input)
  getBinding ─▶ assertMaySubmit ─▶ parseInputs ─▶ loadGraph ─▶ applyBindings ─▶ submitOnce ─▶ recordJob ─▶ createJobHandle ─▶ 202
GET  /api/jobs/:handle                      readJobHandle ─▶ getJob ─▶ enforce deadline ─▶ Job
GET  /api/jobs/:handle/outputs/:outputId    readJobHandle ─▶ fetchOutput (declared outputs only) ─▶ bytes
```

1. **Binding lookup.** `workflow` must be a key of `BINDINGS` in `lib/bindings/index.ts`. Unknown names are a 400; this also rules out path traversal.
2. **Access.** `assertMaySubmit` checks `STUDIO_ACCESS_CODE` and takes a rate-limit slot, and returns a function that refunds the slot if Comfy never accepted the job. In production a submit is refused (503) unless the code is set (12+ characters) or `ALLOW_PUBLIC_SUBMIT=true`. Wrong codes are limited per client address, which needs `TRUSTED_PROXY_HOPS`; see the README for the details and the warning logged at startup.
3. **Inputs.** `parseInputs` (`lib/inputs.ts`) validates each field by its binding kind, fills a fresh random value for any `randomize` input the request left out, and turns image parts into SDK asset handles. Uploads must be PNG, JPEG or WebP, at most 20 MB, and must start with the signature of their declared type before any asset is created on Comfy.
4. **Graph.** `loadGraph` reads `workflows/<name>.api.json` and rejects UI-format exports. `applyBindings` writes each value onto its node and field (and any `mirrors`).
5. **Submit.** `submitOnce` sends the workflow exactly once under a fresh `crypto.randomUUID()` idempotency key.
6. **Deadline and handle.** `recordJob` persists the job's deadline. `createJobHandle` signs `{binding, submittedAt, jobId}` with `HANDLE_SECRET`. The response is `202` with a `SubmittedJob`: the job, `id` set to the signed handle, and `seeds` holding the value each `randomize` input ran with.

The browser only ever sees the signed handle, never the Comfy job id, a Comfy URL, a signed storage URL or the API key. Holding the handle is the capability to read the job; nobody can forge one for another job on the account.

### Status codes

| Route | Status | Meaning |
|---|---|---|
| `POST /api/jobs` | 202 | Submitted |
| | 400 | Not multipart, unknown workflow, or invalid input (`field` returned) |
| | 401 | Access code missing or wrong |
| | 429 | Too many submits, or too many wrong codes (`Retry-After` set); also Comfy's own 429 |
| | 402 | Comfy reports the account is out of credits |
| | 422 | Any other definitive 4xx from Comfy (`code` and `details` returned) |
| | 502 | Anything else. Code `submit_ambiguous` means the outcome is unknown and a job may exist; this route keeps no run state, so it cannot re-send |
| | 503 | `COMFY_API_KEY`, `HANDLE_SECRET` or access settings not configured, or Comfy answered 401/403 for the server's key (a plan or key problem, not the caller's) |
| `GET /api/jobs/:handle` | 200 | Job, `Cache-Control: no-store` |
| | 404 | Unknown or invalid handle |
| | 503 | Comfy briefly cannot find the job (`job_missing`, `Retry-After: 5`), or not configured |
| | 502 | Upstream error |
| `GET /api/jobs/:handle/outputs/:outputId` | 200 | Bytes, via `outputResponseHeaders` |
| | 404 / 502 / 503 | Output not on this job / upstream error / not configured |

## Comfy client (`lib/comfy.ts`)

A server-only wrapper around `@comfyorg/sdk` 0.5.0, adapted from `Comfy-Org/comfy-reshoot` (MIT). It targets Comfy Cloud unless `COMFY_BASE_URL` is set. With neither a key nor a base URL, `createClient` throws `ComfyNotConfiguredError`.

| Trap | Handling |
|---|---|
| A retried submit double-bills | `submitOnce` requires the caller's idempotency key and never retries. A 4xx becomes `SubmitRejectedError` (including 422 `idempotency_key_reuse`). A 5xx, a transport error or an abort becomes `SubmitAmbiguousError`: a job may exist, and the only safe re-send is under the same key. The SDK may itself wait out a 429 `queue_full` under that key. |
| A proxy job can stay `unknown` forever | `pollJob` requires a positive `timeoutMs` and returns a terminal job with error `poll_timeout` at the deadline. |
| `metadata` | Never sent. |
| SSE | Not used; status comes from polling. |
| Signed output URLs expire | `fetchOutput` re-hosts the bytes. On Cloud it follows the signed URL without the bearer token; when the URL is on the API origin (a proxy), it reads through the SDK. It serves only the workflow's declared output nodes, and `outputResponseHeaders` serves media types inline and anything else (HTML, SVG, scripts) as a sandboxed download. |
| UI-format workflow JSON | `assertApiFormat` rejects it. |
| Overdue jobs | `requestCancel` asks Comfy to cancel and reports `canceled`, `cancel_requested` or `cancel_failed` from what Comfy returned. Only a terminal status from Comfy counts as canceled. |

## Deadlines and recovery

**Server.** `lib/job-deadlines.ts` writes each accepted job's deadline to `${DATA_DIR:-.data}/jobs/` (budget `JOB_DEADLINE_MS`, default 15 minutes). A reconciler started by `instrumentation.ts` sweeps every 60 s, cancels overdue jobs, retries a failed cancel after 30 s, and drops a record only when the job is terminal or Comfy has answered 404 for ten minutes straight (it also gives up, with a log line, 24 hours after the deadline). `GET /api/jobs/:handle` also runs the check, so a deadline holds even when no browser is watching. A job that Comfy reports `canceled` after its deadline carries the error `deadline_exceeded` ("Stopped: it ran past its 15-minute time budget.", or the seconds form for a budget under a minute) instead of a plain cancel. That needs a long-running Node server; on a serverless host enforcement happens only when a job route is called.

**Browser.** `lib/job-recovery.ts` keeps one `localStorage` entry per unfinished run (`studio:unfinished-job:<handle>`), so a reload resumes watching a paid job instead of starting a second one. Each entry names its owning tab; an entry untouched for two minutes may be adopted by another tab. Entries older than 24 hours are dropped.

## Contracts and bindings

`lib/types.ts` re-exports `lib/contracts/`, split by domain: `job`, `pipeline`, `bindings`, `identity`, `photoshoot`, `listing`, `motion`. The files have no runtime dependencies, so server code, client code and `node --test` can all import them.

A `GraphBinding` maps logical input names to `{node, field}` in an API-format graph, with a `kind` (`image`, `text`, `int`, `float`, `bool`) and optional `required`, `min`, `max`, `choices`, `mirrors` and `randomize`. Its `outputs` map logical names to the `Save*` node ids the UI may show. The six registered workflows and their inputs are listed in [workflows/README.md](../workflows/README.md).

`JobStatus` is `queued | running | succeeded | failed | canceled | expired | unknown`. The first six come from API v2; `unknown` is what a self-hosted proxy can report, possibly forever, and what anything unrecognised maps to.

## Identity consent

`lib/identity/consent.ts` holds the statement the user ticks and `assertIdentityConsent`, which the identity route must call before uploading any photo. The intake form enforces the same rule in the browser: withdrawing consent drops the photos already picked. `app/api/souls/route.ts` and `app/api/souls/import/route.ts` call it before accepting photos or a bundle, and `lib/identity/intake.ts` and `lib/soul/pipeline.ts` check it again.

## Mock Comfy API and tests

`tests/mock-comfy/server.ts` implements the part of Comfy API v2 that the SDK uses: asset probe, upload and content, `POST /api/v2/jobs` with idempotency-key tracking, and `GET /api/v2/jobs/:id`. It advances a scripted scenario one step per poll. Scenarios: `succeeded`, `failed`, `unknown_forever`, `expired`, `reject_idempotency`, `multi_output`, `slow_progress`, `queued_20s`, `asset_missing`, `drop_after_create`. Control endpoints under `/__mock/` switch scenario, report recorded requests and reset state. `tests/mock-comfy/control.ts` wraps them for Playwright.

| Command | Covers |
|---|---|
| `pnpm test` | `node --test` over `tests/**/*.test.ts` with `--conditions=react-server`, which lets `server-only` import. Client wrapper, bindings, input parsing, access control, deadlines, recovery, status copy, consent, and the mock's own scenarios. No network. |
| `pnpm test:e2e` | Playwright specs in `tests/e2e`, run against the app and the mock. Runs in CI. |

CI runs install with a frozen lockfile, `check:owners`, `check:models`, `check:graphs`, lint, typecheck, `pnpm test` with a blank `COMFY_API_KEY`, then build, on Node 22. A separate `e2e` job installs Chromium and runs `pnpm test:e2e` against the mock.

## Not built or not verified yet

- Cloud evidence: Product Shoot, the Listing hero, gallery and story panels, and Identity have run on Comfy Cloud through the app (manual runs on Oct 30; only `fixtures/golden/h3_r2v/` is recorded in the repo). Motion's `h3_r2v` graph has run through `scripts/golden-run.mjs` with two product stills, but `/motion` itself has not run on Cloud. Open quality issues from those runs: generated Listing panels drift from the product's colour and material (nothing checks consistency with the hero), and Identity's photo-check thresholds (`lib/identity/qa.ts`) are still marked "calibrate" in the spec. The Cloud run's false blur rejects of sharp photos with smaller faces were fixed in PR #16: `faceSharpness` now only scales faces down.
- A measured identity-preservation result: the acceptance gate in [`docs/eval/identity.md`](eval/identity.md) needs human reviewers.
- Identity in Product Shoot: `lib/photoshoot/pipeline.ts` ignores `identityId`, and `/photoshoot` has no identity picker.
- Identity in Motion: `MOTION_IDENTITIES_ENABLED` is `false`, so `/motion` refuses an `identityId` before anything is uploaded.
- The Identity preview panel shows a status pill only: no queue position, progress bar or dedicated Retry control.
- A demonstrated self-hosted run through `comfy-api-proxy`.
- Some end-to-end specs are still `test.fixme`: they wait on unbuilt features (Identity in Product Shoot and Motion, Identity preview progress and Retry, the full Product Shoot mode list and interview) or on a test hook to shorten a step budget.

## Wave 2

Wave 2 ("pipeline runtime, studio shell, Product Shoot and Listing hero image") is on `main`. The table below is the record of that PR. Later PRs added the Listing gallery and story panels, Identity, Motion, the `object_info` graph check and golden-run tooling, so its last row no longer holds.

| Area | What the PR adds |
|---|---|
| Pipeline runtime | `/api/pipelines/[kind]` routes (create, read, actions such as retry and cancel, and files served under `files/{stepId}/{name}`) over `lib/pipeline/` (runner, gate, kinds, types). Runs are stored on disk, submit under a persisted idempotency key, reconcile after an ambiguous submit, and resume at boot from `instrumentation.ts`. Cancel aborts in-flight waits and asks Comfy to cancel live jobs. |
| Access policy | The pipeline routes follow the `/api/jobs` policy: billed actions call `assertMaySubmit` with a refund on refusal, cancel needs the access code, and reads use the server-minted run id as the capability. |
| Product Shoot (`/photoshoot`) | A product-only journey: a cutout, then N Klein frames, with per-item retry. Adds `lib/photoshoot/`, `lib/enhancer/` (mode templates and the variation engine) and the shoot components. |
| Listing Images (`/listing`) | The hero image composed at 85% fill on pure #FFFFFF, 2000×2000, with compliance checks A1–A7; a non-compliant hero fails the run. Adds `lib/cards/` and `components/cards/`. |
| Shell | A studio rail, shared UI primitives, a `/runs` page, a `useRun` polling hook (1 s, backing off to 5 s), and `pnpm demo`, which starts the mock on port 8199 and the app on port 3000. |
| Tooling | `docs/OWNERS.md` with `scripts/check-owners.mjs` for path ownership, `models/manifest.json` with `scripts/check-models.mjs`, bundled OFL fonts, and the `sharp` dependency. |
| Still stubbed or missing at the time | Identity and Motion pipelines (the rail shows them as "soon"), the listing gallery and story panels, and any Comfy Cloud run. |

