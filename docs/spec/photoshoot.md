# Spec: Product Photoshoot (Open Soul Studio)

Status: Wave 1 behavioural spec. It describes how Higgsfield Product Photoshoot behaves, as far as public sources show, and how we rebuild it on ComfyUI with open weights.

## Conventions

- **`HF`** marks a fact taken from a Higgsfield source. Every `HF` fact cites `path:line`.
- **`ours`** marks a decision we author because Higgsfield keeps it server-side (prompt templates, default aspect ratios, variation scheme). The plan lists these as ours: `docs/PLAN.md:72`.
- Source abbreviations:
  - `PS` = `higgsfield-ai/skills (local clone)/higgsfield-product-photoshoot/SKILL.md` (v0.13.0). Upstream `higgsfield-ai/skills` 0.14.0 `higgsfield-product-photoshoot/SKILL.md` matches it apart from the `version:` line (checked with `diff`), so the line numbers hold for both.
  - `EV` = `higgsfield-ai/skills (local clone)/evals/scenarios.md`
  - `MD` = `higgsfield-ai/cli` `MODELS.md` (https://github.com/higgsfield-ai/cli)
  - `CB` = `higgsfield-ai/skills (local clone)/COOKBOOK.md`
  - `HFC` = `higgsfield-ai/skills (local clone)/CLAUDE.md`
- Licence: the skills repo is MIT (`higgsfield-ai/skills (local clone)/LICENSE:1-3`). Even so, this spec paraphrases it rather than copying prose. Nothing here comes from `higgsfield-ai/app-templates`, which has no licence and contains no photoshoot code anyway (a grep for `photoshoot|moodboard_pin|product_shot` finds nothing).
- Model: FLUX.2 Klein 4B distilled is the default (`docs/PLAN.md:6`). The graph is `workflows/klein_edit_multiref.api.json` (canonical; first recorded as `spikes/klein-multiref/flux2_klein_edit_multiref.api.json`, `docs/spikes/klein-multiref.md:33`).

## 1. What the feature is

**HF behaviour**
- One command, `product-photoshoot create`, takes a mode, a short intent prompt, optional reference images, a count and an optional aspect ratio (`PS:138-147`).
- A backend prompt enhancer holds the photography vocabulary and structural template for each mode. It assembles the final prompt and submits it to `gpt_image_2` (`PS:27`, `PS:138`).
- The agent never writes the image prompt itself (`PS:45`, `PS:204`, `PS:213`). Calling `gpt_image_2` directly skips the enhancer and is graded as a failure (`EV:110`, `EV:118`).
- Only `gpt_image_2` is used; the skill never picks another image model (`PS:205`).
- `gpt_image_2` is described as high-fidelity generation and editing for product photography, graphic design and on-image text (`MD:52`).

**Ours**
- `lib/enhancer/` is a deterministic template engine that turns `(mode, interview answers, refs, i/N)` into N prompts. It is the equivalent of Higgsfield's enhancer. No LLM upsampler in v1.
- §2, §4, §5.3 and §6 are columns of one table, `MODE_TEMPLATES` (`lib/enhancer/modes.ts`); the router, chips and enhancer all read it. Canonical mode ids: `PHOTOSHOOT_MODES` in `lib/contracts/photoshoot.ts`.
- Each prompt drives one Klein edit job with references.
- The user never sees the assembled prompt in the default UI (§9).

**Scope boundaries (HF; we route accordingly)**

| Request | Goes to | Source |
|---|---|---|
| Text-to-image with no product | out of scope (generic image) | `PS:17`, `PS:207` |
| Branded avatar video | out of scope (Motion / H3 handles video in our app) | `PS:18`, `PS:206` |
| Marketplace listing cards | our Marketplace Cards module | `PS:18-19` |
| Soul training | our Soul ID module | `PS:19-20` |

## 2. Modes

The 10 mode ids come from HF (`PS:13-15`, `PS:50-61`). These are the only valid values (`PS:215`).

The default aspect ratio and default count for each mode are **ours**. Higgsfield only says that the backend picks a sensible default per mode (`PS:185`).

| Mode id | What it produces (HF) | Default aspect (ours) | Default count (ours) | Allowed count | Soul refs used? (ours) |
|---|---|---|---|---|---|
| `product_shot` | Product on a neutral, studio or catalog background (`PS:52`) | `1:1` | 1 | 1–10 | no |
| `lifestyle_scene` | Product in a real setting, with hands, action and atmosphere (`PS:53`) | `4:5` | 1 | 1–10 | optional (when the scene includes a person) |
| `closeup_product_with_person` | Tight crop with hands or part of a face: beauty application, holding, demonstrating (`PS:54`) | `4:5` | 1 | 1–10 | optional (strongly recommended) |
| `moodboard_pin` | Vertical Pinterest-native image with a moodboard feel; HF states 2:3 (`PS:55`) | `2:3` (HF) | 1 | 1–10 | optional |
| `hero_banner` | Wide header for a website, email or campaign (`PS:56`) | `16:9` (HF eval expects 16:9 or wider, `EV:131`; 16:9 is the widest ratio allowed, `PS:185`) | 1 | 1–10 | optional |
| `social_carousel` | 3–10 connected slides for IG, LinkedIn or Facebook (`PS:57`) | `4:5` | 5 | **3–10** (`PS:57`) | optional |
| `ad_creative_pack` | Coordinated pack of static ad variants for Meta, TikTok, Pinterest or Google Ads (`PS:58`) | `4:5` | 4 | 2–10 (min of 2 is ours) | optional |
| `virtual_model_tryout` | Product worn or used by an AI-rendered model (`PS:59`) | `3:4` | 1 | 1–10 | **yes when a Soul is selected**; otherwise an archetype text model |
| `conceptual_product` | Surreal, CGI-style, levitating, splash or sculptural product (`PS:60`) | `1:1` | 1 | 1–10 | no |
| `restyle` | Changes the aesthetic, mood or season of an existing image (`PS:61`) | **match source** (snap to the nearest allowed ratio) | 1 | 1–10 | no (the source image already shows the subject) |

**Platform → aspect ratio (ours).** When the interview asks "Where will you use them?" (`PS:92`, `PS:108`), the answer sets the aspect ratio, unless the mode's own format decides it (`moodboard_pin`, `hero_banner`):

| Platform chip | Aspect |
|---|---|
| Shopify | `1:1` |
| Instagram | `4:5` |
| Pinterest | `2:3` |
| Paid ads | `4:5` |
| Website hero | `16:9` |

A mention of "story", "reel" or "TikTok" sets `9:16` (ours).

## 3. Size, aspect and resolution

**HF**
- The aspect ratio is overridden only when the user explicitly asks for it (`PS:185`).
- The whitelist is `1:1, 4:5, 5:4, 3:4, 4:3, 2:3, 3:2, 9:16, 16:9` (`PS:185`).
- Every job runs at `2k` (`PS:189`). On `gpt_image_2`, `2k` is also the default resolution, `high` is the default quality, and the model can output a transparent background (`MD:56-61`).
- `gpt_image_2` itself also accepts `21:9` and `auto` (`MD:56`), but the photoshoot whitelist excludes them.

**Ours: aspect handling**
- Requests outside the whitelist snap to the nearest allowed ratio, and the user gets a one-line notice. For example, `21:9` or "ultrawide" becomes `16:9`.
- For `restyle`, the source image's ratio snaps to the nearest whitelisted ratio.

**Ours: render sizes.** Klein renders at about 1 MP, and every side is a multiple of 16 (spike binding `44.width/height`, which must equal `71.width/height`: `docs/spikes/klein-multiref.md:67`, `docs/spikes/klein-multiref.md:80`). The optional SeedVR2 pass then brings the long edge to 2048, our equivalent of "2k". It uses `wavelet` colour correction (`docs/PLAN.md:9`).

| Aspect | Klein base (W×H) | 2k delivery (W×H) |
|---|---|---|
| 1:1 | 1024×1024 | 2048×2048 |
| 4:5 | 896×1120 | 1632×2048 |
| 5:4 | 1120×896 | 2048×1632 |
| 3:4 | 864×1152 | 1536×2048 |
| 4:3 | 1152×864 | 2048×1536 |
| 2:3 | 832×1248 | 1360×2048 |
| 3:2 | 1248×832 | 2048×1360 |
| 9:16 | 720×1280 | 1152×2048 |
| 16:9 | 1280×720 | 2048×1152 |

- The "Fast" preview skips the upscale and delivers the base size. "Final" upscales. Final is the default whenever `count ≤ 4`, to save credits (ours).
- **Transparent background (ours).** A `product_shot` request for "transparent" or "PNG cutout" runs the BiRefNet cutout graph on the result. This mirrors `gpt_image_2 --background transparent` (`MD:57`). The cutout graph is `spikes/cutout-upscale/cutout.api.json`.

## 4. Routing: request → mode

### 4.1 Keyword and intent rules (HF)

HF says to pick the mode by intent, not by surface keyword, and to prefer the more specific mode when two could apply (`PS:65`). The cue lists below are HF's (`PS:67-76`). We extend them with synonyms, marked *ours*.

| Mode | HF cues | Extra cues (ours) |
|---|---|---|
| `product_shot` | product + neutral / clean / white / studio / catalog / Shopify (`PS:67`) | packshot, plain background, e-com, transparent PNG |
| `lifestyle_scene` | product + scene / in use / kitchen / outdoor / cafe / gym (`PS:68`) | bathroom, desk, beach, picnic, "in context", "real life" |
| `closeup_product_with_person` | hands holding, face with product, beauty application, demonstrating (`PS:69`) | swatch, applying, texture on skin, "in hand" |
| `moodboard_pin` | Pinterest, pin, vertical pin (`PS:70`) | moodboard, aesthetic board |
| `hero_banner` | hero, banner, website header, landing page, email header, wide format (`PS:71`) | homepage header, cover image, billboard-wide |
| `social_carousel` | carousel, slide post, multi-slide, swipeable (`PS:72`) | "N slides", swipe post |
| `ad_creative_pack` | ads, ad pack, paid social, Meta / TikTok / Pinterest ads (`PS:73`) | ad set, creatives, A/B variants, campaign statics |
| `virtual_model_tryout` | model wearing, virtual try-on, on body, fashion shoot, lookbook (`PS:74`) | "on me" (when a Soul is selected), worn by |
| `conceptual_product` | levitating, floating, splash, frozen motion, surreal, CGI, sculptural (`PS:75`) | exploding ingredients, zero gravity, 3D render look |
| `restyle` | change an EXISTING image's aesthetic, mood or season without changing the subject (`PS:76`) | "redo", "different version", "make this Christmassy" with an uploaded finished shot |

### 4.2 Tie-breakers (HF)

| Request | Winner | Reason | Source |
|---|---|---|---|
| "Pinterest pin of my product on a kitchen counter" | `moodboard_pin` | the platform decides | `PS:79` |
| "Hero banner showing my product in use" | `hero_banner` | the banner format wins | `PS:80` |
| "Carousel of my product in different scenes" | `social_carousel` | multi-slide wins | `PS:81` |
| "Closeup of person applying my serum" | `closeup_product_with_person` | the specific genre wins | `PS:82` |
| "Hero banner … my serum being applied" | `hero_banner` (and `closeup_product_with_person` counts only as Partial) | the banner format beats the closeup genre | `EV:126-137` |

### 4.3 Resolution order (ours, derived from 4.2)

The tie-breakers say that **output format beats content genre, and content genre beats setting**. We turn that into a fixed priority. The router scores every mode's cues and picks the highest-priority mode that matches:

1. `restyle`: requires an uploaded image that is already a finished shot, plus change-vibe intent (`PS:76`, `PS:110`). Without an uploaded image, restyle cues ("Christmas version") become a seasonal modifier on another mode.
2. `social_carousel`: multi-slide format (`PS:81`).
3. `ad_creative_pack`: pack format. "Pinterest **ads**" lands here, because `PS:73` lists Pinterest ads as an ad cue. "Carousel ad" goes to `social_carousel` (2 outranks 3).
4. `moodboard_pin`: platform format (`PS:79`).
5. `hero_banner`: banner format (`PS:80`, `EV:130`).
6. `virtual_model_tryout`: the product is worn. "Closeup of a model wearing my earrings" becomes `virtual_model_tryout` with the framing chip `Closeup on product area` (`PS:124`).
7. `closeup_product_with_person`: specific genre (`PS:82`).
8. `conceptual_product`: specific genre. "Splash shot in a kitchen" lands here, not in lifestyle.
9. `lifestyle_scene`: setting.
10. `product_shot`: neutral catalog. Also the fallback when a product image is present but no cue matches **and** the user skips the style question.

Further rules (ours):
- **Two formats at once** (for example "hero banner and a pin"). Do not merge them. Offer chips `[hero_banner / moodboard_pin / Both (2 jobs)]`.
- **No product and no topic.** Treat it as Type F (§5). Never generate blind (`EV:194`, `EV:200`).
- **Marketplace intent** ("Amazon listing", "main image", "A+"). Hand off to Marketplace Cards (`PS:18-19`).
- **The mode can be set explicitly.** The UI mode rail, or `mode=` in the API, overrides the router. This is the same idea as `--mode` (`PS:142`).

## 5. Pre-generation interview

### 5.1 HF rules
- Ask at most 4 short questions, all with labelled options and never open-ended (`PS:43`, `PS:86`, `PS:211`).
- Skip any question whose answer is clear from context: an uploaded image, an earlier turn, or brand memory (`PS:44`, `PS:86`).
- Reply in the user's language, but keep mode names and flags in English (`PS:42`).

**Ours**
- The interview is a single chip sheet over the prompt dock. All questions appear at once (at most 4), each as a row of chips, and every row has a skip default.
- Free text is allowed only where HF asks for a description (Type C Q2, Type F Q1).
- A **"Just generate"** button accepts all defaults.

### 5.2 Request type classifier (ours, from the HF type definitions)

Evaluated in order:

| Order | Type | Condition | HF definition |
|---|---|---|---|
| 1 | D | An uploaded image is a finished scene, not a bare product photo, **and** the request says redo, change vibe, different version or a season | `PS:110` |
| 2 | E | A wearable product (apparel, jewellery, eyewear, bag, shoes) **and** wearing / model / try-on intent | `PS:118` |
| 3 | B | A product image is uploaded **and** a use case is named (ads, pin, hero banner, carousel …) | `PS:95-97` |
| 4 | A | A product image is uploaded, with a generic "make images / photoshoot" request | `PS:88` |
| 5 | C | Text only, but a product is named or described | `PS:103` |
| 6 | F | Vague, with no clear subject ("something cool for my brand") | `PS:126-128` |

When the user has given a product photo before, it counts as uploaded (Soul and brand memory: `PS:44`). After Type F, the flow re-enters the matching type A–E (`PS:134`).

### 5.3 Trees

The question wording and HF chip sets are paraphrased from `PS`. Chip → parameter mappings are ours.

**Type A: product photo uploaded, generic request (`PS:88-93`). Mode is decided by Q2 and Q3.**

| # | Question | Chips | Maps to (ours) |
|---|---|---|---|
| 1 | How many? (`PS:90`) | `1` · `3` · `5` | `count` |
| 2 | Style or mood? (`PS:91`) | `Clean studio` · `Lifestyle` · `Conceptual` · `With a model` · `Other` | `product_shot` · `lifestyle_scene` · `conceptual_product` · `virtual_model_tryout` for wearables, else `closeup_product_with_person` · Other opens a short text field |
| 3 | Where will you use them? (`PS:92`) | `Shopify` · `Instagram` · `Pinterest` · `Paid ads` · `Website hero` | aspect (§2). `Pinterest` → `moodboard_pin`; `Paid ads` → `ad_creative_pack`; `Website hero` → `hero_banner`. These format modes outrank the Q2 mode, and the Q2 choice becomes a style modifier (§4.3). |
| 4 | Match brand colours? (`PS:93`; skip when obvious) | `Use colours from my product` · `Use my brand palette` (when one is stored) · `No preference` | palette lock for the variation engine |

**Type B: product photo plus a named use case (`PS:95-101`). The mode is already clear, so ask only about the gaps.**

| # | Question | Chips (ours; HF gives the questions only) | Maps to |
|---|---|---|---|
| 1 | How many? Ask only for multi-output modes (`PS:99`) | carousel: `3` · `5` · `7` · `10`; ad pack: `3` · `4` · `6`; others: `1` · `3` · `5` | `count` |
| 2 | Offer, mood or hook? (`PS:100`) | `Launch / new` · `Sale / offer` · `Seasonal` · `Everyday aesthetic` · `Premium / luxury` | enhancer "hook" slot |
| 3 | Anything to emphasise? (`PS:101`) | `Packaging` · `Texture / material` · `Product in use` · `Scale / size` · `Nothing specific` | enhancer "emphasis" slot |

**Type C: text only, no product photo (`PS:103-108`).**

| # | Question | Chips | Notes |
|---|---|---|---|
| 1 | Can you upload a product photo? (`PS:105`; HF calls it "much higher fidelity") | `Upload photo` · `Describe instead` | Choosing upload switches to type A or B |
| 2 | Describe the product: category, packaging, colour, distinctive features (`PS:106`) | free text, with placeholder chips for the category (`Beauty`, `Food & drink`, `Apparel`, `Home`, `Tech`, `Other`) | Klein then runs **without** a product ref, as text-to-image (ours) |
| 3 | Style? Same chips as Type A Q2 (`PS:107`) | as A·Q2 | sets the mode |
| 4 | Where will you use it? (`PS:108`) | as A·Q3 | aspect or format mode |

**Type D: existing image, redo / change vibe (`PS:110-116`). Mode → `restyle`.**

| # | Question | Chips | Maps to |
|---|---|---|---|
| 1 | Which aesthetic? (`PS:114`) | `Clean girl` · `Cottagecore` · `Quiet luxury` · `Dark academia` · `Y2K` · `Other` | style preset |
| 2 | Seasonal context? (`PS:115`) | `Christmas` · `Valentine's` · `Halloween` · `Black Friday` · `None` | season overlay (props, palette) |
| 3 | What to keep and what to change? Ask only when it is unclear (`PS:116`) | `Keep product & framing, change mood` · `Keep product, new background` · `Recolour / relight only` (ours) | edit strength and prompt clauses |

**Type E: model wearing the product (`PS:118-124`). Mode → `virtual_model_tryout`.**

| # | Question | Chips | Maps to |
|---|---|---|---|
| 1 | Model archetype? HF suggests 2–3 picks based on the brand audience (`PS:122`) | ours: the first chip is `My Soul: <name>` when any Soul exists. The rest are 2–3 audience-derived archetypes (e.g. `Young urban creative`, `Mature elegant`, `Athletic`). | Soul refs, or an archetype text block |
| 2 | Environment? (`PS:123`) | `Studio clean` · `Outdoor natural` · `Street style` · `Editorial` · `Home cozy` | scene preset |
| 3 | Framing? (`PS:124`) | `Full body` · `Three-quarter` · `Waist up` · `Closeup on product area` | camera/framing slot. Also sets the aspect: full body → `3:4` (or `2:3`); waist up → `4:5`; closeup → `4:5` (ours) |

**Type F: vague request (`PS:126-134`).**

| # | Question | Chips | Then |
|---|---|---|---|
| 1 | Which product or topic? (`PS:130`) | free text, or `Upload product photo` | |
| 2 | What is the goal? (`PS:131`) | `Sell on a marketplace` · `Build awareness` · `Run paid ads` · `Update website` | marketplace → Marketplace Cards; awareness → Type A (`lifestyle_scene` preselected); paid ads → Type B `ad_creative_pack`; website → Type B `hero_banner` (all ours) |
| 3 | Upload a reference image? (`PS:132`) | `Upload` · `Skip` | the reference becomes a style ref (§7) |

The HF eval expects 2–3 structured questions and nothing submitted before the answers (`EV:192-200`).

## 6. Multi-output variation and style lock

### 6.1 HF
- With count N, the result is N distinct images. The enhancer varies **preset, lighting, angle and palette**, so the variants are not reworded copies of one prompt (`PS:179`). The cookbook repeats this (`CB:44`) and prefers one `--count 5` job over 5 single runs (`CB:62`).
- For `social_carousel` and `ad_creative_pack`, the count is the number of slides or variants, and the backend **locks the visual system across all slides** (`PS:181`).

### 6.2 Free-variation modes (ours)
These are all modes except `social_carousel` and `ad_creative_pack`.

- Each mode template defines four pools:
  - `presets`: set or scene. For example, `lifestyle_scene` has kitchen counter, café table, bathroom shelf, outdoor picnic, desk.
  - `lighting`: soft window, golden hour, hard flash, overcast diffuse, studio softbox, rim-lit.
  - `angles`: eye-level, 45° three-quarter, top-down flat lay, low hero, macro.
  - `palettes`: product-derived, neutral warm, cool minimal, brand palette, seasonal.
- Variant `i` (0-based) of N uses:
  - `preset[(i) mod P]`
  - `lighting[(i·a + o₁) mod L]`
  - `angle[(i·b + o₂) mod A]`
  - `palette[(i·c + o₃) mod C]`

  The strides `a, b, c` are chosen co-prime with the pool sizes. The offsets `o` come from a hash of the job seed. As a result, any two variants differ on **at least 2 of the 4 axes**, and when N ≤ min(P, L, A) they differ on all of them.
- An axis the user pinned (for example the `Pinterest` palette, the `Studio clean` environment, or Q4 brand colours) is held fixed, and the remaining axes rotate.
- Seeds: `seed_i = base_seed + i`.
- `product_shot` restricts the preset pool to neutral backdrops (white, light grey, beige sweep, pastel seamless).
- `restyle` varies only lighting and palette inside the chosen aesthetic. The composition is kept.

### 6.3 Style-locked modes (ours): `social_carousel`, `ad_creative_pack`
- **Locked across all N:** palette, lighting recipe, colour grade, set family (one preset), the base seed, and a shared "visual system" suffix. All slides use the same aspect ratio.
- **Varies per slide:** angle/framing and a **slide role**.
  - Carousel roles in order:
    1. `cover/hook`: product hero, with space left for a title
    2. `detail`: macro or texture
    3. `in use`
    4. `feature/benefit`
    5. `lifestyle context`
    6. `closing/CTA shot`

    For N < 6, the roles are taken in this order, but the closing shot is always last. For N > 6, the middle roles repeat with new angles.
  - Ad pack variant roles cycle: `benefit hero`, `problem→solution`, `offer/price-led layout`, `social-proof scene`, `seasonal/urgency`, `minimal product`. Every ad variant leaves a negative-space region for copy.
- No text is rendered inside the diffusion image. Headlines and CTAs are out of scope for this module. The `lib/cards` text renderer may add them later.
- Implementation: one shared style block is prepended to every prompt. Every slide uses the same `base_seed`, and only the slide-role clause changes.
- Acceptance: a palette check on the outputs. The mean ΔE between the dominant-colour palettes of slides is ≤ 12, and it is ≥ 20 for free-variation modes at the same N. This threshold is ours and needs tuning in Wave 3.

## 7. References: product cutout, Soul and extra refs

**HF**
- Image inputs are local paths or upload ids, and the flag can repeat for several references (`PS:144`, `PS:175`).
- `gpt_image_2` takes repeated `--image-references` (`MD:58`).
- Higgsfield's photoshoot "does not chain"; it owns its pipeline (`HFC:155`). To keep a face consistent, the cookbook suggests switching to Soul models instead of `gpt_image_2` (`CB:64`).

**Ours: deliberate extension.** A Soul can feed straight into Photoshoot. This is the headline feature (`docs/PLAN.md:31`). A Soul is a curated set of 3–6 reference crops plus a style card, stored as `soul.json` (`docs/PLAN.md:7`).

The Klein multi-ref graph has slots for 3 face refs and 1 product ref, and more can be added (`docs/spikes/klein-multiref.md:47`, `docs/spikes/klein-multiref.md:64-73`). FLUX.2 prompts refer to references as "image 1…4" in plain words (`docs/spikes/klein-multiref.md:83`).

**Reference slot order (ours):**

| Slot | Content | When | Spike node |
|---|---|---|---|
| image 1 | **Product cutout**: BiRefNet RGBA composited on mid-grey (`cutout.api.json`, `docs/spikes/cutout-upscale.md:15-17`) | every mode except `restyle` and text-only Type C | `62.image` |
| image 2–4 | **Soul refs**: the top-k crops from `soul.json`, ranked by QA score. k = 3 for `virtual_model_tryout` and `closeup_product_with_person`; k = 2 for other modes that include a person | when a Soul is selected and the mode allows people (§2 column) | `54`, `60`, `61` |
| last | **Style/scene ref**: the user's moodboard image (Type F Q3, or "like this") | optional, at most 1 | added `LoadImage` (ours) |
| image 1 (restyle) | **Source image**, used as is (no cutout) | `restyle` only | `62.image`, or `54.image` |

Rules (ours):
- **Product fidelity first.** The product ref always sits in slot 1. The prompt says "the product from image 1, unchanged: same shape, label, colour".
- **Identity.** The prompt says "the person from images 2–4". The Soul's style card (skin tone, hair and similar notes) is appended as text.
- **Soul in a mode without people** (`product_shot`, `conceptual_product`). Ignore the Soul, and show a dismissible hint suggesting `lifestyle_scene` or `virtual_model_tryout` instead.
- **Cap.** At most 5 reference images per job (a cost and VRAM guard). Reference resize is `17.resolution.megapixels = 1.0` (`docs/spikes/klein-multiref.md:69`).
- **Cutout source.** The cutout is computed once per uploaded product and cached by content hash. The raw photo is never used as a ref when a cutout exists. If the cutout fails, the raw photo is used and a warning is logged.

## 8. Generation pipeline (ours)

1. Route (§4) and interview (§5).
2. Resolve `count` (clamp to the mode's range and say so, e.g. "Carousels need at least 3 slides, so I made 3") and `aspect` (§2–3).
3. Cutout the product, if not cached.
4. The enhancer builds N prompts (§6).
5. Submit N Klein edit jobs (FLUX.2 Klein 4B distilled, 4 steps per the spike runbook, `docs/spikes/klein-multiref.md:90`).
6. Optionally upscale with SeedVR2.
7. Re-host the outputs.

Our API mirrors the HF command shape: `{mode, prompt, images[], count, aspect_ratio}` (`PS:141-147`). `prompt` is the user's short intent, never the assembled prompt (`PS:143`).

## 9. Output and UX

**HF**
- Reply concisely and list only the image URLs (`PS:41`, `PS:193`).
- No JSON, ids, internal model names or enhanced prompt text (`PS:193`, `PS:214`).
- Report failed jobs briefly, with their status (`PS:193`).
- Polling is silent: deliver when ready (`PS:46`).
- The example delivery is a header line like "3 lifestyle shots ready:" followed by a bullet list (`PS:196-199`).
- The eval expects 1 URL, or a short list when the count is above 1 (`EV:112`).

**Ours**
- Results appear as a gallery grid with a one-line header ("N <mode label> ready"), in the user's language.
- A progress bar is shown, with no step-by-step chatter.
- Failed items appear as greyed tiles with "Failed — retry". A retry submits a new job with a new seed; submits are never retried automatically (`docs/PLAN.md:135`).
- The assembled prompt sits behind a "Details" disclosure for open-source transparency. It is collapsed by default and never shown inline.

## 10. Acceptance tests

`Src` marks where each case comes from:
- **EV**: a Higgsfield eval scenario
- **PS**: a skill example or tie-breaker
- **CB**: the cookbook
- **ours**: derived from our rules

Expected aspect and count use our defaults unless HF fixes them. "Qs" is the maximum number of interview questions the test allows.

| # | Input request (attachments) | Type | Expected mode | Aspect | Count | Qs | Src |
|---|---|---|---|---|---|---|---|
| 1 | "Make a Pinterest pin of my candle. Cottagecore mood." (candle.jpg) | B | `moodboard_pin`; NOT `lifestyle_scene` or `product_shot` | 2:3 | 1 (more only if the user picks a higher count) | ≤4 (count, mood, emphasis) | `EV:103-118` |
| 2 | "Hero banner for my landing page showing my serum being applied." | B (C if no photo) | `hero_banner`; `closeup_product_with_person` = Partial | 16:9 | 1 | Type-A interview skipped | `EV:126-137` |
| 3 | "Make me something cool for my brand." | F | none until answered; never submits | n/a | n/a | 2–3 labelled | `EV:188-200` |
| 4 | "Pinterest pin of my product on a kitchen counter" (photo) | B | `moodboard_pin` | 2:3 | 1 | ≤3 | `PS:79` |
| 5 | "Hero banner showing my product in use" (photo) | B | `hero_banner` | 16:9 | 1 | ≤3 | `PS:80` |
| 6 | "Carousel of my product in different scenes" (photo) | B | `social_carousel`, style-locked | 4:5 | 5 (asks Q1 with chips 3/5/7/10) | ≤3 | `PS:81`, `PS:181` |
| 7 | "Closeup of person applying my serum" (photo) | B | `closeup_product_with_person` | 4:5 | 1 | ≤3 | `PS:82` |
| 8 | "bottle of cold-brew on a sunlit kitchen counter, IG feed", count 3 (bottle.jpg) | B | `lifestyle_scene` | 4:5 (IG) | 3, varied on ≥2 axes | 0–2 | `PS:152-156`, `PS:179` |
| 9 | "vertical pin for my candle brand, cottagecore mood" (candle.jpg) | B | `moodboard_pin` | 2:3 | 1 | 0–1 | `PS:160-163` |
| 10 | "Christmas version, quiet-luxury aesthetic" (existing-shot.jpg) | D | `restyle` (aesthetic chip Quiet luxury and season Christmas prefilled, so no questions) | source ratio, snapped | 1 | 0 | `PS:167-170`, `PS:114-115` |
| 11 | "founder using product in 5 IG-feed scenes: coffee setup, desk, café, gym, home office" (bottle.jpg + Soul "founder") | B | `lifestyle_scene`, Soul refs k=2 | 4:5 | 5 (the five named scenes fill the preset pool) | 0 | `CB:36-44` |
| 12 | "Make photos of my product" (mug.jpg) | A | decided by chips; "Just generate" → `product_shot` | 1:1 | 1 | ≤4 | `PS:88-93`, ours |
| 13 | Type A answers: Lifestyle + Pinterest (mug.jpg) | A | `moodboard_pin` (the format wins over the style chip) | 2:3 | per Q1 | done | `PS:79`, ours |
| 14 | "Make 4 Meta ads for my sneakers" (photo) | B | `ad_creative_pack`, style-locked | 4:5 | 4 | ≤2 | `PS:73`, `PS:181` |
| 15 | "Pinterest ads for my candle" (photo) | B | `ad_creative_pack` (pack outranks pin) | 4:5, or 2:3 when "Pinterest" is pinned as the platform | 4 | ≤2 | `PS:73`, ours §4.3 |
| 16 | "Model wearing my earrings, closeup" (photo) | E | `virtual_model_tryout`, framing `Closeup on product area` | 4:5 | 1 | ≤2 | `PS:74`, `PS:124` |
| 17 | "Put my jacket on me" (photo + Soul selected) | E | `virtual_model_tryout`, Soul refs k=3, archetype question skipped | 3:4 | 1 | ≤2 | ours §7 |
| 18 | "Perfume bottle levitating with a water splash" (photo) | B | `conceptual_product` | 1:1 | 1 | ≤3 | `PS:75` |
| 19 | "Clean white catalog shot for Shopify" (photo) | B | `product_shot` | 1:1 | 1 | ≤2 | `PS:67` |
| 20 | "2-slide carousel" (photo) | B | `social_carousel` | 4:5 | clamped to 3, with a notice | ≤2 | `PS:57`, ours |
| 21 | "Hero banner, 21:9" (photo) | B | `hero_banner` | 16:9 (snapped, with a notice) | 1 | ≤2 | `PS:185`, ours |
| 22 | "Christmas version of my product" (bare product photo, not a finished shot) | B | `lifestyle_scene` with a Christmas season modifier, not `restyle` | 4:5 | 1 | ≤3 | `PS:76`, ours §4.3 |
| 23 | "Main image for my Amazon listing" (photo) | n/a | hand off to Marketplace Cards | n/a | n/a | 0 | `PS:18-19` |
| 24 | "A product photo of a matte-black water bottle" (no photo) | C | asks to upload first; if declined, text-to-image `product_shot` | 1:1 | 1 | ≤4 | `PS:103-108` |
| 25 | Russian: "Сделай пин для Pinterest с моей свечой" (photo) | B | `moodboard_pin`; UI text in Russian, mode id in English | 2:3 | 1 | ≤3 | `PS:42` |

**Checks that apply to every case**
- Never more than 4 questions (`PS:211`).
- The mode is always one of the 10 ids (`PS:215`).
- The assembled prompt is never shown in the reply (`PS:214`).
- Free-variation outputs differ pairwise on at least 2 of the 4 variation axes.
- Style-locked packs pass the palette-consistency check (§6.3).
- Cases with a Soul (#11, #17 and the person modes) must pass the identity gate (`docs/eval/identity.md`).
