# Reverse-engineering findings: Higgsfield Soul ID, Product Photoshoot, Marketplace Cards (and the platform contract behind them)

> This record follows the reverse-engineering skill's findings template (`assets/findings-template.md`). Every claim carries a coordinate (`path:line`, binary-strings line, or doc block id) and a confidence tag:
> - **[read in source]**: read in published client source code.
> - **[read in docs]**: read in README, skill or model docs, or the research doc.
> - **[read in binary strings]**: from `strings` output of the released CLI binary.
> - **[inferred]**: our deduction. The basis is stated.
>
> The "Not verified" column says what we did not check. Nothing here was confirmed by calling Higgsfield's API: we hold no Higgsfield account or key (§5).

**Path abbreviations.** `SP` = `<scratchpad>`. Paths under `SP` are scratchpad clones of public repos; re-clone them from the URLs in `docs/RESEARCH.md:13-26`.

| Abbrev. | Path |
|---|---|
| `PY` | `SP/web/hf-api/higgsfield-client/src/higgsfield_client/` (Python SDK, Apache-2.0) |
| `PYR` | `SP/web/hf-api/higgsfield-client/README.md` |
| `JS` | `SP/web/hf-api/higgsfield-js/src/` (`@higgsfield/client` 0.2.6, Apache-2.0) |
| `JSR` | `SP/web/hf-api/higgsfield-js/README.md` |
| `CLI` | `SP/web/hf-gh/cli/README.md` (MIT) |
| `MD` | `SP/web/hf-gh/cli/MODELS.md` |
| `STR` | `SP/web/hf-gh/bin/s.txt` (`strings` of `SP/web/hf-gh/bin/hf`) |
| `BREW` | `SP/web/hf-gh/homebrew-tap/higgsfield.rb` |
| `SK` | `higgsfield-ai/skills (local clone)/` (skills v0.13.0, MIT, `LICENSE:1-3`). Upstream 0.14.0 at `SP/web/hf-gh/skills` differs in the Soul ID skill only by its `version:` line |
| `AT` | `SP/web/hf-gh/app-templates/` (**no licence: read for behaviour only, nothing copied**) |
| `RD` | Main research doc, (private planning document, not published) (Claude Docs). Cited by block id |
| `RR` | `docs/research/higgsfield-comfyui-research.md` |

## 1. Target identification

| Item | Value | Tag |
|---|---|---|
| Targets | Higgsfield **Soul ID** (identity "Soul Character"), **Product Photoshoot**, **Marketplace Cards**, and the public generation platform they run on (REST API, SDKs, `higgsfield` CLI) | — |
| Public REST host | `https://api.higgsfield.ai` (`PY/http/client.py:58`; `JS/config.ts:26`) | [read in source] |
| SDKs | Python `higgsfield-client` (UA `higgsfield-client-py/1.0`, `PY/http/client.py:59`); JS `@higgsfield/client` 0.2.6 with a recommended v2 client and a deprecated v1 client (`JSR:319-321`) | [read in source] |
| CLI artefact analysed | `SP/web/hf-gh/bin/hf`: ELF 64-bit x86-64, statically linked Go, **stripped**. Size 19,857,568 B. sha256 `bbbb7147dfeca64ac0c490169eb8758e8f61dca9f8d4f19072ae416b654796e4`. Extracted from `hf.tgz` (sha256 `0ed594ae42646d494b9eaeec4359211f6cfd653ce4f790aa4ca6a48c1a431529`) | [read in binary strings] (`file`, `sha256sum`) |
| CLI build | ldflags `main.version=1.2.3`, `main.commit=4cdfcbdbc9972c1092f9d8fcb93a00c3a97de84f`, `main.date=2026-10-22T12:47:35Z`, `config.buildDefaultAPIURL=https://fnf-api-gw.higgsfield.ai/fnf`, `config.buildConfigLocked=true`. Toolchain `go1.27.3`. Module path `github.com/higgsfield-ai/cli-src` (a private repo) (`STR:7069`, `STR:6864`; `RD` block `.15938`) | [read in binary strings] |
| Distribution | Homebrew formula v1.2.2, licence MIT. Installs `hf` as `higgsfield` with aliases `higgs` and `hf` (`BREW:7-19`). The public `cli` repo holds docs and an installer only, no source (`docs/research/higgsfield-comfyui-repository-research.md:298`) | [read in docs] |
| Packed / obfuscated / signed | Stripped symbols, not packed. The JS v2 SDK builds its User-Agent at runtime "to avoid exposing it in source" (`JS/v2/client.ts:126-130`) | [read in binary strings], [read in source] |

## 2. Scope and authorization

- **Context:** interoperability research for a **clean-room behavioural reimplementation** on open weights and ComfyUI: Open Soul Studio, for Comfy's Open Source Higgsfield challenge (`docs/PLAN.md:20-50`).
- **Authorisation basis:** public sources only:
  - MIT skills and CLI docs;
  - Apache-2.0 SDK source;
  - `strings` on a publicly released binary;
  - a read-only look at the unlicensed `app-templates`, for behaviour only.

  No Higgsfield account or key was used. No auth or billing was bypassed. No Higgsfield endpoint was called. No decompilation was done beyond `strings`.
- **Clean-room rule:** nothing is copied from `app-templates` (no licence; `docs/PLAN.md:47-49`). Skill and SDK prose is paraphrased, not copied.
- **Goal:** state the observable contract (inputs, outputs, states, limits) of the three tools and the platform, so our rebuild matches the *behaviour*, and list what is server-side and unknowable.
- **Secrets handling:** the binary embeds a Sentry DSN (`STR:7069`). Its value is deliberately **not** reproduced here.

## 3. Environment and tools

- Cloud container (Linux, CPU only). No network access to Higgsfield was used.
- Tools: `file`, `sha256sum`, `strings` (output already saved as `STR`), `grep`, `diff -r`. Comfy Cloud `GET /api/object_info` was read once with `COMFY_API_KEY` and saved as `SP/object_info.json` (read-only; the key was never printed).
- Reproduce the key lookups:
  - `grep -n 'fnf-api-gw\|clerk.higgsfield\|code_challenge\|S256\|/souls\|custom_reference_id' STR`
  - `grep -n 'requests/\|generate-upload-url\|hf_webhook\|custom-references' -r PY JS`

## 4. Static findings

### 4a. Public REST contract (SDK source)

| ID | Coordinate | What it is | Evidence | Known via | Not verified |
|---|---|---|---|---|---|
| F1 | `PY/http/client.py:58`; `JS/config.ts:26` | Base URL is `https://api.higgsfield.ai` | Constant in both SDKs | [read in source] | — |
| F2 | `PY/auth.py:6-21`; `PY/http/client.py:199-201`; `JS/v2/client.ts:75-83`, `:119`; `PYR:18-24` | Auth header is `Authorization: Key <key_id>:<key_secret>`. Credentials come from env `HF_KEY` (`id:secret`) or `HF_API_KEY` + `HF_API_SECRET` | Header built from the joined pair | [read in source] | Key format and how the key is scoped server-side |
| F3 | `PY/http/client.py:225-247`; `PY/utils.py:29-35`; `JS/v2/client.ts:260-277` | **Submit** is `POST /<model path>` with the model's input JSON as the body. The v2 body is the input object itself, not wrapped. Model ids are paths such as `bytedance/seedream/v4/text-to-image` (`PYR:39`) and `flux-pro/kontext/max/text-to-image` (`JSR:34`) | SDK posts to the application string, relative to the base URL | [read in source] | Full model-path catalogue (server-side) |
| F4 | `PY/http/client.py:249-257`; `JS/v2/types.ts:87-94`; `JSR:184-193` | Submit response has `request_id`, `status_url`, `cancel_url` and `status`. On completion it also has `images[{url}]` and/or `video{url}` | Response fields read by the SDKs; example JSON in the README | [read in source], [read in docs] | Other fields (seed, timings, cost) |
| F5 | `PY/http/client.py:79-86`, `:109-128`; `JS/v2/client.ts:186-223` | **Status** is `GET /requests/{id}/status`. The Python SDK reads the final result from the **same** URL (`response_url = status_url`) | URL builder; poll loop | [read in source] | — |
| F6 | `PY/types_.py:106-112`; `JSR:177-181` | Status values: `queued`, `in_progress`, `completed`, `failed`, `nsfw`, `canceled`. The README says `nsfw` and `failed` refund credits | Enum; README list | [read in source], [read in docs] | Refund mechanics |
| F7 | `PY/http/client.py:106-107`, `:317-328`; `PY/types_.py:96-103`; `AT/generation/platform.ts:107-117` | **Cancel** is `POST /requests/{id}/cancel`. Only queued requests can be cancelled; a started one returns 400. The app-templates comment notes a 202 reply and the status becoming `canceled` | Docstrings and call | [read in source] | Exact response body |
| F8 | `PY/utils.py:29-35`; `JS/v2/client.ts:268-273`; `JSR:125`; `JS/helpers.ts:175-196` | **Webhooks:** the query parameter `?hf_webhook=<url-encoded>` on the submit URL. The JS helper takes a `secret`, documented as sent in an `X-Webhook-Secret-Key` header. The v2 `subscribe` puts only the URL in the query string; the v1 client puts `{url, secret}` in the body (`JS/client.ts:79-84`) | Code and doc comment | [read in source] | **Gap:** webhook payload shape, signing and retry policy are not in any source read |
| F9 | `PY/http/client.py:330-381`; `JS/client.ts:139-161`; `AT/generation/platform.ts:5`, `:85-91` | **Upload:** `POST /files/generate-upload-url {content_type}` returns `{upload_url, public_url, upload_headers?}`. The client then PUTs the bytes to `upload_url` and uses `public_url` as the media input. `AT` keeps signed upload URLs out of its logs, treating them as credentials | Code | [read in source] | URL lifetime; size and type limits |
| F10 | `PY/http/retry.py:116`, `:161-210`; `PY/http/transport.py:24-45`; `JS/utils/retry.ts:10-32`; `JS/v2/client.ts:275-284` | The SDKs **retry submits**: Python retries any method on 408/429/5xx (3 tries, exponential backoff from 0.2 s); JS retries `POST` submits on 5xx and network errors | Retry strategy wraps every transport call, including POST | [read in source] | Whether the server dedups a retried submit. If not, a retried submit after a lost response double-bills (**[inferred]**). We keep our own "never auto-retry submit" rule (`docs/PLAN.md` Known traps) |
| F11 | `PY/http/client.py:55-56`; `JS/config.ts:19-24`; `AT/generation/poll.ts:5-8` | Poll defaults: Python 0.5 s interval and 90 s HTTP timeout; JS 2 s interval, 5 min max poll, 120 s timeout; app-templates 4 s interval with a 10 min deadline. Terminal set: completed, failed, nsfw, canceled | Constants | [read in source] | Server-side rate limits |
| F12 | `JS/client.ts:47-55`; `PYR:441`; `JSR:314` | Errors: 401 bad credentials; 403 not enough credits (v1 client mapping); 402 insufficient credits (agents API); 422 validation (`detail` array); 400 bad input | Interceptor and README | [read in source], [read in docs] | Whether v2 uses 402 or 403 for credits |
| F13 | `JS/v2/client.ts:55-61`, `:69` | The v2 SDK **refuses to run in a browser**, so keys stay server-side | `checkBrowserEnvironment` throws | [read in source] | — |
| F14 | `JS/client.ts:27-36` | The v1 (deprecated) client authenticates with headers `hf-api-key` and `hf-secret` instead of `Authorization` | axios defaults | [read in source] | Whether v1 headers still work |
| F15 | `RR:58` | API outputs stay available for **at least 7 days** and may then be removed; integrations should copy them to their own storage | Research report citing Higgsfield's API guide | [read in docs] | — |
| F16 | `PY/agents/resources.py:56-157`; `PYR:403` | Separate agent API: `/v1/agent/sessions`, `/sessions/{id}/messages`, `/interrupt`, and `/v1/agent/media` (+ `/{id}/confirm`) | Code | [read in source] | Out of scope |

### 4b. Soul ID contract

| ID | Coordinate | What it is | Evidence | Known via | Not verified |
|---|---|---|---|---|---|
| F17 | `JS/client.ts:105-117`; `JS/types.ts:47-55` | **Create Soul** (v1 API): `POST /v1/custom-references` with body `{name, input_images: [{type: "image_url", image_url}]}`. Images are passed as URLs, so they are uploaded first (F9) | SDK method `createSoulId` | [read in source] | Whether v1 is still served; the v2 path, if one exists |
| F18 | `JS/models/SoulId.ts:17-56`; `JS/types.ts:10-16`, `:41-45` | **Poll Soul:** `GET /v1/custom-references/{id}`. Status is one of `not_ready`, `queued`, `in_progress`, `completed`, `failed`. The client polls until completed or failed, skipping 5xx errors | Polling model | [read in source] | Timing |
| F19 | `JS/client.ts:119-134` | **List Souls:** `GET /v1/custom-references/list?page=&page_size=` (default 1 and 20) returns `{items[...]}` | SDK method | [read in source] | — |
| F20 | `JS/models/SoulId.ts:6-15`; `SK/higgsfield-soul-id/SKILL.md:51-73`; `CLI:243-259`, `:598` | A Soul object is only `{id, name, status}`. The public surfaces are create, wait, list and get. **No export, download or weights endpoint exists** anywhere in the SDKs, CLI docs or skill | Absence across all three surfaces | [inferred] (from absence) | The private FNF API (F31) could have more routes |
| F21 | `SK/higgsfield-soul-id/SKILL.md:44`; `SK/higgsfield-soul-id/references/photo-guide.md:7-37` | Intake: 5–20 photos, 8–12 ideal. One clear face, eyes visible. No sunglasses or heavy filters. Varied angles, lighting, expressions and distance. Ideally ≥1024². JPEG or PNG. Avoid group shots, costumes and repeated poses | Skill text | [read in docs] | — |
| F22 | `SK/higgsfield-soul-id/SKILL.md:46-48`, `:55`; `SK/higgsfield-soul-id/references/troubleshooting.md:9-24`; `SK/higgsfield-soul-id/SKILL.md:32`, `:78` | Variants: `--soul-2` (default, images) or `--soul-cinematic`. CLI wait timeout defaults to 30 min. Failure causes: <5 or too-similar photos, occlusion, group photos, a non-image upload. Needs a paid Basic+ plan | Skill text | [read in docs] | What differs between variants (server-side) |
| F23 | `RD` blocks `.15557`, `.14772`, `.3036`; `docs/PLAN.md:35`, `:86` | The product page claims 3–5 min training for 25 credits from **20–80** photos. API price is $2.50 per training. An older skills-repo text said about 30 min | Research doc | [read in docs] | The photo count conflicts with F21 (5–20). We follow the skill |
| F24 | `SK/higgsfield-soul-id/SKILL.md:60-67`; `MD:295-307`, `:316-328` | Consumption: `--soul-id` (alias `--custom-reference-id`) is sent as `custom_reference_id`. Accepted by `text2image_soul_v2` and `soul_cinematic`, which allow at most **one** extra image reference. `--style_id` combines with `--soul-id` but not with `--image` | Skill and model table | [read in docs] | — |
| F25 | `SK/higgsfield-generate/SKILL.md:171`, `:214` | Marketing Studio can use a `custom` avatar, and for UGC modes "the backend can create a Soul Character automatically" from the brief | Skill text | [read in docs] | How (server-side) |
| F26 | `JS/client.ts:191-196`; `SK/higgsfield-soul-id/SKILL.md:67`; `AT/generation/catalog/models/soul.ts:24-43` | Soul styles: `GET /v1/text2image/soul-styles` (v1). The CLI equivalent is `preset list soul-v2`. In app-templates, the Soul generation models map to platform paths `higgsfield-ai/soul/v2/standard` and `higgsfield-ai/soul/cinema`. app-templates has **no Soul-training UI** | Code | [read in source] | — |

### 4c. CLI (docs and binary strings)

| ID | Coordinate | What it is | Evidence | Known via | Not verified |
|---|---|---|---|---|---|
| F27 | `CLI:586-604`, `:608-615` | Command groups: `auth`, `account`, `workspace`, `model`, `generate`, `workflow`, `preset`, `upload`, `soul-id`, `marketing-studio`, `product-photoshoot`, `website`, and others. Global flags: `--wait`, `--wait-timeout` (default 10m), `--wait-interval` (default 3s), `--json` | README tables | [read in docs] | — |
| F28 | `MD:3-7` | Media flags take a local path (auto-uploaded) or a UUID (upload id or previous job id). Snake- and kebab-case flag spellings are equivalent | MODELS.md preamble | [read in docs] | — |
| F29 | `STR:6870`, `STR:3824`, `STR:7069` | The CLI talks to **`https://fnf-api-gw.higgsfield.ai/fnf`** (the build-time default, with config locked), **not** to the public `api.higgsfield.ai` used by the SDKs | ldflags string and URL strings | [read in binary strings] | The FNF route set; whether `api.higgsfield.ai` fronts the same backend |
| F30 | `STR:3828`, `STR:3752`, `STR:3776` | Other hosts in the binary: `dev-fnf-gw.higgsfield.ai`, `dev-fnf.higgsfield.ai`, `fnf.higgsfield.ai` | URL strings | [read in binary strings] | Whether these are reachable or used. **Not probed** |
| F31 | `STR:3842`, `STR:3834`, `STR:3707`, `STR:3756`, `STR:3627`; `RD` block `.15938` | Login uses **Clerk OAuth** (`clerk.higgsfield.ai/oauth/authorize`, `/oauth/token`) with **PKCE** (`code_challenge`, `code_challenge_method`, `S256`). This contradicts the skills repo, which calls it device flow (`SK/CLAUDE.md:75`) | Strings; research doc | [read in binary strings] | The flow at runtime (not executed) |
| F32 | `STR:3717`; `SK/CLAUDE.md:75`; `CLI:660` | Tokens persist to `~/.config/higgsfield/credentials.json`. They are short-lived; `Session expired` means log in again | String plus docs | [read in binary strings], [read in docs] | File format |
| F33 | `STR:3771`, `STR:3787`, `STR:37508`, `STR:3780`, `STR:3736`, `STR:3902` | Strings `/souls`, `/souls/`, `/jobs/`, `custom_reference_id`, `soul_id`. The FNF API probably has `/souls` and `/jobs` resources, unlike the public `/v1/custom-references` | Strings | [inferred] (from strings) | Methods, bodies |
| F34 | `STR:3674`, `STR:3763`, `STR:3685`, `STR:3713`; `RD` block `.15938` | The CLI checks for coding-agent environment variables (`CLAUDECODE`, `CLAUDE_CODE`, `CODEX_SHELL`, `CODEX_THREAD_ID`) and reports errors to Sentry | Strings; research doc | [read in binary strings] | What it does with them (likely telemetry tagging; **[inferred]**) |
| F35 | `SK/CLAUDE.md:77` | `product-photoshoot create` waits internally; generate commands use `--wait` | Skill repo guide | [read in docs] | — |

### 4d. Visible behaviour of the three tools

| ID | Coordinate | What it is | Known via | Detailed in |
|---|---|---|---|---|
| F36 | `SK/higgsfield-soul-id/SKILL.md:36-56` | **Soul ID UX:** asks only for a name and photos. Polls silently. Shows no raw ids. Replies "Soul *name* ready" | [read in docs] | `docs/spec/soul.md` §2 |
| F37 | `SK/higgsfield-product-photoshoot/SKILL.md:27`, `:138-147`, `:179`, `:185`, `:189`, `:204-213` | **Product Photoshoot:** one `product-photoshoot create` command with mode, intent prompt, refs, `--count 1–10` and an optional aspect. A backend enhancer holds per-mode templates and submits to `gpt_image_2`. Variants differ in preset, lighting, angle and palette. Always 2k. Aspect whitelist of 9 values. Calling `gpt_image_2` directly is a failure | [read in docs] | `docs/spec/photoshoot.md` |
| F38 | `SK/higgsfield-marketplace-cards/SKILL.md:21-22`, `:39-62`, `:68-75`, `:88` | **Marketplace Cards:** `marketplace-cards create` with `--scope main\|product-images\|aplus\|full-set` (1 / 6 / 8 / 13 images) or explicit `--asset`s. A backend enhancer with **private** marketplace rules creates `nano_banana_2` jobs. `--main-job` reuses a finished main image. Context flags: product, brand, category, visual style. Hide JSON, ids and prompts | [read in docs] | `docs/spec/marketplace.md` |
| F39 | `MD:50-58` | `gpt_image_2` is described as generation and editing for product photos, graphic design and on-image text. Aspects include `auto`; there is a `--background transparent` option | [read in docs] | — |
| F40 | `AT/generation/credentials.ts:1-8`; `AT/generation/actions.ts:87-88`; `AT/generation/platform.ts:92-117` | app-templates studio pattern: the user's key sits in an HTTP-only cookie (30 days) and is used only in server actions. The base URL comes from `HF_API_BASE_URL`. It uses the same submit, status, cancel and upload contract as F3–F9 | [read in source] (behaviour only, no code copied) | `docs/spec/ux.md` (agent 10) |

## 5. Dynamic findings

| Hook / capture | Observation | Reproduction | Not verified |
|---|---|---|---|
| None against Higgsfield | No account or key. **No Higgsfield endpoint was called**, and no request was captured | — | Every REST claim above is static |
| Comfy Cloud (our backend, not the target) | Read endpoints return 200. `POST /api/v2/jobs` returns 403 on a free tier (`docs/spikes/klein-multiref.md:6-9`). `/api/object_info` lists core face tools: `MediaPipeFaceLandmarker`, `SAM3_Detect` (`docs/spec/soul.md` §4.2) | `GET https://cloud.comfy.org/api/object_info` | — |

## 6. Data structures recovered

```
# Public REST (api.higgsfield.ai), from SDK source (F1–F14)
Authorization: Key <key_id>:<key_secret>
POST /files/generate-upload-url        {content_type}            -> {upload_url, public_url, upload_headers?}
PUT  <upload_url>                       <bytes>                   -> 2xx; then use public_url
POST /<model/path>[?hf_webhook=<url>]   <model input JSON>        -> {request_id, status, status_url, cancel_url}
GET  /requests/{id}/status                                        -> {status: queued|in_progress|completed|failed|nsfw|canceled,
                                                                      request_id, status_url, cancel_url, images?[{url}], video?{url}}
POST /requests/{id}/cancel                                        -> queued only; 400 once started

# Soul ID (v1 paths, JS SDK; F17–F19)
POST /v1/custom-references              {name, input_images:[{type:"image_url", image_url}]} -> {id, name, status}
GET  /v1/custom-references/{id}                                   -> {id, name, status: not_ready|queued|in_progress|completed|failed}
GET  /v1/custom-references/list?page&page_size                    -> {items:[{id,name,status}], ...}
# consumption: model input field custom_reference_id = <soul id>  (F24)

# CLI private gateway (binary strings only; F29–F33): base https://fnf-api-gw.higgsfield.ai/fnf,
#   resources named /souls, /jobs; OAuth via clerk.higgsfield.ai with PKCE S256.
```

## 7. Behaviour summary

- **What the target does:** a hosted generation platform. Every tool is an asynchronous job: upload media, submit, poll or receive a webhook, then fetch URLs.
  - Soul ID trains a per-person model on the server and returns an opaque id that only Soul models accept.
  - Photoshoot and Marketplace Cards are thin CLI commands over **server-side prompt enhancers**. These choose templates, aspect defaults and variations, then call one fixed model each (`gpt_image_2`, `nano_banana_2`).
- **Inputs / outputs / side effects:**
  - Inputs: images (URL or upload id), short prompts, enumerated options.
  - Outputs: media URLs that are kept at least 7 days (F15).
  - Side effects: credits are charged per job and refunded on `failed` or `nsfw` (F6).
- **Network endpoints:** `api.higgsfield.ai` (SDKs, app-templates); `fnf-api-gw.higgsfield.ai/fnf` and `clerk.higgsfield.ai` (CLI); Sentry (CLI error reporting).

### Server-side and opaque (cannot be recovered from public artefacts)

| Opaque piece | Why it is opaque | Our replacement |
|---|---|---|
| Soul training: model family, method (LoRA, embedding, adapter…), step count, the `soul-2` vs `soul-cinematic` difference, weights | Server-side; no export route (F20) | Instant Soul: curated refs and a style card (`docs/spec/soul.md`) |
| Photoshoot enhancer: per-mode templates, default aspect per mode, variation scheme | Stated as backend-only (`SK/higgsfield-product-photoshoot/SKILL.md:27`, `:185`) | `lib/enhancer/` (`docs/spec/photoshoot.md`) |
| Marketplace rules and templates | Stated as private (`SK/higgsfield-marketplace-cards/SKILL.md:22`) | Our compliance rules (`docs/spec/marketplace.md`) |
| Webhook payload, signing, retries | Not in source (F8) | We poll (Comfy SDK) |
| FNF gateway API (routes, bodies) | Only names seen in strings (F33) | Not needed: we target the Comfy API |
| NSFW moderation, credit pricing, rate limits, submit idempotency | Server-side (F6, F10, F11) | Comfy Cloud's own; we never auto-retry submit |
| Product-page claims (3–5 min, 20–80 photos) | Marketing copy, not reproducible (F23) | — |

## 8. Open questions and next steps

- Webhook payload and secret verification (F8). Is there an official doc page? Not needed for our build.
- Is `/v1/custom-references` still live, and does v2 have a Soul route? Only checkable with an account. **Not pursued.**
- The FNF `/souls` route shapes (F33) could only come from runtime capture with the user's own account. **Out of scope** for a clean-room build.
- F23 vs F21 photo-count conflict. We follow the skill (5–20), the contract the CLI agent uses.
- Whether a retried submit (F10) can double-charge.

## 9. IOCs

Not applicable. This is not malware analysis.
