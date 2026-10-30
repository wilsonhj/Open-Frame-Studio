# Golden runs and the object_info check

Two offline checks and one billed run that together back the `bindings-v1` tag (docs/PLAN.md,
"Freeze rule").

## `scripts/check-object-info.mjs` (offline; `pnpm check:graphs`, CI, and `pnpm test`)

Checks every `workflows/*.api.json` against `fixtures/golden/object_info.cloud.json`, a snapshot of
Comfy Cloud's `GET /api/object_info`:

- every node class exists on Cloud, isn't a partner (API) node and isn't deprecated;
- every literal widget value has the right type, sits inside the widget's min/max and is one of its
  COMBO options; model filenames must be ones Cloud listed;
- every link points at an existing node and a real output slot whose type the input accepts (`*`,
  `A,B` unions and V3 match types with `allowed_types` included); every required input is set;
- V3 dynamic inputs (`resize_type.multiplier`, `values.a`, `images.image0`) resolve through the
  selected dynamic-combo option (whose own required inputs must be set) or the autogrow template
  (children named from its `names`, or `<prefix><n>`, within its min/max count).

`tests/graphs/object-info.test.ts` also checks each binding (lib/bindings) against the widget it
targets: kind vs widget type, binding min/max inside the widget's, `choices` among the options, and
`randomize` only on INT widgets.

**Snapshot.** Taken 2026-10-30 with one read-only `GET https://cloud.comfy.org/api/object_info`
(no job, nothing billed), trimmed to the 42 classes the workflows use. Model-file COMBO lists keep
only the files our workflows reference; upload lists (`LoadImage`) are emptied, because they list the
account's own uploads. To refresh: save a new response to a file, then

```bash
node scripts/check-object-info.mjs --refresh /path/to/object_info.json
```

`--refresh` trims model-file COMBO lists to the filenames the workflows use **at refresh time**. To
switch a workflow to a different model file, edit the workflow first and then refresh from a full
`object_info` response that lists it. Refreshing before the edit drops the new filename, and the
check then reports it as not available on Comfy Cloud.

## `scripts/golden-run.mjs`

One golden job per workflow. Three modes:

| Command | Network | Billed |
|---|---|---|
| `node scripts/golden-run.mjs` | none: binds each golden job and runs the object_info check | no |
| `node scripts/golden-run.mjs --mock [--out DIR]` | in-process `tests/mock-comfy` | no |
| `node scripts/golden-run.mjs --live --spend-credits (--workflow a,b \| --all) [--balance]` | Comfy Cloud (`COMFY_API_KEY`) or `COMFY_BASE_URL` | **yes** |

`--live` refuses to start without `--spend-credits`, a configured backend and named workflows
(`--workflow` and `--all` are exclusive in every mode). It writes
`fixtures/golden/<workflow>/run.json` and the declared outputs beside it. Ctrl-C (SIGINT) or SIGTERM
during a pass requests a cancel of the in-flight job, records the outcome under `interrupted` in its
`run.json` and exits non-zero (130/143); a re-run resumes that job id by polling.

**Submit discipline** (same as the runtime, docs/spec/api.md §2.0): the idempotency key is written to
`run.json` before the POST. Re-running resumes a recorded job id by polling and never re-POSTs it;
an ambiguous submit is re-sent only under the same key; a 422 key reuse with no job id is recorded as
`submit_unconfirmed` and never resubmitted under a new key. A finished `run.json` is never run
again: delete it to repeat that job.

**Timing and cost.** `timing.wallMs`, `queuedMs` and `runningMs` are observed by polling. Comfy
reports no per-job cost for API v2 jobs; `--balance` records the account balance before and after
the pass (`GET /api/billing/balance`), labelled approximate because other usage in the window counts
too. Per-workflow cost comes from running one workflow per pass with `--balance`.

### The full live pass

What `--live --spend-credits --all` submits: 6 jobs, one per workflow, nothing else. Inputs are the
synthetic product fixtures in `fixtures/products/` (no faces in the repo).

| Workflow | Model(s) | Settings | Output |
|---|---|---|---|
| `image_resize_smoke` | none | ImageScaleBy 0.5×, lanczos | 1 PNG, 256×256 |
| `cutout` | BiRefNet | 1 pass on a 512×512 photo | 2 PNGs (cutout + mask), 512×512 |
| `klein_t2i` | FLUX.2 Klein 4B distilled | 4 steps, cfg 1, seed 101, graph prompt | 1 PNG, 768×1024 |
| `klein_edit_multiref` | FLUX.2 Klein 4B distilled | 4 reference images at 1.0 MP, 4 steps, seed 1 | 1 PNG, 1024×1024 |
| `upscale` | SeedVR2 3B int8 | 1 step, tiled VAE, 2×, wavelet colour fix | 1 PNG, 1024×1024 |
| `h3_r2v` | MiniMax H3 + turbo LoRA | 2 refs, turbo 4 steps, 5 s at 24 fps (124 frames), 0.4 MP 9:16, with audio | 1 MP4, about 480×832 |

The H3 clip is by far the most expensive job. For a cheap first pass run
`--workflow image_resize_smoke,cutout,klein_t2i,klein_edit_multiref,upscale` and add `h3_r2v` once
that's green. `bindings-v1` needs every workflow's golden run.
