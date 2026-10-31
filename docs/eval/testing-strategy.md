# Testing, validation and live demo

Status: proposal, written 2026-10-29 against `wave2` @ `c4e444e`; baseline and findings re-measured 2026-10-30 at `eabf7ba`, the head of [PR #7](https://github.com/wilsonhj/Open-Soul-Studio/pull/7) at that time (it includes `6da4cc9`). PR #7 has since merged into `main` as `f15b125`, whose tree is identical to `eabf7ba`, so the baseline and findings below hold for `main` as of `f15b125`. The file sits under `docs/eval/**`, which `docs/OWNERS.md` assigns to the orchestrator, so it needs no new ownership row. This PR also corrects `docs/submission/demo-script.md`, which belongs to slice G; G should sign off on that edit.

Three questions:

1. What do we test today, and what does it miss?
2. What must be true before we show the app to anyone, and how do we check it?
3. Now that PR #7 is on `main`, how do we run a live demo, locally and at a public URL?

## 1. Baseline

Measured locally on PR #7 @ `eabf7ba` (2026-10-30), macOS, Node 22, `COMFY_API_KEY` blank, clean checkout, `pnpm install --frozen-lockfile`. `main` @ `f15b125` has the identical tree, so these numbers hold for `main`; they were not re-run there.

| Check | Result | In CI? |
|---|---|---|
| `pnpm check:owners`, `pnpm check:models` | pass | yes |
| `pnpm lint`, `pnpm typecheck` | pass | yes |
| `pnpm test` (node:test against `tests/mock-comfy`) | 254 / 254 pass | yes |
| `pnpm build` | pass | yes |
| `pnpm test:e2e` (Playwright against the mock) | **12 pass, 0 fail, 19 skipped** (`test.fixme`), default ports | **no** (yes since PR #46) |
| Any workflow on Comfy Cloud | never run (free tier answers 403) | no |
| Output quality (identity, compliance on real images) | protocol only (`docs/eval/identity.md`) | no |

Earlier runs of the e2e suite: `c4e444e` 9 pass, 3 fail (F1, F2); `4fc07cb` 12 pass, 0 fail. The unit count grew from 224 (`c4e444e`) to 237 (`4fc07cb`) to 254. All 19 skips are acceptance tests for features not built yet: identity 5, photoshoot 5, listing 5, motion 4. The only e2e test that runs on `/photoshoot` or `/listing` checks that the page renders.

### Running the e2e suite locally

- **Browser.** On a machine where Playwright's browsers were never installed, every test fails at launch with `Executable doesn't exist … chrome-headless-shell` (F4). That is the environment, not the code: after `pnpm exec playwright install chromium` the same commit passes 12 / 12.
- **Ports.** The suite starts the mock on `127.0.0.1:8190` and the app on `127.0.0.1:3210` (not `pnpm demo`'s 8199 and 3000, so a running demo does not clash). Outside CI, `reuseExistingServer` is on: if something already listens on 8190 or 3210, Playwright tests that server instead of your checkout, and may report a pass for the wrong code. Check with `lsof -nP -iTCP:3210 -iTCP:8190 -sTCP:LISTEN`, or move the suite with `E2E_APP_PORT` and `E2E_MOCK_PORT`.
- **Which commit.** Test `main` (`git fetch origin && git checkout --detach origin/main`), or the head of whatever PR is under test (`git fetch origin pull/<n>/head:pr<n>`). A local branch can lag the remote.

### Findings to fix before a demo

State as of `main` @ `f15b125` (same tree as `eabf7ba`): F1 fixed; F2 passes but stays fragile; F3, F4 and F6 open. F5 is fixed by this PR.

| # | Finding | Root cause | Fix |
|---|---|---|---|
| F1 | `Photoshoot page renders` and `landing link navigates to /photoshoot` fail | `/photoshoot` had no `<h1>`. `components/photoshoot/photoshoot-studio.tsx` rendered the studio without a page heading, while `/listing`, `/identity` and the coming-soon pages have one. It is also an accessibility gap: a screen-reader user lands on a page with no title. | **Fixed in `98243cc`** (on `main` since PR #7), which adds the h1. |
| F2 | `landing page renders and links to the 4 tools` fails | The test takes the *first* `a[href="/photoshoot"]` in `main`. Since the landing redesign, that is the hero button "Start a photoshoot", not the tool card. | **Passes since `98243cc`**, which renames the button "Start a product shoot". The selector still hits the hero button, so the test breaks again if that copy changes. Selecting the tool card by role and name (`main.getByRole("link", { name: tool.name })`) would make it robust. |
| F3 | F1 and F2 reached the PR head unnoticed | CI does not run `pnpm test:e2e` (README: "Not run in CI"). | **Fixed by PR #46**, which adds an `e2e` job to `.github/workflows/ci.yml`. |
| F4 | `pnpm test:e2e` fails on a fresh machine with "Executable doesn't exist … chrome-headless-shell" | `playwright.config.ts` falls back only when `chromium.executablePath()` (full Chromium) is missing, and its fallback list holds only `E2E_CHROMIUM_PATH` and two Linux `/opt/pw-browsers/...` paths. On a fresh Mac the fallback runs but finds nothing, so Playwright launches its own headless shell, which is not installed either. The headless-shell mismatch is a second case: when full Chromium is installed without the headless shell, the check passes, the fallback is skipped, and the headless launch fails the same way. | **Open as of `main` @ `f15b125`** (reproduced 2026-10-30 at `eabf7ba`). Locally: `pnpm exec playwright install chromium`, or `E2E_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm test:e2e`. In the config, check the headless-shell path too, and when no browser is found, fail with a message that names both of those fixes. |
| F5 | The demo script does not match the app | `docs/submission/demo-script.md` said `/cards`, "Marketplace Cards", "Soul", and quoted a pitch line no longer on the landing page. `eabf7ba` fixed those names. Still wrong at `f15b125`: line 3 said the flows "have also run on real Comfy Cloud", which is false (README; L4 below), and its "Running on Comfy Cloud" section told the presenter to set a funded `COMFY_API_KEY` and run `pnpm dev`, against the L4 rules. | **Fixed by this PR**: line 3 now says no flow has run on Cloud, and the Cloud section says it is unverified and points to L4 instead of giving its own steps. Still rehearse the script against `main` (section 2, L3). |
| F6 | The mode lists disagree | README lists ten Product Shoot modes (with `hands_on`, `story_series`, …). `lib/enhancer/modes.ts` implements five (`packshot`, `in_context`, `wide_banner`, `mood_still`, `carousel_set`). The e2e `MODES` list is a third variant (it has `hands_on`). | **Open as of `main` @ `f15b125`.** Pick one source of truth (the code) and mark the rest as planned in the README and spec. |

## 2. Test layers

Each layer answers a different question, and only the cheap ones run on every push.

| Layer | Question it answers | Runs on | Where | Gate |
|---|---|---|---|---|
| L0 Static | Does it parse, type and follow the repo rules? | every push and PR | CI | blocking |
| L1 Unit | Does each module keep its contract? (bindings, runner protocol, access, deadlines, compliance maths) | every push and PR | CI | blocking |
| L2 E2E (mock) | Does a person get through each flow in a real browser, with a real Next server and the mock? | every PR | CI (since PR #46) | blocking (green since `4fc07cb`) |
| L3 Demo rehearsal | Does `pnpm demo` produce the outputs the script promises? | before every demo, and on PRs that touch `scripts/demo*` or the flows | local, optionally CI | checklist |
| L4 Cloud smoke | Does each registered graph run on Comfy Cloud and return the declared outputs? | manually, before a Cloud demo; later nightly | a machine with a paid key | blocking for a Cloud demo |
| L5 Quality | Are the images good enough to claim what we claim? | once per model or graph change | manual, recorded in `docs/eval/` | blocking for the claim |

### L0 and L1: keep as is, add the gaps

The unit suite is strong on protocol and failure modes (ambiguous submit, idempotency reuse, deadlines, cancel, recovery, access limits). Gaps worth closing:

- **Every registered pipeline definition plans against its real graph.** For each kind in `lib/pipeline/kinds.ts`, call `plan()` with a minimal valid request and run `checkBinding` on every Comfy step against `workflows/*.api.json`. That catches a renamed node id before Cloud does.
- **Listing compliance on golden images.** Check A1–A7 against a fixed pass image and the documented negative controls (opaque photo, product touching the edge, white-on-white), so a change to the compositor cannot silently loosen the gate.

Production config refusal, which the demo deployment depends on, is already covered: `tests/access.test.ts` checks that a submit fails closed in production without `STUDIO_ACCESS_CODE`, and without `HANDLE_SECRET`.

### L2: E2E against the mock

- With F1 and F2 fixed (`98243cc`), the suite is green, so the job can be blocking from the start.
- Each `test.fixme` is a feature's acceptance test, written ahead of the feature. Its PR should turn it into a real test. Keep the count in the PR description so the skipped number only goes down.
- Add one end-to-end journey per live surface. Two are missing today:
  - **Product Shoot:** upload `fixtures/products/product-bottle-transparent.png`, `packshot` × 4, all four frames succeed, reload mid-run and the run resumes. The run submits five jobs: one shared `cutout`, then one `klein_edit_multiref` per frame (`mockRequests().jobPosts` length 5).
  - **Listing hero:** the same transparent fixture gives a compliant 2000×2000 hero. `product-box-checker.png` (opaque) fails A4 and the run shows that.
- Keep `workers: 1`. The mock's scenario switch is global state.

### L3: Demo rehearsal

`pnpm demo` is a separate code path (`scripts/demo.mjs`, a proxy that pre-fills composited PNGs), so the L2 suite does not cover it. Before each demo:

1. `pnpm install && pnpm demo`, wait for `[demo] mock Comfy API v2` and Next's `Ready`.
2. Run the script end to end once, with a timer, on the same machine, browser and screen resolution as on stage.
3. Use the **transparent** fixture for the listing hero. The demo mock's cutout passes the upload through, so an opaque photo fails A4 on stage.
4. Check that the rail shows "Demo · local mock".

Worth automating once the script is stable: one Playwright spec with `OSS_DEMO=1` against the demo proxy, walking the script's clicks.

### L4: First contact with Comfy Cloud

No graph has ever run on Cloud, so this is the biggest open risk, and only a paid key retires it. Run in this order, cheapest and simplest first, and stop at the first failure:

| Step | Graph or flow | Pass when |
|---|---|---|
| 1 | `/smoke` (`image_resize_smoke`) | one output, re-hosted through `/api/jobs/.../outputs/...` |
| 2 | `cutout` (BiRefNet) | RGBA output, A4 ≥ 0.05 on the transparent fixture |
| 3 | `upscale` (SeedVR2) | output dimensions match the binding, no tiling seams |
| 4 | `klein_t2i` | one image per seed, same seed gives the same image |
| 5 | `klein_edit_multiref` | the product reference is visibly preserved |
| 6 | `/photoshoot` packshot × 4 | four succeeded frames, distinct variations |
| 7 | `/listing` hero | compliant hero (A1–A7) |
| 8 | `h3_r2v` | a clip of the declared length (only if Motion is in the demo) |

For each step, record in `docs/eval/cloud-smoke.md`: date, commit, graph hash, Comfy job id, wall time (queued and running), cost, and the output (or a link). Rules:

- A single test key with a hard spend cap, never the demo key. Never `submit()` twice by hand after an ambiguous error: the app deliberately does not retry, because a second submit bills twice.
- Run it with the production build (`pnpm build && pnpm start`), `HANDLE_SECRET` set and a `STUDIO_ACCESS_CODE` of at least 12 characters, so the access path is exercised too. Production refuses every submit (503) without them; nothing is billed, but the run is wasted.
- After step 8 passes, re-run steps 1, 6 and 7 the day before the demo to catch Cloud-side changes (node packs, model availability).

### L5: Quality

- **Identity:** `docs/eval/identity.md` is the pre-registered gate. Until it passes, the demo makes no identity-preservation claim.
- **Listing:** A1–A7 are automated. Add a human pass/fail on ten real heroes across the four fixtures for "would a marketplace reviewer accept this?"
- **Product Shoot:** for 3 products × 5 modes × 4 frames, a reviewer marks each frame keep or reject, and checks that the product is the same product (label, shape, colour). Report the keep rate, not a cherry-picked grid.

## 3. CI changes

### 3.1 What stays

The `check` job is right. Keep `COMFY_API_KEY: ""`, so CI can never reach the real API.

### 3.2 Add an e2e job

```yaml
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
        env:
          COMFY_API_KEY: ""
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/
```

The `playwright.config.ts` comment "Never run `playwright install` in this environment" refers to the sandboxed environment the slices were built in. On a GitHub runner, installing the browser is the normal path. `.github/**` belongs to slice G in `docs/OWNERS.md`.

### 3.3 Later: an opt-in Cloud smoke

A `workflow_dispatch`-only workflow that runs L4 steps 1, 6 and 7 against a capped key held in a GitHub environment secret with required reviewers. Never on `pull_request`, because a PR from a fork must not be able to spend credits.

## 4. Live demo from `main`

What is live on `main` as of `f15b125`: the landing page, `/photoshoot` (product only), `/listing` (hero image), `/runs`, `/smoke`. `/identity` has the intake form only, and Motion is marked "soon". The demo shows those, and says so.

There are three ways to run it. They are not exclusive.

| | A. Local, mock | B. Public URL, mock | C. Public URL, Comfy Cloud |
|---|---|---|---|
| Real model outputs | no (composited placeholders) | no | yes |
| Needs a paid Comfy key | no | no | yes |
| Ready on `main` | yes, once this PR's F5 fix lands | needs a production demo launcher | needs L4 to pass |
| Cost while running | none | a small always-on server | the server plus Cloud jobs |
| Risk on stage | lowest | network | network, queue times, credits |

### 4.1 A. Local, on the presenter's machine (works on `main`; use the script as corrected by this PR)

```bash
git pull && pnpm install
pnpm demo        # mock Comfy on 127.0.0.1:8199 + the studio on http://127.0.0.1:3000
```

- Rehearse the script once against `main`: F5 brought it in line with the UI, and later copy changes can drift it again.
- Warm every route once (`/`, `/photoshoot`, `/listing`, `/runs`). `pnpm demo` runs `next dev`, so the first visit to each route compiles it.
- Say in the first minute that the image model is a mock, as the script already does. The rail's "Demo · local mock" label makes that visible.
- Fallback: a screen recording of the same run, made during the L3 rehearsal.

### 4.2 B. A public URL backed by the mock (for judges who want to click around)

Why not Vercel or any serverless host, as the code stands:

- **The pipeline runner works after the response.** `POST /api/pipelines/{kind}` returns 202, then `lib/pipeline/runner.ts` keeps submitting and polling in the same process (`void schedule(...)`). A serverless function is frozen or killed once it responds, so runs would stall until the next GET revived them.
- **State is on local disk.** Runs and job deadlines are files under `DATA_DIR`. Serverless instances do not share a disk, and their disks do not persist.
- **Limits and the deadline sweep live in memory** (`SUBMITS_PER_HOUR`, the `instrumentation.ts` reconciler), per instance.

Moving to serverless would mean a durable job queue and object storage for runs. That is a real redesign, not a demo task.

What works: **one long-running Node 22 process with a persistent disk.** Any small VM or container host with a volume will do. For a one-off session, the presenter's laptop behind a tunnel (Cloudflare Tunnel, Tailscale Funnel) also works.

`pnpm demo` cannot be deployed as is, because it runs `next dev`. A small change makes it deployable: let `scripts/demo.mjs` start `next start` (after `next build`) when `DEMO_PROD=1`, keeping the same mock proxy. Then:

```bash
pnpm install --frozen-lockfile && pnpm build
# HANDLE_SECRET (openssl rand -base64 32) and STUDIO_ACCESS_CODE (openssl rand -base64 18)
# live in a mode-0600 env file, not on the command line.
set -a && . /etc/open-frame-studio.env && set +a
DEMO_PROD=1 PORT=3000 OSS_DEMO=1 DATA_DIR=/data TRUSTED_PROXY_HOPS=1 \
node scripts/demo.mjs
```

- `STUDIO_ACCESS_CODE` is not about money here (the mock bills nothing). It stops strangers from filling the disk with uploads. Share it with the judges along with the URL.
- `TRUSTED_PROXY_HOPS=1` when exactly one proxy sits in front of the app, so the per-IP limits work.
- `scripts/demo.mjs` hard-codes `--hostname 127.0.0.1` for Next, so plan B has the same bind problem as plan C: the host needs a reverse proxy on the same machine, or the launcher needs a hostname override alongside `DEMO_PROD=1`.
- The mock keeps its state in memory and the run store keeps its state on disk. A restart therefore leaves stored runs, and the job deadline records in `/data/jobs` (`lib/job-deadlines.ts`), pointing at mock jobs that no longer exist. For a demo host that is acceptable: clear both `/data/runs` and `/data/jobs` on deploy.

### 4.3 C. A public URL backed by Comfy Cloud (the real demo)

The same host as B, without the mock:

```bash
pnpm install --frozen-lockfile && pnpm build
# /etc/open-frame-studio.env, mode 0600: COMFY_API_KEY (paid, spend-capped), HANDLE_SECRET, STUDIO_ACCESS_CODE
set -a && . /etc/open-frame-studio.env && set +a
NODE_ENV=production PORT=3000 DATA_DIR=/data TRUSTED_PROXY_HOPS=1 \
SUBMITS_PER_HOUR=60 SUBMITS_PER_HOUR_PER_IP=10 \
pnpm start
```

Keep the paid key off the command line, where it lands in shell history and the process list. Put it, with the other secrets, in an env file only the service user can read (`chmod 600`), or in the host's secret store.

Note that `pnpm start` binds to `127.0.0.1`, so the host needs a reverse proxy on the same machine, or the start script needs a `--hostname` override.

Prerequisites, in order:

1. A paid Comfy Cloud plan, and a key with a spend cap.
2. L4 steps 1–7 pass (step 8 only if Motion is shown).
3. The quality claims made in the script are backed by L5 results.
4. Cost per run measured in L4, multiplied by the expected number of demo runs, fits the cap with room to spare.
5. Expected queue time measured in L4. If a cold start can take minutes, the script fills that time, or uses a run started just before going on stage (the `/runs` page and reload-resume make that natural).
6. A mock fallback within one command: keep plan A running on the presenter's laptop.

The access code is the billing control: every submit costs real credits. Never set `ALLOW_PUBLIC_SUBMIT=true` on this host.

Running on our own GPU instead of Comfy Cloud (`COMFY_BASE_URL`, `comfy deploy`) is possible in principle, but the app expects the Comfy API v2 surface through `comfy-api-proxy`. Whether a `comfy deploy` endpoint speaks that API is unverified. Treat it as a later experiment, not the demo path.

## 5. Demo readiness checklist

- [x] PR #7 merged (`main` @ `f15b125`)
- [ ] CI green on `main`, including the new e2e job
- [ ] F3, F4 and F6 fixed (F1 is fixed on `main` and F5 by this PR; F2 passes, selector still fragile)
- [ ] Demo script rewritten against the merged UI and rehearsed with a timer (L3)
- [ ] Fallback recording made
- [ ] For a public URL: deployed, `HANDLE_SECRET`, `STUDIO_ACCESS_CODE` and `TRUSTED_PROXY_HOPS` set, startup log shows no `[access]` warning
- [ ] For Comfy Cloud: L4 table filled in, spend cap set, the day-before re-run passed
- [ ] Every claim in the script maps to a test or an eval result
