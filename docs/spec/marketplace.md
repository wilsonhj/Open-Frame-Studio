# Spec: Marketplace Cards

Status: Wave 1 spec (frozen at end of Wave 1 together with `lib/contracts/*.ts`, barrel `lib/types.ts`). Owner path: `docs/spec/marketplace.md`.

This is a behavioural, clean-room spec. It describes what Higgsfield Marketplace Cards does, as far as the public sources show, and then what **we** build on ComfyUI with open weights. No code or text comes from `higgsfield-ai/app-templates`; nothing in that repo covers marketplace cards anyway (grep for `marketplace|main_image|aplus` finds no hits).

**Source abbreviations**
- `hf-skills/` = `higgsfield-ai/skills (local clone)` (v0.13.0; MIT, `LICENSE:1-3`). The marketplace skill is identical in upstream 0.14.0 except the version line.
- `hf-cli/` = `<scratchpad>`.
- `spike/` = `./docs/spikes/cutout-upscale.md`; `proto/` = `./spikes/cutout-upscale/marketplace_main.py`.

**Labels.** Every rule is tagged:
- **[HF]**: read in a Higgsfield source, with `path:line`.
- **[HF-inferred]**: our reading of a Higgsfield source, not stated outright.
- **[OURS]**: our own design decision. Higgsfield keeps its marketplace rules and templates private (`hf-skills/higgsfield-marketplace-cards/SKILL.md:10-11,22`), so every concrete compliance threshold, size and layout below is ours.

---

## 1. What Higgsfield does (observed behaviour)

| # | Fact | Tag / source |
|---|---|---|
| H1 | Generates marketplace product images: a compliant main image, secondary product images, and A+ style content modules. | [HF] `hf-skills/higgsfield-marketplace-cards/SKILL.md:5-9` |
| H2 | Not for generic brand photography (that is Product Photoshoot), video, or Soul training. | [HF] `SKILL.md:12-14` |
| H3 | Entry point is `higgsfield marketplace-cards create [--scope main\|product-images\|aplus\|full-set] [prompt]`. | [HF] `SKILL.md:15,21,66` |
| H4 | The CLI first calls a backend enhancer that holds the marketplace rules and prompt templates privately, then creates `nano_banana_2` jobs and prints the result URLs. | [HF] `SKILL.md:10-11,22` |
| H5 | The agent must not write the final image prompts; backend enhancement owns them. | [HF] `SKILL.md:34` |
| H6 | UX: answer in the user's language; at most one confirmation question; prefer a product image, and accept text or a URL only when the product details are clear. | [HF] `SKILL.md:31-33` |
| H7 | Context flags: `--prompt`, repeated `--image <path-or-upload-id>`, `--product_context`, `--brand_context`, `--category`, `--visual_style`. | [HF] `SKILL.md:68,72-73` |
| H8 | Custom subsets use repeated `--asset <id>`. | [HF] `SKILL.md:48,74` |
| H9 | An existing completed main-image job can be reused with `--main-job <id>` together with secondary or A+ `--asset` values. | [HF] `SKILL.md:75`; `hf-skills/CLAUDE.md:156` |
| H10 | Secondary and A+ images are derived from the main image. | [HF-inferred] from H9 and from every scope including the main image (`SKILL.md:41-46`) |
| H11 | Delivery is a labelled list of URLs, with no JSON, job ids, model names or prompts unless the user asks. | [HF] `SKILL.md:79-88` |
| H12 | The generator `nano_banana_2` ("Nano Banana Pro") accepts `--aspect_ratio` in `1:1, 3:2, 2:3, 4:3, 3:4, 4:5, 5:4, 9:16, 16:9, 21:9` (default `1:1`), 0–14 image references, a required prompt, and `--resolution 1k\|2k\|4k` (default `2k`). | [HF] `hf-cli/MODELS.md:166-178` |
| H13 | So Higgsfield's cards are limited to those ratios and render text inside the diffusion model. | [HF-inferred] from H4 + H12 |

**Not visible in any source** (so we author it): the per-asset aspect ratios, pixel sizes, layouts, compliance thresholds, prompt templates and text copy.

---

## 2. Scopes

The scope table is Higgsfield's ([HF] `SKILL.md:39-46`). The ordering and the expansion rules are ours.

| Scope | Count | Assets (in output order) |
|---|---|---|
| `main` | 1 | `main_image` |
| `product-images` | 6 | `main_image`, `infographic`, `multi_angle`, `detail_shot`, `lifestyle`, `whats_in_box` |
| `aplus` | 8 | `main_image`, `aplus_hero_banner`, `aplus_pain_points`, `aplus_features`, `aplus_ingredients`, `aplus_efficacy`, `aplus_how_to_use`, `aplus_endorsement` |
| `full-set` | 13 | `main_image` + the 5 secondary + the 7 A+ assets |

Which 5 assets count as "secondary" and which 7 as "A+" is [HF-inferred]: the counts at `SKILL.md:44-46` match the five non-`aplus_` ids and the seven `aplus_` ids at `SKILL.md:50-62`.

**Expansion rules [OURS]**
- R-S1. A request carries either `scope` or a non-empty `assets[]`. If both are present, `assets[]` wins. If neither is present, the default is `scope: "main"`.
- R-S2. `main_image` is always resolved first. If `assets[]` lacks `main_image` and there is no `mainJobId`, `main_image` is added automatically. This mirrors H10.
- R-S3. When `mainJobId` is given, the stored main result (composite + RGBA cutout) is reused, and `main_image` is **not** regenerated unless it is listed explicitly.
- R-S4. Unknown asset ids → `400` with the list of valid ids. Duplicates are de-duplicated. Output order always follows the table above.

---

## 3. The 13 asset ids

The ids are Higgsfield's ([HF] `SKILL.md:50-62`). The purpose of each is our reading of the name ([OURS]).

| # | id | Group | Purpose |
|---|---|---|---|
| 1 | `main_image` | main | Compliant search and listing image: the product alone on pure white. |
| 2 | `infographic` | secondary | Product plus 3–5 benefit call-outs. |
| 3 | `multi_angle` | secondary | The same product from several viewpoints in one card. |
| 4 | `detail_shot` | secondary | A close-up of material, texture, finish or a key mechanism. |
| 5 | `lifestyle` | secondary | The product in use in a believable scene for its category. |
| 6 | `whats_in_box` | secondary | A flat-lay of everything the buyer receives, with labels. |
| 7 | `aplus_hero_banner` | A+ | Wide brand banner: the product in a styled scene, with brand and product name. |
| 8 | `aplus_pain_points` | A+ | The problems the product solves, framed as problem → solution. |
| 9 | `aplus_features` | A+ | Feature grid: product centred, 3–4 icon-and-text features. |
| 10 | `aplus_ingredients` | A+ | Key ingredients or materials, plus a specs list. |
| 11 | `aplus_efficacy` | A+ | Results and claims as stat call-outs, with a source footnote. |
| 12 | `aplus_how_to_use` | A+ | 2–4 numbered steps. |
| 13 | `aplus_endorsement` | A+ | A user-supplied quote, expert endorsement or certification. |

---

## 4. Our per-asset spec [OURS]

### 4.1 Global rendering rules [OURS]

- **G1. Text is never diffusion-generated.** All copy, numbers, icons, badges and labels are drawn in code by `lib/cards/` with bundled OFL fonts (sharp/canvas, PLAN `Architecture` → `lib/cards/`).
  - Diffusion prompts always ask for clean surfaces with empty negative space.
  - This is a deliberate departure from H13: the open 4B model cannot be trusted to spell, and code text is exact, editable and translatable.
- **G2. The product's pixels come from the main cutout whenever possible.** For each asset this spec says whether the product is:
  - **pasted**: the deterministic RGBA cutout from §6, unchanged; or
  - **regenerated**: Klein edit with the main cutout as reference image 1.
  Pasted is preferred, because it gives exact fidelity.
- **G3. Diffusion model:** FLUX.2 Klein 4B distilled (Apache-2.0), using `spikes/klein-multiref/flux2_klein_edit_multiref.api.json`.
  - The main cutout goes in `LoadImage 54`. Unused reference `LoadImage` nodes are removed.
  - Output size is set by `EmptyFlux2LatentImage 44` (multiples of 16), and the prompt goes in `4.text` (`docs/spikes/klein-multiref.md`, bindings table).
  - Distilled Klein runs at cfg 1 with a zeroed negative, so "no text" must be phrased in the positive prompt.
- **G4. Generation and export sizes.**
  - Square cards: Klein generates at 1024×1024 → SeedVR2 3B ×2 with `wavelet` colour correction → 2048² → Lanczos to 2000².
  - A+ cards: Klein generates at 1472×608 → SeedVR2 ×2 → 2944×1216 → centre crop to 2928×1200 (the master) → Lanczos to 1464×600 (the export).
  - SeedVR2 settings follow `docs/spikes/cutout-upscale.md:39-42,112`.
- **G5. Style lock across a set.**
  - One `styleBlock` is built once per run and appended to every diffusion prompt. It holds the palette from the brand colours, the lighting, the surface material and the `visual_style` preset.
  - All diffusion steps share `baseSeed`, offset by the asset index.
  - Code layers use the same brand colours and font pair.
- **G6. Output format.**
  - sRGB, RGB (no alpha).
  - JPEG at quality 95, except PNG for any card with large flat colour areas (infographic, features, efficacy).
  - Files are named `NN_<asset_id>.<ext>` (NN = order in §2).
- **G7. Copy-required assets.** These assets render **only** from text the user typed; we never invent copy for them:
  - `aplus_pain_points`, `aplus_efficacy`, `aplus_how_to_use` and `aplus_endorsement`;
  - `whats_in_box` labels.
  If a required field is empty, the tile ends in state `needs_input` (not `failed`), names the missing field, and the rest of the set continues. We never fabricate claims, statistics, reviews or certifications.
- **G8. Text fit.**
  - Each text block has a box, a maximum line count and a minimum font size: 44 px on 2000² cards; 22 px on the 1464×600 export (44 px on the master).
  - The renderer shrinks text down to that minimum. If the text still does not fit, it **fails validation**; it never truncates silently. The error names the field and gives the character budget.
- **G9. Contrast.** Every text block must reach a WCAG contrast of ≥4.5:1 against the actual pixels behind it. The check uses the 5th-percentile-worst luminance inside the box. If a block fails, the renderer adds a brand-colour scrim panel behind it and checks again.

### 4.2 Per-asset table [OURS]

"Diffusion" = what Klein generates. "Code" = what `lib/cards/` draws deterministically. Text sources refer to the form fields in §7.

| id | Aspect / export px | Diffusion | Code (deterministic) | Text blocks → source |
|---|---|---|---|---|
| `main_image` | 1:1 / **2000×2000** | none | BiRefNet cutout → optional SeedVR2 upscale → composite on #FFFFFF at 85% fill → compliance check (§5, §6) | **none, ever** |
| `infographic` | 1:1 / 2000×2000 | none by default; optional soft backdrop texture (Klein t2i, no product) | Brand-colour or gradient background; **pasted** cutout in the left ~55%; 3–5 call-outs with icon dots and optional leader lines | Headline ← `productName` (≤2 lines); call-outs ← `bullets[0..4]` (≤2 lines each) |
| `multi_angle` | 1:1 / 2000×2000 | If the user uploaded extra angles: none. Otherwise Klein edit (ref = main cutout) generates 3 views (three-quarter, side, back) on white, batch of 3 at 1024² | 2×2 grid on white or very light grey: tile 1 = **pasted** front cutout; tiles 2–4 = user angles (cut out by BiRefNet) or regenerated views | Optional small view labels ("Front", "Side", "Back", "Top"), localised; off by default |
| `detail_shot` | 1:1 / 2000×2000 | Klein edit macro close-up of a named detail (from `specs[]`, or "surface texture and finish"), ref = main cutout | Optional circular "zoom" inset showing the **pasted** product at small scale; one call-out | 1 call-out ← the chosen `specs[]` line (≤6 words); optional |
| `lifestyle` | 1:1 / 2000×2000 | Klein edit: product in use in a `category` scene with `styleBlock`; product **regenerated** from ref. Optional Soul refs (person) if the user picks a Soul | none | none |
| `whats_in_box` | 1:1 / 2000×2000 | Only when no per-item photos are given: Klein edit flat-lay of the product plus listed items, ref = main cutout | With per-item photos: BiRefNet each → **pasted** flat-lay grid on white. Always: quantity × name labels | Labels ← `boxContents[]` (`qty`, `name`); copy-required (G7) |
| `aplus_hero_banner` | ~2.44:1 / **1464×600** (master 2928×1200) | Klein edit: styled scene, product **regenerated** from ref and placed in the right ~55%, empty left ~40% | Text panel on the left; optional logo | Brand ← `brandName`; title ← `productName`; tagline ← `tagline` (optional; omitted if empty, never invented) |
| `aplus_pain_points` | 1464×600 | Klein t2i or edit: one mood image showing the problem context (no faces by default), right half | 2–3 rows "problem → solution" with icons, left half | Rows ← `painPoints[]` (`problem`, `solution`); copy-required |
| `aplus_features` | 1464×600 | none by default (optional backdrop texture) | **Pasted** cutout centred; 3–4 feature tiles around it, icons picked by keyword from a bundled icon set | Tiles ← `bullets[]` (first 4) or `features[]` if given |
| `aplus_ingredients` | 1464×600 | Klein t2i: hero arrangement of the raw ingredients or materials named in `ingredients[]` (no product, no text), left ~55% | Ingredient list, or a spec table for non-consumables, right side; **pasted** small product cutout | List ← `ingredients[]` (`name`, optional `amount`, optional `benefit`) or `specs[]` (`label`, `value`) |
| `aplus_efficacy` | 1464×600 | none | 2–4 stat call-outs (big number + label) or a simple bar chart; **pasted** product; mandatory footnote line | Stats ← `efficacyClaims[]` (`value`, `label`); footnote ← `efficacySource` (required); copy-required |
| `aplus_how_to_use` | 1464×600 | Klein edit: one panel per step (2–4) showing the action with the product (ref = main cutout), each at 704×704 → upscale; or numbered icons if diffusion is turned off | Panels laid out left to right with step numbers and captions | Captions ← `howToUse[]` (2–4 steps, ≤60 chars each); copy-required |
| `aplus_endorsement` | 1464×600 | optional soft brand backdrop (Klein t2i, no people, no text) | Quote card or certification badge **drawn in code**; **pasted** product | Quote ← `endorsement.text`; attribution ← `endorsement.by`; type ∈ `review\|expert\|certification`; requires `endorsement.rightsConfirmed = true`; copy-required |

**Why these sizes [OURS]:** square 2000² meets the ≥2000 px main-image rule (§5) and is a common zoom-friendly size for marketplace galleries. 1464×600 matches a common wide A+ module width; we also keep the 2× master. Both should be checked against current marketplace documentation before release; they are configurable in `lib/cards/sizes.ts`.

---

## 5. Main-image compliance rules [OURS]

Higgsfield calls the main image "compliant" ([HF] `SKILL.md:6`) but publishes no rules (H4). We enforce these:

| Rule | Value | How it is guaranteed or checked |
|---|---|---|
| C1. Background | pure **#FFFFFF** | Structurally: the composite canvas is `Image.new("RGB", …, (255,255,255))`. Checked: border band whiteness (A1). |
| C2. Fill | product's longest side = **85% ± 1%** of the canvas side | Structurally: scale = `0.85·size / max(bbox)`. Checked: A2. |
| C3. Centred, not cropped | product centred; never touches the edge | At 85% fill this leaves ≥150 px margin on the longest axis. Checked: A1 plus a bbox-inside-canvas assertion. |
| C4. Size | **≥2000 px** on each side (we export exactly 2000×2000) | Checked: A3. |
| C5. Real cutout | the product must have actually been cut out, not pasted as an opaque photo | Checked: A4. |
| C6. No text, badges, logos added by us, watermarks or frames | — | Structurally: the `main_image` render path has **no** text or overlay layer (unit test T-M6). Text printed on the product's own packaging is allowed. |
| C7. No props or extra items | only the product | Partly automatic: A5 warns on multiple significant alpha components. Props physically touching the product cannot be detected automatically; the UI shows a "single product only" hint at upload. |
| C8. No diffusion on the main image | the product pixels are the user's photo (cut out and optionally upscaled) | Structurally: the main pipeline is cutout → (SeedVR2 on the RGBA cutout) → code composite. SeedVR2 runs on the cutout **before** compositing, so it never touches the white pixels ([spike] `cutout-upscale.md:99`). |
| C9. Format | RGB, sRGB, no alpha | Checked: A3. |

### 5.1 Automated checks (all run on the file **as written**, so JPEG ringing counts)

These are based on `proto/marketplace_main.py:15-50` and `spike/cutout-upscale.md:75-97`, which validated them on a fixture (border 1.0, fill 0.85, transparency 0.148 → pass; an opaque photo → rejected).

| Id | Check | Pass condition | Severity |
|---|---|---|---|
| A1 | Border whiteness: share of pixels in a 20 px border band that are exactly (255,255,255) | **≥ 0.99** | fail |
| A2 | Fill: `max(product_bbox_w, product_bbox_h) / canvas_side`; bbox from alpha ≥ 8 (`alpha_floor`) | **0.84 ≤ fill ≤ 0.86** | fail |
| A3 | Canvas | `size == (2000, 2000)`, mode `RGB` | fail |
| A4 | Real transparency: share of the cutout's alpha bbox with alpha < 8 | **≥ 0.05** | fail (catches the opaque-photo negative control, `cutout-upscale.md:89-95`) |
| A5 | Extra items: connected components of alpha ≥ 8 (8-connectivity) larger than 2% of the total alpha area | exactly 1 | warn (multipacks are legitimate) |
| A6 | Source resolution: longest side of the product bbox in the cutout, before scaling | ≥ 1700 px after upscale (see §6 step 3) | fail if < 425 px at input |
| A7 | White-on-white visibility: share of product pixels with min(R,G,B) ≥ 245 | ≤ 0.6 | warn ("light product may disappear on white") |

The Playwright E2E gate in `docs/PLAN.md` ("product bbox ≥80% of frame", Verification section) is looser than A2. Because the main image is deterministic, A2's 85 ± 1% is the gate we test against; ≥80% remains the floor for the E2E run.

A failed main image **stops the run before fan-out**. The UI shows the failing check in plain words (for example "The background wasn't removed cleanly; try a photo on a plain background") and offers re-upload. It does not offer to proceed anyway.

---

## 6. Main-image pipeline and anchoring [OURS]

1. **Cutout:** `spikes/cutout-upscale/cutout.api.json`. User photo → `LoadImage 17` → BiRefNet → RGBA from `SaveImage 18` (`cutout-upscale.md:15-21,36-37`).
2. **Trim:** crop to the alpha bbox (alpha ≥ 8); compute A4 and A5.
3. **Upscale if needed:** if `bbox_long < 1700`, run `upscale.api.json` on the RGBA cutout. The multiplier is the smallest of {2, 4} that reaches ≥ 1700 (`57.resize_type.multiplier`). The model is SeedVR2 3B and `59.color_correction_method = wavelet` (`cutout-upscale.md:38-42`; PLAN update, Upscale line). If even ×4 cannot reach 1700 (input bbox < 425 px), reject with "photo too small".
4. **Composite:** in code (`lib/cards/compose.ts`, a port of `proto/marketplace_main.py:15-28`), centred at 85% on a 2000² #FFFFFF canvas, then flattened to RGB.
5. **Write, then check:** run checks A1–A7 on the written file.
6. **Persist the main result** as `{ jobId, compositeUrl, cutoutRgbaUrl, cutoutBbox, checks }`. `cutoutRgbaUrl` is the **anchor**.

**Anchoring rules**
- R-A1. Every secondary and A+ asset receives the anchor cutout (RGBA, upscaled) as its product source. Diffusion steps load it as reference image 1 (`LoadImage 54`). Code steps paste it directly. This is our version of H9/H10.
- R-A2. `mainJobId` reuse = load the persisted anchor; skip steps 1–5.
- R-A3. Per-tile regenerate (Cards board) keeps the same anchor and `styleBlock`, and changes only that asset's seed.
- R-A4. The fan-out runs in parallel after the main result. One asset failing does not block the others. No `submit()` is auto-retried (PLAN, "Known traps").

---

## 7. Input form [OURS]

The form replaces Higgsfield's free-text `--prompt` plus `--*_context` flags (H7) with structured fields, so that every text block has a known source (G7). Following H6, we ask at most one confirmation, and every optional field has a sensible default or is simply left out.

| Field | Type / limits | Required for | Maps to HF flag (H7) |
|---|---|---|---|
| `productImages` | 1–6 images. The first is the hero; the rest are extra angles or box items. Product bbox ≥ 425 px | all (a product photo is mandatory in v1; HF also allows text-only, H6) | `--image` (repeat) |
| `productName` | string, 2–80 chars | `infographic`, `aplus_hero_banner` | part of `--prompt` / `--product_context` |
| `brandName` | string ≤ 40 | optional (hero, endorsement) | `--brand_context` |
| `category` | string, with a suggestion list (beauty, beverage, food, apparel, electronics, home, pet, toys, other) | lifestyle and scene prompts | `--category` |
| `bullets` | **3–5** strings, each ≤ 90 chars | `infographic`, `aplus_features` | part of `--product_context` |
| `ingredients` / `specs` | list of `{name, amount?, benefit?}` / `{label, value}`, ≤ 10 rows | `aplus_ingredients`; `detail_shot` call-out | part of `--product_context` |
| `brandColors` | 1–3 hex colours. Default: 2 dominant non-white colours of the cutout (k-means) | style lock, every code layer | `--brand_context` |
| `visualStyle` | preset chips (`clean-clinical`, `warm-natural`, `bold-vibrant`, `premium-dark`) or free text ≤ 80 | style lock | `--visual_style` |
| `tagline` | string ≤ 60 | optional (hero) | — |
| `logo` | PNG/SVG | optional (hero, features) | — |
| `boxContents` | list of `{qty, name, imageIndex?}` | `whats_in_box` | — |
| `painPoints` | 2–3 × `{problem ≤ 50, solution ≤ 60}` | `aplus_pain_points` | — |
| `efficacyClaims` + `efficacySource` | 2–4 × `{value ≤ 8, label ≤ 40}` + footnote ≤ 120 | `aplus_efficacy` | — |
| `howToUse` | 2–4 strings ≤ 60 | `aplus_how_to_use` | — |
| `endorsement` | `{type, text ≤ 160, by ≤ 50, rightsConfirmed: bool}` | `aplus_endorsement` | — |
| `soulId` | optional Soul (for a person in `lifestyle`) | optional | — |
| `language` | BCP-47, default = UI language (H6) | copy rendering, fonts | — |
| `scope` / `assets[]` / `mainJobId` | §2 | — | `--scope` / `--asset` / `--main-job` |

---

## 8. Delivery [OURS, after H11]

- **Cards board:** a 13-tile grid in §2 order. Each tile shows a label, a state (`CardTileState` = `PipelineStepStatus | needs_input`: `queued | running | succeeded | needs_input | failed`), a per-tile regenerate button, and the main-image check badges.
- **Export:** a ZIP of all `succeeded` tiles named `NN_<asset_id>.<ext>`, plus `cards.json`. The manifest holds the inputs (without the images), seeds, `styleBlock`, check results and the anchor job id.
- **Hidden by default:** prompts, model names and job ids. They are available under an "Advanced" disclosure, mirroring H11.

---

## 9. Acceptance tests [OURS]

**Unit and mock tests (no Cloud):**
- **T-S1** scope expansion: `main`→1, `product-images`→6, `aplus`→8, `full-set`→13 assets, in §2 order.
- **T-S2** `assets: ["infographic"]` without `mainJobId` adds `main_image` first. With `mainJobId`, `main_image` is not regenerated.
- **T-S3** an unknown asset id → 400 listing the 13 valid ids.
- **T-M1** the compose + check port matches `proto/marketplace_main.py` on `spikes/cutout-upscale/out/cutout_rgba_512.png`: border_white = 1.0, fill = 0.85 ± 0.01, transparent ≥ 0.05, `ok = true`. This must hold for both JPEG and PNG output.
- **T-M2** negative control: an opaque, busy 512² photo (`out/fixture_product_busy_512.png`, un-cut) → A4 fails, `ok = false`.
- **T-M3** a cutout whose product bbox is < 425 px → rejected "photo too small". A bbox of 600 px → upscale ×4 is scheduled; 1000 px → ×2.
- **T-M4** two separated blobs, each > 2% of alpha → A5 warn; the main image is still produced.
- **T-M5** a near-white product → A7 warn.
- **T-M6** the `main_image` renderer receives `productName` and `bullets` yet produces a pixel-identical result to a call without them (proves there is no text layer).
- **T-T1** text overflow: a 200-char bullet → validation error naming `bullets[i]`, no silent truncation.
- **T-T2** contrast: white text over a white backdrop → scrim added; final contrast ≥ 4.5:1.
- **T-T3** copy-required: `full-set` with no `painPoints`, `efficacyClaims`, `howToUse` or `endorsement` → those 4 tiles are `needs_input`, the other 9 are `succeeded`, and the run status is success-with-gaps.
- **T-T4** `endorsement.rightsConfirmed = false` → `needs_input`. An `efficacyClaims` value without `efficacySource` → validation error.
- **T-A1** every diffusion graph built for a secondary or A+ asset has the anchor cutout bound to `LoadImage 54`. Every code-only asset pastes the anchor's bytes unchanged (hash of the pasted region before scaling).
- **T-A2** per-tile regenerate changes only that asset's seed; `styleBlock` and the anchor are unchanged.
- **T-G1** every exported file matches §4.2 pixel sizes, is RGB, and follows the naming in G6.

**Real Cloud (Wave 3; needs a paid key):**
- **T-E1** `full-set` on a real product photo finishes in **< 4 min** (PLAN perf target), with 13 tiles `succeeded` when all copy fields are filled.
- **T-E2** the main card passes A1–A4. The Playwright gate is border ≥ 99% #FFFFFF and bbox ≥ 80% (PLAN Verification).
- **T-E3** style lock: the dominant-palette distance between diffusion tiles in one set stays below the carousel threshold used by Photoshoot. This is logged, not gated.
- **T-E4** the graphs contain no partner or API nodes (grep `workflows/*.api.json`, PLAN "Open-weights proof").
- **T-E5** a manual review sheet for the 13 tiles: product identity is preserved on regenerated tiles, there is no stray diffusion text, and no props appear on main. Results go in `fixtures/golden/`.
