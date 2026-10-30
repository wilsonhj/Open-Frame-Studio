# UX patterns: what to learn from hosted AI studios, rebuilt on ComfyUI

Researched 2026-10-30 from public pages only (no login, no account, no paid actions). Pages were fetched with curl, and
JS-rendered pages with headless Chromium. Site text was treated as data. Evidence tags:

- *observed*: seen on the public page or in a public file at the URL or path given.
- *inferred*: our reading of how it probably works, not seen directly.

The aim is to take the **ideas** (the user problem each pattern solves) and not the product: no Higgsfield product names,
mode or preset ids, copy, pixel layouts or visual assets. Every "don't copy" note says what to change.

---

## 1. The brief (https://comfy.org/open-source-higgsfield)

The step panels on the page are rendered client-side. The requirement strings below were read from the page's own
translation bundle (`/_website/translations.*.js`, keys `eventChallenge.*`). The "Prepare" and "Submit" panels were also
read in the rendered page (*observed*).

**Goal.** "Higgsfield said they’d open source their platform. Let’s help. You have two weeks to rebuild their most
popular apps and more with ComfyUI." Inspiration: "Start with a recognizable output … Build a working app that makes it
easy for someone else to create their own."

**App requirements** (verbatim):

1. "Your work must be built with ComfyUI. Run it however you like: entirely local, Comfy Cloud, the Developer Platform, Comfy Router, the Comfy SDK, or any mix of them"
2. "Your repo must include an open-source license and enough setup detail that someone else can run it on their own machine"
3. "Any other tools, models, or techniques you want to combine with it are fair game and must be explained in your demo video"
4. "All submissions must be lawful, SFW, and must not contain unlicensed IP or likenesses"
5. "By submitting, you agree to allow ComfyUI, Runpod, LTX, Black Forest Labs, and MiniMax to feature your work with credit across our channels"
6. "One submission per person"

**Every submission must include:**

- "GitHub repo: Your app code, workflow files, an open-source license, and instructions to run it locally."
- "Demo video: Two minutes max, in case we can’t get it running ourselves."
- "A link to try it: Optional, but strongly encouraged: the deployed app or endpoint."
- "Social post: Link to your demo video on Reddit, X, IG, LI, YT, or TikTok tagging #OpenSourceHiggsfield"

**Judging and categories.** The page publishes no scoring rubric. It says: "We’re judging the work, not your video
editing or quality. The best demo shows your work in action with an explanation of how it was built."

- Best Overall ($10,000): "Every entry is automatically considered."
- Most Innovative (RTX 5090): "An app that’s never been done, novel custom node packs or uses of ComfyUI. Demo video must explain why the submission is innovative."
- Most Viral (RTX 5090): "Delightful to use and made to be shared."
- Open Weights Only (RTX 5090): "No partner nodes or closed-source APIs, open-weights models only."
- 10 runners-up: $250 in Comfy credits.

Bonus prizes:

- Built with FLUX: "FLUX 3 must be the core model in the workflow to qualify."
- Built with MiniMax H3: "MiniMax H3 must be the core model in the workflow to qualify."
- LTX: "LTX must be the core video model in the workflow to qualify."
- "Each entry is eligible for both a main category and a model-provider bonus category."

**Licensing and partner models.** "Publish your app code with an open-source license and setup instructions. You may use
partner models; only the Open Weights Only category requires open-weights models with no partner nodes or closed-source APIs."

**Deadline.** "Submission window closes: October 30 · 9am PT", which is 16:00 UTC. Winners are announced 11/6 and
"featured on comfy.org/hub with credit."

**Naming and trademarks.** The page gives no naming guidance beyond requirement 4 ("must not contain unlicensed IP or
likenesses"). We read that as covering both brand names and real people's faces in demo material (*inferred*).

### Alignment gaps with this repo (as of this research)

| Gap | Why it matters | Suggested fix |
|---|---|---|
| FLUX bonus needs **FLUX 3** as the core model, but Cloud runs FLUX.2 Klein (`docs/PLAN.md` update) | We don't qualify for the FLUX bonus unless a FLUX.3 Klein path really runs | Keep the FLUX.3 flag and run it self-hosted for at least the demo graphs, or drop the FLUX bonus from the pitch |
| H3 bonus needs H3 as **the core model**. Motion is the fourth surface | A judge may see H3 as a side feature | Make the motion clip the payoff of the demo (identity + product → clip) and give it its own `workflows/*.api.json` |
| Deliverables list "workflow files". `workflows/` holds only `image_resize_smoke.api.json` | Missing deliverable | Ship every graph in API format and add App Mode / UI-format copies people can open in ComfyUI |
| Requirement 3: other tools "must be explained in your demo video" | BiRefNet, SeedVR2, sharp text rendering and the deterministic composite are all non-ComfyUI or extra steps | Add a 15-second "how it's built" beat to the 2-minute video |
| Requirement 4: no unlicensed likenesses | The identity surface invites people to upload faces | Demo only with a consenting or synthetic face set. Add a consent checkbox at upload (pattern 7) |
| "A link to try it" | Each job bills the owner's key | `lib/access.ts` access code and rate limits already cover this. Give judges the code in the submission form |
| Social post with `#OpenSourceHiggsfield` | Required | Add it to the Wave 4 submission pack |
| Naming: the repo dir and GitHub slug are still `open-soul-studio`, and `docs/PLAN.md` still uses "Soul", "Soul ID", Higgsfield mode ids, "A+", a Higgsfield-vs-us comparison page and "13-card Amazon set" | Brand names in the product reduce originality and create trademark risk | See section 4. The README and `lib/brand.ts` are already renamed ("Open Frame Studio") |
| Plan claims "Most Viral" fit, but there is no share flow | "Made to be shared" | Pattern 15 (shareable result card with "open the graph") |

---

## 2. Starter app (https://comfy-starter.vercel.app)

*Observed.* This is not an app. It is a single static page titled "Comfy Starter Prompt" ("Codex build night · Set up
before you build"). It has a 5-step checklist and a "Copy starter prompt" button. The prompt tells a coding agent to read
the Router quickstart, queue, SDKs and models docs, then build with the Comfy SDK ≥0.4.0
(`@comfyorg/sdk` / `comfy-sdk`) and to "Do all generation through Comfy Router".

Points worth aligning with:

| Starter guidance (verbatim where quoted) | Open Frame Studio today | Action |
|---|---|---|
| "Keep the key on the server, never in browser JS." | Done (`lib/comfy.ts` is `server-only`) | none |
| `.env` wins over the shell: "dotenv.config({ override: true })" | Uses Next's `.env.local` loading | Check that a shell `COMFY_API_KEY` can't silently override `.env.local`, and document it |
| "use models.submit(), store the model ID and request ID, and poll status() and get()" | Same shape, but through the Cloud **workflow** client (`/api/v2/jobs`) because we submit our own graphs | Fine under requirement 1. Say in the README why we use workflows rather than Router models (we need custom graphs) |
| "Show queued, running and finished states. Do not invent a percentage." | `job-runner.tsx` shows `%` only when the server reports `progress` | Keep that, and never fake a bar. Show queue position when there is no progress value (pattern 12) |
| "A finished request can still carry an error_type, so surface it." | `JobErrorInfo` carries the code, node id and class type | Map the node id to a step name in the UI |
| "A 402 insufficient_credits means the workspace needs credits. Tell me that instead of retrying." | 4xx comes back as `SubmitRejectedError`, never retried | Add a plain-language 402 message ("this workspace is out of credits") |
| "A finished result is kept for 24 hours, so download any asset URLs promptly." | Outputs are re-hosted through our route | Also persist to the local library (pattern 13) so results outlive the URL |
| "walk me through one pass: generate, display the result, download it" | — | Make that the definition of done for each surface |

---

## 3. Patterns

Sources: Higgsfield public pages fetched 2026-10-30 (`/`, `/image`, `/ai/image` (redirect from `/create/image`),
`/ai-video` (from `/create/video`), `/pricing`, `/marketing-studio`, `/marketing-studio-intro`, `/ai-influencer-studio`,
`/content-factory`, `/generate`, `/character`, `/apps`, `/apps/relight`, `/upscale`), plus the local skills repo
`higgsfield-ai/skills (local clone)` (README.md and each `*/SKILL.md`). Screenshots and HTML are in the session scratchpad,
not in this repo.

### P1. One composer, settings as chips

- **Problem:** a blank prompt plus a separate settings page makes people hunt for controls, and long forms scare off new users.
- **Evidence:** *observed* on `/ai/image`. A single bottom bar holds the prompt field, then compact chips: attach, `@`
  mention, model picker, aspect ("Auto"), quality ("High"), resolution ("2K"), a count stepper ("1/4") and the generate
  button. `/marketing-studio` and `/generate` use the same composer idea with tool-specific chips.
- **On ComfyUI:** each chip is one `InputBinding` in `lib/bindings` (`choice`, `integer`, `boolean`). The composer is
  generated from the binding, so a new workflow gets a composer without new UI code. Invalid values are rejected by
  `lib/inputs.ts` before submit.
- **Don't copy:** no bottom-centred floating bar with the same chip order. Put the composer in a right-hand inspector
  panel with the canvas or gallery on the left (a ComfyUI-like split), and use our own labels and icons.

### P2. Show the cost before the click

- **Problem:** people hesitate to press a button that spends money without knowing how much.
- **Evidence:** *observed*. The generate button carries a number: "8.5" on `/ai/image`, "80" on `/generate`, "2" on
  `/apps/relight`. Pricing (`/pricing`) is in credits per month, with equivalents such as "= 135 Nano Banana Pro
  Generations". The skills repo's generate skill has a `generate cost` command (*observed*, `higgsfield-generate/SKILL.md`).
- **On ComfyUI:** on Cloud, record the credits used per workflow from completed jobs (Router returns
  `X-Comfy-Credits-Used`, per `docs/PLAN.md`; Cloud job usage is *unverified*). Show "≈ N credits, based on recent runs"
  before submit and the actual figure after. When self-hosted, show GPU-seconds instead.
- **Don't copy:** no credit currency of our own and no "= N generations" maths. Show Comfy's unit or time, and always
  label an estimate as an estimate.

### P3. "Auto" as the default for every setting, then show what Auto picked

- **Problem:** experts want control and beginners want no decisions.
- **Evidence:** *observed* on `/generate`: "Film setup Auto", "Camera Auto", "Color palette Auto", "Lighting Auto". On
  `/ai/image` the aspect is "Auto".
- **On ComfyUI:** the deterministic enhancer (`lib/enhancer/`) fills unset axes (setting, lighting, angle, palette) and
  returns the values it chose. Store them on the job and show them as chips on the result ("lighting: window, soft"), so
  one click pins a value for the next run.
- **Don't copy:** their axis names are cinema terms. Ours are product-photo axes (`VariationAxis` in `lib/types.ts`).
  The "show what Auto chose" step is our addition.

### P4. Typed reference slots

- **Problem:** "use this face and this product" is hard to express in a prompt.
- **Evidence:** *observed*. `/marketing-studio` has two labelled slots next to the prompt (a person slot and a product
  slot). `/generate` shows "References 0/50" and "Describe your scene - use @ to add characters & locations".
- **On ComfyUI:** each slot is a `LoadImage` bound into `ReferenceMultiLatent`. Slot order sets the `<ref_image_n>` /
  `<Picture n>` token, and an `@` mention inserts the token for a saved identity or product. Show a max-refs counter
  taken from the binding (Klein multi-ref has a practical limit, *unverified* on Cloud).
- **Don't copy:** use our own words ("Person", "Product", "Scene") and a tray of thumbnails in the inspector, not two big
  square tiles beside the button.

### P5. A saved identity you build once and reuse everywhere

- **Problem:** faces drift between generations, and re-uploading photos for every job is tedious.
- **Evidence:** *observed*. `/character`: "Upload photos from multiple angles to train your character. Then use the same
  consistent character across new images and videos." `/image`: "One face across every frame … locks your character's
  identity". The skills return a reusable id that other tools consume (`higgsfield-soul-id/SKILL.md`). The identity UX
  rules there are "Ask for the smallest set of inputs: name + photos" and "Polling is silent".
- **On ComfyUI:** no training, because Cloud has no `SaveLoRA` (`docs/PLAN.md` update). An identity is the 3–6 best
  BiRefNet crops plus a style card, stored as a portable file. It is ready as soon as photo QA passes, and a preview
  sheet is one Klein multi-ref job. Every other surface's Person slot (P4) lists saved identities.
- **Don't copy:** no "train", "character" or "Soul" wording. Sell what is actually different: instant, a file you own,
  no training wait.

### P6. Photo coaching at upload

- **Problem:** bad inputs (sunglasses, group shots, one angle) give bad identities, and users only learn this after waiting.
- **Evidence:** *observed* in the skills repo, `higgsfield-soul-id/references/photo-guide.md`: "Minimum 5, maximum 20.
  8–12 is the sweet spot", one person per photo, no sunglasses, varied angles and lighting, "≥ 1024×1024 ideal". How or
  whether their web UI enforces this is *unverified* (behind login).
- **On ComfyUI:** client-side checks for size and count, then a cheap server job (face detection / BiRefNet) that marks
  each photo pass, warn or reject, with a reason. A live checklist ("3 angles ✓, lighting variety ✗") fills as photos
  arrive, and the user can continue once the minimum is met.
- **Don't copy:** write our own rules and thresholds from our pipeline's needs (crops that Klein uses well), not their
  numbers.

### P7. Consent and likeness gate (our addition, required by the brief)

- **Problem:** requirement 4 forbids "unlicensed … likenesses", and identity tools invite misuse.
- **Evidence:** *observed* in the brief (section 1). Hosted studios we saw show no consent step on public pages (*observed* absence on `/character`).
- **On ComfyUI:** a required "this is me, or I have this person's permission" checkbox before the first upload. Uploaded
  faces are deleted after the job (PLAN Wave 3 privacy reviewer). Demo material uses a synthetic or consenting set only.
- **Don't copy:** n/a. This is ours.

### P8. Intent first, short labelled questions second

- **Problem:** people know what they want the picture *for*, not which mode or model gives it.
- **Evidence:** *observed* in `higgsfield-product-photoshoot/SKILL.md`: "Ask at most 4 short questions before
  submitting. Use labeled options, never open-ended", and "Skip questions whose answer is obvious from context".
  `/marketing-studio-intro` offers framing choices for one product ("closeup, faceless, full body, editorial, or UGC").
- **On ComfyUI:** our mode ids are our own (`lib/contracts/photoshoot.ts`, `PHOTOSHOOT_MODES`). Ask at most two
  chip questions ("What is it for?" → format, "What should it look like?" → style), each skippable, then build the
  graph inputs.
- **Don't copy:** none of their 10 mode ids, request types A–F, aesthetic lists or tie-breaker table. Our two-axis model
  is the original part, so keep it visible in the UI.

### P9. A gallery of looks you can apply to your own product

- **Problem:** people recognise a look they like faster than they can describe it.
- **Evidence:** *observed*. `/marketing-studio` has an "Explore templates" grid with category filters (product shot,
  motion, UGC, ads, posters, marketplace). `/marketing-studio-intro`: "See a shot you like? Make it yours. Swap in your
  product, pick the face … and hit Recreate." `/content-factory` and `/ai-influencer-studio` have "Use as reference" and
  "Recreate" on community items.
- **On ComfyUI:** a look is a JSON preset (shot style, format, axis values, prompt fragment, seed) plus an example output
  we generated ourselves. "Use this look" fills the inspector and keeps the user's Person and Product slots. Each look
  also links to its API-format graph ("Open in ComfyUI"), which ties into the hub-style sharing the brief rewards.
- **Don't copy:** no "Recreate" label, no template names, and no example images taken from their site. Generate our own
  examples with our own pipeline and demo products.

### P10. One anchor image, a consistent set derived from it

- **Problem:** a marketplace listing needs many images that look like one shoot, with a compliant first image.
- **Evidence:** *observed* in `higgsfield-marketplace-cards/SKILL.md`. Scope bundles (main only / main + secondary /
  full set) and reuse of a finished main image for later assets (`--main-job`). The skill hides its compliance rules
  ("Backend owns marketplace compliance references").
- **On ComfyUI:** already planned. The hero is a deterministic cutout and composite (no diffusion), compliance-checked in
  code. Every other slot is a Klein edit conditioned on the hero, with text rendered in code. UX: a board of tiles with
  per-tile regenerate, a compliance badge on the hero, and ZIP export.
- **Don't copy:** our slot ids (`hero`, `gallery_*`, `story_*`) and our scopes (`hero`, `gallery`, `story`, `complete`).
  Never use "A+" or a marketplace's brand in the UI. Write our own compliance rules and say in the UI which rules we check.

### P11. Hand an output straight to the next tool

- **Problem:** download-then-reupload between image and video tools loses context and time.
- **Evidence:** *observed* on `/image`: "From image to video in one click. Generate your image, then animate it … without
  leaving the editor". The skills accept an earlier job id anywhere an image is expected (*observed*, `CLAUDE.md` in the
  skills repo: flags take "a local path … OR a UUID").
- **On ComfyUI:** every `OutputRef` can be dropped into any slot, with the server re-fetching the asset by id rather than
  the browser re-uploading it. Result cards get "Use as person", "Use as product", "Animate", and the motion workflow
  gets the still by id.
- **Don't copy:** n/a beyond wording. This is a generic pipeline affordance, and ours is visibly a DAG (`PipelineStep.dependsOn`).

### P12. Honest progress, quiet waiting

- **Problem:** fake progress bars erode trust, and chatty status spam is noise.
- **Evidence:** *observed*. The skills' UX rules: "Polling is silent … Don't repeat status updates" (soul-id) and "No
  internal jargon. Don't narrate … 'polling job'" (generate). The starter: "Do not invent a percentage."
- **On ComfyUI:** show `queued` (with `queuePosition` when Cloud reports it), then `running` (with `progress.value` only
  when reported, otherwise an indeterminate state plus elapsed time), then the result. Multi-step pipelines show a step
  list ("cutout ✓ · hero ✓ · gallery 2/5"). A stuck `unknown` becomes a clear timeout message with a "check again"
  button and **no** auto-resubmit (billing trap).
- **Don't copy:** n/a.

### P13. A personal library and history

- **Problem:** results vanish when the tab closes or the signed URL expires.
- **Evidence:** *observed*. Nav and section labels "History" (`/ai-influencer-studio`), "My generations"
  (`/content-factory`) and "My elements", "My favorites", "Projects" (`/generate`). `robots.txt` disallows `/library/`
  and `/asset/`, which suggests per-user asset pages (*inferred*).
- **On ComfyUI:** without accounts, keep a per-browser library (IndexedDB) of job handles, settings and downloaded
  bytes. Saved identities and products are first-class items that the slots (P4) read from. Export and import is one
  JSON plus images, matching the portable identity file.
- **Don't copy:** no favourites, projects or community feed for v1. A local library is enough and fits "your files, your weights".

### P14. Many takes from one input

- **Problem:** the first result is rarely the one, and picking from a few is faster than re-prompting.
- **Evidence:** *observed*. The count stepper "1/4" (`/ai/image`, `/marketing-studio`). `/apps`: "Shots: 9 unique shots
  from one image", "Zooms: 9 zoom levels from one image". The photoshoot skill varies "preset, lighting, angle and
  palette" (via `docs/PLAN.md` spec).
- **On ComfyUI:** fan out N jobs with different enhancer axis values, or one graph with a batch where the seed alone
  should vary. A `series` format locks seed, palette and lighting across frames. Results appear as a contact sheet, and
  the user can star one and "more like this".
- **Don't copy:** no fixed "9 shots" or "9 zooms" products. Our count range comes from `FormatTemplate.minOutputs/maxOutputs`.

### P15. Show how it was made, and make it shareable

- **Problem:** people want to learn and remix, and "made to be shared" is a judged category.
- **Evidence:** *observed* on `/`: "Explore the inside of every project. See all prompts, assets, and how each project
  was created", over a community grid.
- **On ComfyUI:** this is where we can beat a closed studio. Every result has an "How this was made" drawer with the
  exact API-format graph, seed, enhancer output and model files (all open weights), plus "Download workflow" and a share
  card (result image plus a short recipe). Uploaded faces are never in the card.
- **Don't copy:** no community feed or creator handles. The selling point is the open graph, not social proof.

### P16. Direct manipulation for single-purpose tools

- **Problem:** some edits (light direction, crop) are faster to point at than to describe.
- **Evidence:** *observed* on `/apps/relight`: "Quick select Top / Front / Right / Left / Back / Bottom", "Hold and drag
  to change light direction", "Soft / Hard", "Brightness 50%", a colour swatch. `/apps` is a grid of one-job tools
  (expand, angles, relight, upscale, background remover).
- **On ComfyUI:** for v1, only where we already have a graph: an upscale tool (SeedVR2) and a cutout tool (BiRefNet),
  each a single workflow with its own binding. If the optional relight graph lands, a light-direction picker maps to a
  prompt or conditioning parameter.
- **Don't copy:** no apps grid of dozens of effects. Expose two or three utilities from the same graphs the main surfaces use.

### Patterns we deliberately do not adopt

These were *observed* and rejected: discount banners and "30% OFF" badges on every page, "unlimited" upsell plan
tables, view and like counts as the reason to pick a style (`/content-factory`), a full-screen cookie wall over the
composer, and model-brand-first navigation (a menu of third-party model names). They work against "open, inspectable,
yours".

---

## 4. Proposed neutral naming

`lib/brand.ts` already uses **Open Frame Studio** with Identity / Product Shoot / Listing Images / Motion, and the README
matches. This table confirms those names and suggests names for the objects inside each surface.

| Surface | Route | User-facing name | Saved object | Avoid |
|---|---|---|---|---|
| Identity / character | `/identity` | **Identity** | an **identity** ("Maya, 5 refs") with its **reference set** and **style card**; file `*.identity.json` | Soul, Soul ID, Soul 2.0, Soul Cinema, "character" as a product name, "train", `reference_id`, `custom_reference_id` |
| Product shots | `/photoshoot` (consider `/shoot`) | **Product Shoot** | a **shoot**: shot style × output format; a **look** (P9 preset) | Product Photoshoot, Marketing Studio, the 10 mode ids (`product_shot`, `lifestyle_scene`, `moodboard_pin` …), "Recreate", platform names in mode names |
| Marketplace cards | `/listing` | **Listing Images** | a **listing set**: hero, gallery, story panels | Marketplace Cards, `main_image` / `aplus_*` ids, "A+", "full-set", marketplace brand names |
| Motion | `/motion` | **Motion** (alternative: **Clips**) | a **clip** | Genjutsu, Cinema Studio, their motion preset names |
| Utilities | `/tools/*` | **Upscale**, **Cut out** | — | "Apps" as their branded grid name |

General rules:

- Higgsfield's name appears only in factual context (the challenge title, a "what inspired this" line). Never as a feature label or in ids.
- Repo slug and folder: rename `open-soul-studio` → `open-frame-studio` before submission, if the GitHub repo can be renamed (it redirects).
- Update `docs/PLAN.md` wording (Soul, Soul ID, mode ids, "Amazon set", comparison page) or mark it as historical.
- Code ids are fine as they are (`identity`, `photoshoot`, `listing`, `motion`, `PhotoshootMode`, `CardAssetId`).

---

## 5. Unverified, or couldn't access

- **Brief "App requirements" panel:** the accordion would not open in headless Chromium. The text was read from the
  page's translation bundle (same origin, `eventChallenge.requirement1..6`). It is the published copy, but we did not
  see it rendered.
- **No judging rubric** is published beyond the category descriptions and the FAQ.
- **Higgsfield logged-in flows** (identity upload, photoshoot and marketplace flows in the web app, history and library
  pages) were not studied. `/soul-id` and `/product-photoshoot` return 404. `/character` shows only a landing card.
- **Per-feature prices:** only plan-level credits (`/pricing`) and the numbers on generate buttons were seen. What those
  numbers measure is *inferred* to be credits.
- **Comfy Cloud progress granularity** (`progress.value`, `queuePosition`) and **per-job credit usage** were not
  verified live. The Wave 0 key was free tier and job submission returned 403 (`docs/spikes/klein-multiref.md`).
- **Klein multi-ref practical max references** on Cloud: not measured.
- **comfy.org/hub/apps/** (cinematic-studio, openjutsu, reshoot) pages need JavaScript and were not studied for UX.
- `/create/image` and `/create/video` redirect to `/ai/image?model=gpt_image_2` and `/ai-video`. Content may vary by
  region or A/B test (*inferred*).
