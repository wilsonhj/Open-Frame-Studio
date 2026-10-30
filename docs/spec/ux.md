# Spec: Studio UX (Open Frame Studio)

Status: Wave 1 UX spec, text only (`docs/PLAN.md:169`). The Wave 2 frontend team builds from it (`docs/PLAN.md:179`). It follows the Wave 0 update: FLUX.2 Klein 4B distilled is the default model, and an identity is Instant only. An identity is a curated set of 3–6 reference crops plus a style card, saved as a portable `identity.json` with its images. There is no trained LoRA, no "train" toggle and no training progress bar (`docs/PLAN.md:5-7`).

## 0. Conventions and clean-room note

- **Source abbreviations**
  - `AT` = the public repo `higgsfield-ai/app-templates` (https://github.com/higgsfield-ai/app-templates). This repo has no licence. We read only its two layout notes (`AT/layouts/AGENTS.md`, `AT/components/studio/AGENTS.md`) to learn how Higgsfield's studio behaves. No code, class names, copy or tokens come from it. Where this spec deliberately differs from that layout, it says so (§1.2).
  - `HS` = `higgsfield-ai/skills (local clone)` (v0.13.0, MIT, `HS/LICENSE:1-3`). Even so, we paraphrase it and do not quote it.
  - `API` = `docs/spec/api.md`, `PS-SPEC` = `docs/spec/photoshoot.md`, `MC-SPEC` = `docs/spec/listing.md`, `T` = `lib/types.ts` (a barrel over `lib/contracts/*.ts`; line citations point into those files).
- **Tags.** **[HF]** marks behaviour observed in a Higgsfield source, with a `path:line`. **[OURS]** marks our own design decision. Untagged text is [OURS].
- **Wireframes** are low-fi ASCII. They show structure and priority, not pixels. `[ ]` is a button, `( )` a chip, `▢` an image slot, `▶` a video and `…` truncation.

---

## 1. Design intent

### 1.1 The idea: a darkroom contact sheet

The studio feels like a photographer's light table, not a neon sci-fi console. Every result lands on a **contact sheet**: a fixed grid of numbered frames, each with a mono caption strip (frame number, tool, seed, variation). The one accent colour is **safelight**, a warm red-orange. It marks the primary action and anything live. The default theme is light ("paper"). Dark ("darkroom") is a first-class alternative, not the only mode.

### 1.2 How this differs from Higgsfield's studio (deliberate)

| Higgsfield studio (observed) | Open Frame Studio [OURS] |
|---|---|
| Dark only; a lime accent reserved for the generate CTA (`AT/components/studio/AGENTS.md:34-35`) | Light "paper" by default, with a "darkroom" theme; a safelight red-orange accent; identity identity uses a second hue, verdigris |
| Hero with a radial glow and a masked dot field behind three recent outputs (`AT/layouts/AGENTS.md:8-11`) | No glow and no dots. Home is a "pinboard": the active identity's refs plus the latest contact sheet, with a faint 8 px baseline grid as the only texture |
| Projects-first sidebar (`AT/layouts/AGENTS.md:6-7`) | **identities-first** sidebar: the identity library sits at the top, the tools come next, history is last |
| Floating bottom prompt dock with a mode rail (`AT/layouts/AGENTS.md:12-16`) | A right-hand **Slate** panel (the brief) on desktop and a bottom sheet on mobile. Mode choice is a chip grid inside the Slate, not a rail |
| Justified, edge-to-edge, virtualised feed (`AT/layouts/AGENTS.md:19-20`) | A fixed-aspect contact sheet with numbered frames, grouped by run. Every frame shows its seed and variation |

What we keep, because it is good practice rather than Higgsfield's identity: busy and failed tiles stay visible in the grid (compare `AT/layouts/AGENTS.md:19-20`). One shared composer state per tool. Every visible control works.

### 1.3 UX rules that apply on every screen

1. **Ask little, with labelled options.** Each tool asks at most 4 questions before it runs. Questions are rows of chips, never open text, and any question the inputs already answer is skipped. This is the photoshoot interview rule [HF] (`HS/higgsfield-product-photoshoot/SKILL.md:43-44`, `:86`), and we apply it to every tool. Cards ask at most one confirmation [HF] (`HS/higgsfield-marketplace-cards/SKILL.md:31-33`).
2. **The user never writes the final prompt.** The intent field is short. The enhancer assembles the prompt (`PS-SPEC:28`). The assembled prompt is visible only under "Details" in the lightbox.
3. **One click is one job.** The client never resubmits a job on its own. Retry and Regenerate are explicit actions that create exactly one new job with a new seed (`API:20`, `API:159`, `API:171`). The copy says so wherever money could be spent (§7).
4. **Every wait shows a state.** That means queued (with the queue position when known), running (with progress when known), or a terminal state. There are no silent spinners. Polling starts at 1 s and backs off to 5 s (`API:26`).
5. **Results come back as labelled frames**, not as bare URLs or job ids. This mirrors the "labelled results only" delivery [HF] (`HS/higgsfield-marketplace-cards/SKILL.md:33`; `MC-SPEC:33`).
6. **No secrets in the UI.** The browser never sees the Comfy key, a Comfy URL or a signed URL (`API:5`). The only "key" surface is a server status pill (§2.4).

---

## 2. Global shell

### 2.1 Desktop layout (≥ 1024 px)

Three columns: the **Rail** (sidebar) on the left, the **Sheet** (canvas) in the centre and the **Slate** (brief) on the right. A thin top bar holds the breadcrumb, the run HUD and the theme toggle.

```
┌─────────────┬──────────────────────────────────────────────┬──────────────────────┐
│ OPEN SOUL   │ Photoshoot › Run 0412          ◐ 2 live  ☾   │ SLATE                │
│ STUDIO      ├──────────────────────────────────────────────┤ ──────────────────── │
│             │                                              │ Product   ▢ ▢ [+]    │
│ SOULS       │  CONTACT SHEET                               │ identity      (● Maya ▾) │
│ ● Maya   ✓  │  ┌──────┐┌──────┐┌──────┐┌──────┐            │ Mode      (product   │
│ ○ Theo      │  │  ▢   ││  ▢   ││ ░░░░ ││ ░░░░ │            │  shot)(lifestyle)…   │
│ [+ New]     │  │      ││      ││ 62%  ││ #3 Q │            │ Count     [-] 4 [+]  │
│ [Import]    │  └──────┘└──────┘└──────┘└──────┘            │ Aspect    (1:1)(4:5)…│
│             │  01 s4471  02 s9032  03 run   04 queue       │ Quality   (Fast|Final│
│ TOOLS       │                                              │ Intent    ________   │
│ ◆ identity      │  Run 0409 · Cards · full-set · 13 frames     │                      │
│ ◆ Photoshoot│  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐ ┌────┐┌────┐ …    │ ~4 jobs · ~90 s      │
│ ◆ Cards     │  └──┘└──┘└──┘└──┘└──┘└──┘ └────┘└────┘      │ ┏━━━━━━━━━━━━━━━━━━┓ │
│ ◆ Motion    │                                              │ ┃   SHOOT 4  ⌘↵    ┃ │
│             │                                              │ ┗━━━━━━━━━━━━━━━━━━┛ │
│ HISTORY     │                                              │                      │
│ ● 0412 Shoot│                                              │                      │
│ ✓ 0409 Cards│                                              │                      │
│ ✕ 0405 Mot. │                                              │                      │
│ [All runs]  │                                              │                      │
│ ─────────── │                                              │                      │
│ ● Cloud ok  │                                              │                      │
└─────────────┴──────────────────────────────────────────────┴──────────────────────┘
```

- **Rail**: 248 px wide, collapsible to a 64 px icon rail with `[`. It has four sections:
  - **identities** (§2.2);
  - **Tools**: Identity, Photoshoot, Cards, Motion, in that order, one per route (`/identity`, `/photoshoot`, `/listing`, `/motion`). The order follows the demo path;
  - **History** (§2.3);
  - the **server status pill** (§2.4).
- **Sheet**: the contact sheet for the current tool. Its newest run is at the top, and older runs of the same tool follow below. It scrolls independently.
- **Slate**: 360 px wide and fixed. It holds every input for the current tool, plus the cost and time estimate and the primary action at the bottom. The Slate keeps its state when you switch tools and come back (one store per tool; compare `AT/layouts/AGENTS.md:25-26`).
- **Top bar**: breadcrumb `Tool › Run id`, the **run HUD** (`◐ 2 live`: a count of non-terminal runs, which opens a popover listing them with progress) and the theme toggle.

### 2.2 identity library (Rail, top)

- Each row shows a 24 px round avatar (ref #1), the name and a state mark: `✓` ready, `◐` building, `!` needs attention.
- The **active identity** has a filled verdigris dot. Selecting an identity makes it the default identity in the Photoshoot, Cards (lifestyle) and Motion Slates. Each Slate can still override it.
- Hover or focus shows a `⋯` menu: Open, Rename, Export `identity.json` (zip), Duplicate, Delete (with a confirm that names the identity).
- `[+ New]` opens the identity tool. `[Import]` accepts a `identity.json` zip (`API:145-146`).
- **Drag and drop**: dragging an identity row onto any Slate's identity slot sets it.
- With no identities the section shows one line, "No identities yet", and `[+ New]`.

### 2.3 History

- Every pipeline run across tools, newest first. Each row shows a status glyph, the run id, the tool and a relative time. The last 8 rows show in the Rail; `[All runs]` opens a full-width table with tool, status and identity filters.
- **Status glyphs**:
  - `●` safelight: live (pending, queued or running);
  - `✓` ink: succeeded;
  - `◑` amber: partial;
  - `✕` red: failed or timed out;
  - `–` muted: canceled.
- Clicking a row opens that tool with the run scrolled into view and the Slate refilled from `run.request`, so the user can tweak and re-run. Run state lives on the server and survives reloads (`API:120`). History lists runs from the server, not from browser storage.

### 2.4 Server status pill (Rail, bottom)

The pill shows whether the server can reach Comfy. It never shows or collects a key.
- `● Cloud ok` means the server has `COMFY_API_KEY` set.
- `● Self-hosted` means `COMFY_BASE_URL` is set (`docs/PLAN.md:116`).
- `● Not configured` maps to a `503` from the API. Clicking it opens setup help that points to the README.
- `● Plan limit` maps to a `402` (`API:15`, `API:19`).

### 2.5 Routes

| Route | Screen |
|---|---|
| `/` | Home pinboard (§3) |
| `/identity`, `/identity/[id]` | Identity tool: create, then the identity detail view (§4) |
| `/photoshoot` | Photoshoot (§5) |
| `/listing` | Listing Images (§6) |
| `/motion` | Motion (§8) |
| `/runs` | All runs table (§2.3) |
| `?run=<id>` on any tool | Deep link to a run, used by History |

---

## 3. Home (pinboard)

```
┌ Rail ┬───────────────────────────────────────────────────────────────┐
│      │  Good evening. Your identity "Maya" is ready.                     │
│      │  ┌────┐┌────┐┌────┐┌────┐   MAYA · 4 refs · style card        │
│      │  │ ▢  ││ ▢  ││ ▢  ││ ▢  │   "short curly auburn hair, …"      │
│      │  └────┘└────┘└────┘└────┘   [Shoot with Maya] [Export identity.json]
│      │  ───────────────────────────────────────────────────────────  │
│      │  NEXT STEP                                                    │
│      │  ┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐ │
│      │  │ 1 identity   ✓  ││ 2 Photoshoot││ 3 Cards     ││ 4 Motion    │ │
│      │  │ done        ││ add product ││ 13 frames   ││ 5 s clip    │ │
│      │  └─────────────┘└─────────────┘└─────────────┘└─────────────┘ │
│      │  LATEST SHEET  (run 0412 · Photoshoot)                        │
│      │  ▢ ▢ ▢ ▢   [Open]                                             │
└──────┴───────────────────────────────────────────────────────────────┘
```

- **Top block**: the active identity's refs (best first), name, ref count, the first 120 characters of the style card, and two actions. With no identity this block becomes the empty state in §10.
- **Next step strip**: four step cards in demo order. The next undone step is outlined in safelight. A step card shows "done" once any successful run of that tool exists for the active identity or product. This is our replacement for template galleries: it teaches the flow.
- **Latest sheet**: the six newest frames from any tool.
- Home has no Slate. The canvas spans both centre columns.

---

## 4. Identity tool

Identity creation is a three-step wizard inside the Slate, and the Sheet shows the photos as they are checked. Steps: **Photos → Curate → Preview & save**.

### 4.1 Step 1: Photos

```
┌ Rail ┬──────────────────────────────────────────────┬ SLATE ───────────────────┐
│      │ PHOTOS  7 added · 5 usable                   │ NEW SOUL       Step 1/3  │
│      │ ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐     │ Name  [Maya__________]   │
│      │ │  ▢   ││  ▢   ││  ▢   ││  ▢   ││  ▢   │     │                          │
│      │ │  ✓   ││  ✓   ││ ! 2  ││  ✓   ││ ✕    │     │ Drop 3–12 photos of one  │
│      │ └──────┘└──────┘└──────┘└──────┘└──────┘     │ person. 6–10 is best.    │
│      │  front   3/4 L   faces   3/4 R   blurry      │ ┌──────────────────────┐ │
│      │ ┌──────┐┌──────┐┌ ─ ─ ─┐                     │ │  ⇪ drop / browse / ⌘V │ │
│      │ │  ▢   ││  ▢   │  + add                      │ └──────────────────────┘ │
│      │ │  ✓   ││  ~   │                            │ CHECKLIST                │
│      │ └──────┘└──────┘└ ─ ─ ─┘                     │ ✓ one face per photo     │
│      │  smile   small                               │ ✓ ≥3 usable              │
│      │                                              │ ~ angles: add a profile  │
│      │ Tip: mix angles, light and expressions.      │ ~ light: all indoor      │
│      │                                              │ ┏━━━━━━━━━━━━━━━━━━━━━━┓ │
│      │                                              │ ┃ BUILD SOUL  (5) ⌘↵   ┃ │
│      │                                              │ ┗━━━━━━━━━━━━━━━━━━━━━━┛ │
└──────┴──────────────────────────────────────────────┴──────────────────────────┘
```

- **Inputs**:
  - Name: one short word, required. Higgsfield asks for a single-word name too [HF] (`HS/higgsfield-soul-id/SKILL.md:43`).
  - Photos: 3–12 candidates (`lib/contracts/identity.ts:59`). We recommend 6–10. Higgsfield's trained Soul ID asks for 5–20 with 8–12 ideal [HF] (`HS/higgsfield-soul-id/references/photo-guide.md:7-8`). Our Instant identity keeps only the best 3–6 (`lib/contracts/identity.ts:12-13`), so we need fewer.
  - Accepted files: PNG, JPEG or WebP, ≤ 20 MB each (`API:23`). Drop, browse, paste (`⌘V`) or a phone camera on mobile.
- **Live photo checks.** These run in the browser on drop, before upload, and again on the server in the photo QA step (`API:127`). Each photo tile gets a badge:
  - `✓` usable;
  - `~` usable with a warning;
  - `!` blocked, with the reason on the tile.

  | Check | Result | Tile copy |
  |---|---|---|
  | Exactly one face | `!` if 0 or ≥2 | "No face found" / "2 faces: crop to one person" |
  | Short side ≥ 768 px (≥ 1024 ideal) | `!` below 512, `~` below 1024 | "Too small (480 px)" / "Small: OK, but sharper is better" |
  | Sharpness | `~` | "A bit blurry" |
  | Eyes visible (no sunglasses or hat brim) | `!` | "Eyes hidden" |
  | Near-duplicate (pHash) of another photo | `~` | "Same as #2: skipped" |

  The rules adapt the photo guide [HF] (`HS/higgsfield-soul-id/references/photo-guide.md:10-37`). The thresholds are ours.
- **Variety checklist** (Slate). Angle and lighting coverage is estimated from face pose and brightness. It gives advice, never blocks, and suggests the missing angle or light. The variety goals come from [HF] (`photo-guide.md:16-23`).
- **Primary action**: `BUILD SOUL (n)`, where n is the count of usable photos. It is disabled until the name is filled and at least 3 photos are usable. Disabled-state copy: "Add 1 more usable photo".
- Clicking `×` on a tile removes that photo. Blocked photos are never uploaded.

### 4.2 Step 2: Curate (the run is in progress or done)

The Sheet turns into the build view. Each pipeline step shows as a row (`API:127`): photo QA → cutouts → crop and dedupe → pick refs → preview sheet → save.

```
│ BUILDING "MAYA"                                   [Cancel]  │
│ ✓ Photo check        5 of 7 kept                            │
│ ✓ Cut out faces      5/5                                    │
│ ✓ Crop & dedupe                                             │
│ ✓ Pick best refs     4 chosen                               │
│ ● Preview sheet      Waiting for GPU · #2 in line           │
│ ○ Save identity.json                                            │
│                                                             │
│ CHOSEN REFS (drag to reorder · click to swap)               │
│ ┌────┐┌────┐┌────┐┌────┐   ┌────┐  bench                    │
│ │ 1★ ││ 2  ││ 3  ││ 4  │   │ 5  │  "3/4 R, darker"          │
│ └────┘└────┘└────┘└────┘   └────┘                           │
│ .92    .88    .85    .81    .74   ← QA score                │
│ REJECTED  #3 "2 faces" · #7 "blurry"                        │
```

- **Ref strip**: 3–6 chosen refs, best first. Ref ★1 is the "primary" ref, the one Motion uses as `<Picture 1>` (`API:179`). Users can reorder, swap a bench photo in, or remove a ref (never below 3). An edit made after the preview has rendered marks the preview "stale" and offers `[Re-render preview]`. That re-render is one new job, and the button says so.
- **Rejected list**: each rejected photo with its reason (`IdentityResult.rejected`, `API:128`).

### 4.3 Step 3: Preview and save

```
│ MAYA                                    ✓ Saved · 4 refs   │
│ ┌──────────────────────────────┐  STYLE CARD               │
│ │ identity preview sheet       │  Description              │
│ │ ▢ ▢ ▢                        │  [short curly auburn…   ] │
│ │ ▢ ▢ ▢                        │  Hair   [short curly …  ] │
│ └──────────────────────────────┘  Eyes   [green         ] │
│                                   Keep   (mole above lip ×)│
│                                          (+ add)          │
│ [Export identity.json]  [Shoot with Maya →]                    │
```

- **Preview sheet**: one Klein multi-ref render showing the identity in a few neutral framings. It is optional (`IdentityRequest.preview`, `lib/contracts/identity.ts:61-62`). Under it: "This is how Maya looks to the models. If it drifts, swap a ref."
- **Style card editor** (`lib/contracts/identity.ts:37-43`):
  - `description`: ≤ 400 characters, with a live counter;
  - a trait field per `StyleTrait` (skin tone, hair, eyes, face shape, age range, accessories, wardrobe), all optional;
  - `keep`: chips for features that must never change.

  Edits autosave to the identity. They do not need a new run.
- **Primary action**: `Shoot with <Name> →` opens Photoshoot with the identity preselected. The secondary action `Export identity.json` downloads a zip of `identity.json` plus `refs/NN.png` (`API:145`).
- **Identity detail** (`/identity/[id]`) is this same screen for an existing identity. Its Sheet adds a "Made with Maya" contact sheet: every frame from any tool that used this identity.

---

## 5. Photoshoot tool

### 5.1 Layout

```
┌ Rail ┬──────────────────────────────────────────────┬ SLATE ──────────────────┐
│      │ RUN 0412 · in_context · 4:5 · 4 frames  │ PRODUCT  ▢ serum.png ×  │
│      │ ┌────────┐┌────────┐┌────────┐┌────────┐     │          ▢ back.png  ×  │
│      │ │        ││        ││░░░░░░░░││        │     │          [+ angle]      │
│      │ │   ▢    ││   ▢    ││░ 62% ░░││ #3 in  │     │ SOUL     (● Maya ▾)(none│
│      │ │        ││        ││░░░░░░░░││  line  │     │ MODE                    │
│      │ └────────┘└────────┘└────────┘└────────┘     │ (Product shot)(Lifestyle│
│      │ 01 ✓      02 ✓      03 running  04 queued    │ (Hands/close-up)(Pin)   │
│      │ golden hr window lt  —         —             │ (Hero banner)(Carousel) │
│      │ 3/4 high  eye level                          │ (Ad pack)(Try-on)       │
│      │ warm      sage                               │ (Concept)(Restyle)      │
│      │                                              │ ── 3 quick questions ── │
│      │ Notices: count 2 → 3 for Carousel            │ Use it on               │
│      │                                              │ (Shopify)(Instagram)•   │
│      │                                              │ (Pinterest)(Ads)(Web)   │
│      │                                              │ Mood (Clean)(Warm)•…    │
│      │                                              │ COUNT [-] 4 [+] ASPECT  │
│      │                                              │ (1:1)(4:5)•(2:3)…(more) │
│      │                                              │ QUALITY (Fast)•(Final)  │
│      │                                              │ [ ] transparent PNG     │
│      │                                              │ INTENT "on a sunlit…"   │
│      │                                              │ 4 jobs · ~90 s          │
│      │                                              │ ┏━━━━━━━━━━━━━━━━━━━━━┓ │
│      │                                              │ ┃  SHOOT 4   ⌘↵       ┃ │
│      │                                              │ ┗━━━━━━━━━━━━━━━━━━━━━┛ │
└──────┴──────────────────────────────────────────────┴─────────────────────────┘
```

### 5.2 Slate inputs (top to bottom)

1. **Product**: 0–N product images (`PhotoshootRequest.images`, `API:152`). The first image is the hero ref. Without a product, only the text route is available (Type C; `PS-SPEC:204`). A banner then says "Upload a product photo for much better fidelity". The "photo preferred" stance comes from [HF] (`HS/higgsfield-product-photoshoot/SKILL.md:105`).
2. **Identity**: the active identity by default, or `(none)`. Its chip shows the identity's avatar. It is hidden for modes that never use identity refs (`packshot`, `concept`; `PS-SPEC:49,57`) and shown with the hint "used for the model" for `on_model` (`PS-SPEC:56`).
3. **Mode**: a chip grid of the 10 modes, with friendly labels (ids in tooltips):

   | Chip | Mode id |
   |---|---|
   | Product shot | `packshot` |
   | Lifestyle | `in_context` |
   | Hands / close-up | `hands_on` |
   | Pin | `mood_still` |
   | Hero banner | `wide_banner` |
   | Carousel | `carousel_set` |
   | Ad pack | `ad_variants` |
   | Try-on | `on_model` |
   | Concept | `concept` |
   | Restyle | `restage` |

   The mode list is [HF] (`HS/higgsfield-product-photoshoot/SKILL.md:50-61`). Typing an intent first and leaving the mode as `Auto` (the default chip) lets the router pick (`PS-SPEC:101-146`). The chosen mode then lights up with a small "auto" tag. When the router finds two formats ("hero banner and a pin"), it shows the split chips `(Hero banner)(Pin)(Both: 2 runs)` (`PS-SPEC:146`).
4. **Quick questions**: the interview chip sheet (`PS-SPEC:151-232`).
   - It shows at most 4 rows at once, each a row of chips with a pre-selected default (•), and any row can be ignored.
   - Rows the inputs already answer are hidden. For example, a product photo hides "Can you upload a product photo?", and the `Restyle` mode with "Christmas" in the intent pre-selects the season row.
   - The row sets come from Types A–F [HF] (`HS/higgsfield-product-photoshoot/SKILL.md:88-134`). The header shows how many rows are visible ("3 quick questions").
5. **Count**: a stepper with the mode's allowed range and default (`PS-SPEC:47-58`), for example Carousel 3–10 with default 5. An out-of-range value is clamped and noted, not refused (`API:158`).
6. **Aspect**: chips for the whitelist `1:1, 4:5, 5:4, 3:4, 4:3, 2:3, 3:2, 9:16, 16:9` [HF] (`HS/higgsfield-product-photoshoot/SKILL.md:185`). The four most relevant for the mode are visible and `(more)` reveals the rest. The default follows the mode and the "Use it on" chip (`PS-SPEC:60`). A manual pick shows an `×` to return to auto.
7. **Quality**: `Fast` (Klein 4B distilled only) or `Final` (adds the SeedVR2 upscale; `API:153`).
8. **Transparent PNG**: a checkbox that adds the cutout step (`API:153`).
9. **Intent**: a single-line text field (2 lines on focus), ≤ 200 characters, with placeholder "What should these shots say? e.g. on a sunlit kitchen counter". This is the short intent, not the prompt (`API:157`).
10. **Estimate line**: "4 jobs · ~90 s", plus "≈ N credits (estimate)" only when a calibration exists; otherwise no credit figure (`docs/PLAN.md`, Backend row: latency meter; §16 item 1).
11. **Primary action**: `SHOOT n` (`SHOOT 5 SLIDES` for Carousel, `SHOOT n VARIANTS` for Ad pack). While the run is live it becomes `CANCEL RUN` in outline style. Cancel stops new steps and cancels running jobs (`API:87`), and asks once: "Cancel 2 unfinished frames? Finished frames stay."

### 5.3 Results

- One run makes one contact-sheet block. Its header shows run id · mode · aspect · count, plus a style-lock tag 🔒 for Carousel and Ad pack ("one look across all slides", `PS-SPEC:260`).
- Frames keep the run's aspect ratio, in a grid of 2–5 columns depending on the ratio.
- **Caption strip** per frame (mono font): frame number, status, and the four variation axes (`variation: {preset, lighting, angle, palette}`, `API:154`). This shows the user why the frames differ [HF] (`HS/higgsfield-product-photoshoot/SKILL.md:179`).
- **Notices** (clamps and snaps, `API:158`) appear as one muted line under the header. They are never modal.
- For Carousel the frames are numbered as slides, `S1…Sn`, and the block has a `[Play as carousel]` preview.

---

## 6. Listing Images tool

### 6.1 Layout: the 13-frame board

The Sheet is a fixed board. The order and the slots always follow the scope table (`MC-SPEC:41-58`), so a full set always looks the same. Slots outside the chosen scope are ghosted, which teaches what the bigger scopes add.

```
┌ Rail ┬───────────────────────────────────────────────────────┬ SLATE ─────────────┐
│      │ RUN 0409 · full-set · 13 frames      [Export ZIP]     │ PRODUCT ▢▢ [+]     │
│      │ ┌───────────────┐ ┌──────┐┌──────┐┌──────┐            │ SCOPE              │
│      │ │               │ │ info ││multi ││detail│            │ (Main)(+5 product) │
│      │ │  MAIN  ▢      │ │  ▢   ││ ▢▢   ││  ▢   │            │ (Story set)(Complete 13)• │
│      │ │               │ └──────┘└──────┘└──────┘            │ (Custom…)          │
│      │ │ ✓ white 99.8% │ ┌──────┐┌──────┐                    │ ── listing copy ── │
│      │ │ ✓ fill 86%    │ │life  ││in box│                    │ Product name *     │
│      │ │ ✓ no text     │ │ ░62%░││ ✎ add│                    │ [GLOW serum 30 ml] │
│      │ └───────────────┘ └──────┘└──────┘                    │ Bullets (1–5)      │
│      │ STORY PANELS (1464×600)                                 │ [ ] [ ] [+]        │
│      │ ┌──────────────────────────┐┌──────────────────────────┐│ Pain points       │
│      │ │ hero banner   ▢          ││ pain points  ▢           ││ How to use        │
│      │ └──────────────────────────┘└──────────────────────────┘│ Efficacy + source │
│      │ ┌──────────────────────────┐┌──────────────────────────┐│ Endorsement       │
│      │ │ features      ✓          ││ ingredients  #4 in line  ││ What's in the box │
│      │ └──────────────────────────┘└──────────────────────────┘│ Category (Beauty▾)│
│      │ ┌──────────────────────────┐┌──────────────────────────┐│ identity for lifestyle│
│      │ │ efficacy  ✎ needs source ││ how to use   ▢           ││ (● Maya)(none)    │
│      │ └──────────────────────────┘└──────────────────────────┘│ 13 frames · ~4 min │
│      │ ┌──────────────────────────┐                           │ ┏━━━━━━━━━━━━━━━━┓ │
│      │ │ endorsement ✕ Retry      │                           │ ┃ MAKE 13 CARDS  ┃ │
│      │ └──────────────────────────┘                           │ ┗━━━━━━━━━━━━━━━━┛ │
└──────┴───────────────────────────────────────────────────────┴────────────────────┘
```

### 6.2 Slate inputs

1. **Product images**: 1–6 (`API:165`). The first one is cut out to make the main image.
2. **Scope**: chips `Main` (1), `+5 product images` (6), `Story set` (8), `Full set` (13), `Custom…`. The scope sizes follow [HF]; the names are ours (`HS/higgsfield-marketplace-cards/SKILL.md:39-46`). `Custom…` opens a checklist of the 13 asset ids. `hero` is always checked and locked unless a previous main is reused (`MC-SPEC:56-57`).
3. **Reuse main**: when a run of this product already has a passing main image, the Slate offers `Reuse main from run 0407 ✓`. This is the anchor reuse [HF] (`HS/higgsfield-marketplace-cards/SKILL.md:75`), as `mainJobId` in our API (`API:165`).
4. **Listing copy**: the fields from `MC-SPEC:197-220`. Only the fields that the chosen scope uses are shown. Each field shows which tiles it feeds ("used by: infographic, features"). Required fields carry `*`. Efficacy claims require a source line; without one, the efficacy tile becomes `needs_input` (`API:170`).
5. **Category**: a select that drives the lifestyle scene.
6. **Identity for lifestyle**: optional (`MC-SPEC:130`).
7. **Confirmation**: no interview. When the scope is bigger than `Main` and listing copy is empty, the button asks one inline question: "Make 13 cards now and fill copy later? (Yes, make them)(Add copy first)". This follows the one-confirmation rule [HF] (`HS/higgsfield-marketplace-cards/SKILL.md:32`).
8. **Primary action**: `MAKE n CARDS`, with the estimate line above it.

### 6.3 Tile behaviours

- Tile states follow `CardTile.state`: `queued | running | succeeded | needs_input | failed` (`CardTileState`, `lib/contracts/listing.ts:15`; `API:213`).
- **Main tile**: always rendered first and twice the size of the others. Under it is the **compliance checklist** (`MC-SPEC:144-178`): white border ≥ 99%, product fill, no text, size ≥ 2000 px. Each check is a ✓ or ✕ with its value. If the main image fails compliance, the run fails before fan-out (`API:118`). The main tile then shows the failing check and two actions: `[Re-cut]` (new cutout job) and `[Use another photo]`. The other tiles stay ghosted with "Waiting for a passing main image".
- **needs_input**: the tile shows `✎` and the missing fields ("Needs: efficacy source"). Clicking it focuses those fields in the Slate. Once they are filled, the tile offers `[Make this card]`.
- **Per-tile regenerate**: in the hover rail. It keeps the anchor and the style block and changes only the seed (`API:171`). Copy: "Regenerate: 1 new job, same look".
- **Text-only edits**: tiles whose copy is rendered in code (infographic, features, efficacy, endorsement) re-render instantly after a copy edit, with no GPU job. These tiles carry an "edit text" pencil, and the UI says "Text edits are free: no new image job".
- **Export ZIP**: exports the `succeeded` tiles plus `cards.json` (`API:216`). When some tiles are not done, it asks: "Export 11 of 13? 2 still need copy."

---

## 7. Progress, failure and retry states (shared by every tool)

Every frame tile and every pipeline-step row renders the same state machine. The source states are `JobStatus` and `PipelineStepStatus` (`lib/contracts/job.ts:16-23`, `lib/contracts/pipeline.ts:27`, `API:113`).

| Source status | Tile visual | Primary copy | Secondary copy / action |
|---|---|---|---|
| `pending` | Empty frame, dashed border | "Up next" | – |
| `queued`, with `queuePosition` | Frame with a slow safelight shimmer (static under reduced motion) | **"Waiting for GPU"** | "#3 in line". With no position: "In the queue" |
| `running`, with `progress` 0..1 | Frame fills bottom to top like a developing print; the % sits in the caption | "Developing… 62%" | Elapsed time "0:41". Motion adds "~2 min left" from the estimate |
| `running`, `progress = null` | An indeterminate band sweeps across | "Developing…" | Elapsed time |
| `unknown` | Frame stays in its last state with a `?` corner mark | "Still checking on this job" | "We won't resubmit it. It may finish on its own." `[Keep waiting]` `[Stop watching]` |
| `succeeded` | The image (fades in for 200 ms) | – | Hover rail (§9.2) |
| `failed` | Muted frame with a red corner tick and the reason | "Didn't develop" plus a short reason ("Out of memory", "Model error") | `[Retry]` |
| `timed_out` | Like `failed`, with a clock icon | "Took too long, so we stopped watching" | `[Keep waiting]` (polls the same job, free) and `[Start again]` (one new job) |
| `canceled` | Ghosted frame | "Canceled" | `[Run this frame]` |
| `expired` | Ghosted frame | "This result expired on the server" | `[Run again]` |
| `needs_input` (cards) | Pencil frame | "Needs: <fields>" | Focuses the fields |
| `skipped` | Hidden from the sheet; the step list shows it as "skipped" | – | – |

### 7.1 Retry without double billing: the copy and the rules

- **Rule**: the app never resubmits on its own (`API:20`, `docs/PLAN.md:135`). Each retry, regenerate or "start again" creates exactly one new job with a new seed (`API:159`).
- **Button labels say what a click costs**: `Retry · 1 job`, `Regenerate · 1 job`, `Start again · 1 job`.
- **Tooltip and first-time hint on Retry**: "Retry starts one new job. The failed one is not resubmitted, so you're never billed twice for one click."
- **`unknown` and `timed_out` hint**: "The original job may still be running on the GPU. 'Keep waiting' checks it again for free. 'Start again' makes a new job, which costs another run."
- **Double-click guard**: the primary action and every Retry button are disabled from click until the server acknowledges with `202`. They show "Sending…" in the meantime. A second click during that window does nothing.
- **Network drop during submit**: when the POST response is lost, the UI does not resend. It shows "We couldn't confirm this started. Check History before running again." and opens the History filtered to the last minute. Because runs are server-side, a run that did start appears there.
- **Plan and credit error (`402`)**: "Comfy declined this run: plan or credit limit. Nothing was submitted."
- **Validation error (`400` with `field`)**: the Slate field is highlighted with the server message. Nothing is shown as a failed frame, because no job exists.

### 7.2 Run-level states

- **Run header**: a thin progress bar with `run.progress` (`API:105`) and the counts "3 done · 1 developing · 1 waiting for GPU".
- **Partial run** (`API:117`): the header shows an amber `◑` and "11 of 13 ready. 2 need attention". Failed frames keep their Retry.
- **Failed run**: a red header with the gating reason and its action.
- **Run HUD** (top bar): lists every live run across tools, so the user can switch tools while jobs run. When a run finishes in another tool, a toast says "Cards ready: 13 frames [Open]". Toasts use `aria-live="polite"`.

---

## 8. Motion tool (MiniMax H3)

```
┌ Rail ┬──────────────────────────────────────────────┬ SLATE ───────────────────┐
│      │ RUN 0415 · 9:16 · 5 s · Final                │ PICTURE 1 · PERSON       │
│      │ ┌──────────────┐                             │ (● Maya ★1)(upload)      │
│      │ │              │  ✓ Prepare refs             │ PICTURE 2 · PRODUCT      │
│      │ │   ▶ 0:05     │  ✓ Build prompt             │ ▢ from run 0412 #2  ×    │
│      │ │              │  ● Render clip              │ [pick from sheet][upload]│
│      │ │  ░░ 38% ░░   │    Developing… 38% · 1:12   │ PROMPT                   │
│      │ │              │    ~1:50 left               │ [Person] holds [Product] │
│      │ └──────────────┘                             │ up to the light, smiles… │
│      │  frame 0415 · seed 42 · 124 fr               │ (+Person)(+Product)      │
│      │                                              │ LENGTH (5 s)•(8 s)(10 s) │
│      │                                              │ ASPECT (9:16)•(16:9)(1:1)│
│      │                                              │ QUALITY (Preview)(Final)•│
│      │                                              │ LIKENESS (Match)•(Max)   │
│      │                                              │ 1 job · ~2–3 min         │
│      │                                              │ ┏━━━━━━━━━━━━━━━━━━━━━━┓ │
│      │                                              │ ┃ ROLL CLIP  ⌘↵        ┃ │
│      │                                              │ ┗━━━━━━━━━━━━━━━━━━━━━━┛ │
└──────┴──────────────────────────────────────────────┴──────────────────────────┘
```

- **Picture 1, person**: an identity (it uses ref ★1) or an uploaded person image. Exactly one is required (`API:182`).
- **Picture 2, product**: upload, or `[pick from sheet]`, which opens a picker over all Photoshoot and Cards frames (the main-image cutout is the top suggestion).
- **Prompt**: a short line. `(+Person)` and `(+Product)` insert role tokens, shown as coloured inline chips. The prompt builder maps them to `<Picture 1>` and `<Picture 2>` (`API:179`). Users never type the raw tags.
- **Length**: 5, 8 or 10 s (default 5 s). The server snaps lengths to the model's frame grid (`docs/spikes/h3-r2v.md:60`).
- **Aspect**: the H3 options (`API:184`).
- **Quality**: `Preview` is the turbo 4-step render: fast, with a weaker likeness. `Final` is 20 steps and the default (`API:183`; `docs/PLAN.md:6-8`). The Preview chip carries a hint: "Faster, likeness may drift".
- **Likeness**: `Match` or `Max` (`refFidelity`, `API:178`).
- **Primary action**: `ROLL CLIP`. The estimate line reads "1 job · ~2–3 min" (target < 3 min, `docs/PLAN.md:190`).
- **Result**: an inline player that loops muted and unmutes on click, with `[Download MP4]` and `[Roll final]` (shown on Preview results only: "same seed, 20 steps · 1 job").

---

## 9. Gallery and contact-sheet behaviours

### 9.1 Grid

- Runs are grouped, newest first. Each group has a sticky header (run id · tool · key settings · status).
- Frames keep their true aspect ratio inside a uniform-height row per run. They are never cropped in the grid.
- Columns: 2 below 640 px, 3 at 640–1023 px, 4–5 above 1024 px. Wide story panels span 2 columns.
- **Lazy loading**: thumbnails come from the re-hosted output route (`API:25`) as 512 px WebP previews. The full image loads only in the lightbox or on download.
- Live frames sit in their final slot from the start, so the grid never reflows when they finish.
- Selection: click to select, `⇧`-click for a range, `⌘`-click to toggle. The selection bar offers Download (zip), Use as product in Motion, Send to Cards as product image, and Delete from history.

### 9.2 Frame actions

The **hover rail** (and a long-press sheet on touch) shows at most three icons: Download, Retry/Regenerate, and `⋯`. The `⋯` menu holds Use in Motion, Use as Cards product, Copy seed, Open run, and Delete.

### 9.3 Lightbox

```
┌──────────────────────────────────────────────────────────────┐
│ ◀  02 / 04  · in_context · seed 9032          ✕         │
│ ┌──────────────────────────────────┐  VARIATION              │
│ │                                  │  preset   golden hour   │
│ │             ▢                    │  light    window        │
│ │                                  │  angle    eye level     │
│ │                                  │  palette  sage          │
│ └──────────────────────────────────┘  SOUL  Maya (4 refs)    │
│ [Download] [Regenerate · 1 job] [Use in Motion]  ▸ Details   │
└──────────────────────────────────────────────────────────────┘
```

- `←` and `→` move through the run, and `Esc` closes.
- "Details" expands to show the assembled prompt, the workflow name and the timings. These are hidden by default, mirroring the "no prompts unless asked" delivery [HF] (`HS/higgsfield-marketplace-cards/SKILL.md:79-88`).
- For video the lightbox embeds the player.

---

## 10. Empty states

Each empty state is one sentence, one action and an outline of a contact sheet: numbered frames, empty, in the line colour. We never show stock imagery or fake outputs.

| Screen | Headline | Line | Action |
|---|---|---|---|
| Home, no identity | "Start with an identity." | "3–12 photos of one person become a reusable identity you can export." | `[Make an identity]` |
| Identity library (Rail) | "No identities yet" | – | `[+ New]` |
| Photoshoot, no runs | "Your first sheet goes here." | "Add a product photo, pick a mode, shoot." | Focuses the Product drop zone |
| Photoshoot, no product and no identity | same | "No product? Describe it instead, but a photo is much better." | `[Upload product]` |
| Cards, no runs | "13 marketplace frames, one product photo." | "Main image first; the rest are built around it." | `[Upload product]` |
| Motion, no identity and no person | "Clips need a person and a product." | "Use an identity or upload a photo." | `[Pick an identity]` |
| History | "Nothing has run yet." | – | – |
| Server not configured | "Can't reach Comfy." | "The server has no `COMFY_API_KEY` or `COMFY_BASE_URL`." | `[Setup guide]` |

---

## 11. Mobile layout (< 640 px; tablet 640–1023 px)

```
┌───────────────────────────┐      ┌───────────────────────────┐
│ ≡  Photoshoot   ◐2   ☾    │      │ ≡  Photoshoot             │
├───────────────────────────┤      ├───────────────────────────┤
│ RUN 0412 · 4:5 · 4        │      │ ░░ sheet dimmed ░░        │
│ ┌──────────┐┌──────────┐  │      │╭─────────────────────────╮│
│ │    ▢     ││    ▢     │  │      ││ ━━  SLATE  (drag up)    ││
│ └──────────┘└──────────┘  │      ││ Product ▢ [+]           ││
│ 01 ✓        02 ✓          │      ││ identity (● Maya)           ││
│ ┌──────────┐┌──────────┐  │      ││ Mode (Lifestyle) ▸      ││
│ │ ░ 62% ░  ││ #3 in    │  │      ││ Use it on (Instagram)•… ││
│ └──────────┘└──────────┘  │      ││ Count 4  Aspect 4:5     ││
│ ╭───────────────────────╮ │      ││ ┏━━━━━━━━━━━━━━━━━━━━━┓ ││
│ │ Lifestyle · 4 · 4:5 ▴ │ │      ││ ┃     SHOOT 4         ┃ ││
│ │ [ SHOOT 4 ]           │ │      ││ ┗━━━━━━━━━━━━━━━━━━━━━┛ ││
│ ╰───────────────────────╯ │      │╰─────────────────────────╯│
├───────────────────────────┤      ├───────────────────────────┤
│ ◆identity ◆Shoot ◆Cards ◆Mot. │      │ ◆identity ◆Shoot ◆Cards ◆Mot. │
└───────────────────────────┘      └───────────────────────────┘
   collapsed Slate                    expanded Slate (sheet)
```

- **Rail → bottom tab bar** with the four tools. `≡` opens a drawer with the identities, History and the server pill.
- **Slate → bottom sheet**. Collapsed, it shows a one-line summary and the primary action, so the primary action is always reachable with a thumb. Expanded, it scrolls internally. The primary action stays pinned at the bottom of the sheet, above the safe-area inset.
- The identity upload uses the camera picker (`accept="image/*"`, multiple). The live checks run the same way as on desktop.
- The Cards board becomes one column: main, then 5 secondary tiles in a 2-column grid, then story panels full width.
- Hover rails become long-press action sheets, and the lightbox supports swipe.
- Touch targets are ≥ 44 px, with no horizontal page scroll and a 16 px side gutter.
- **Tablet**: the Rail is collapsed to icons by default. The Slate becomes a right drawer of 360 px over the Sheet.

---

## 12. Keyboard shortcuts

Single-key shortcuts are disabled while a text field has focus. `⌘` means `Ctrl` on Windows and Linux. `?` opens a shortcut sheet.

| Keys | Action |
|---|---|
| `⌘ ↵` | Primary action of the current tool (Build / Shoot / Make / Roll). Works inside text fields |
| `Esc` | Close the lightbox, popover or sheet. While a confirm is open, it means "No" |
| `1` `2` `3` `4` | Switch tool: Identity, Photoshoot, Cards, Motion |
| `H` | Home |
| `[` | Collapse or expand the Rail |
| `]` | Collapse or expand the Slate |
| `/` | Focus the Intent / Prompt field |
| `U` | Open the file picker for the current tool's main upload |
| `⌘ V` | Paste an image into the current tool's main upload |
| `S` | Open the identity picker in the Slate |
| `M` | Focus the Mode chips (Photoshoot); arrow keys move, `Space` picks |
| `← →` | Previous or next frame in the lightbox |
| `↵` | Open the focused frame in the lightbox |
| `D` | Download the focused frame or selection |
| `R` | Retry or regenerate the focused frame (opens the confirm with its cost; `↵` confirms) |
| `E` | Export: `identity.json` on identity screens, the ZIP on Cards |
| `.` | Open the run HUD |
| `?` | Shortcut sheet |

---

## 13. The 3-minute live demo path

This is the path through the UI the demo script (`docs/PLAN.md:199`) relies on. The time targets come from `docs/PLAN.md:190`: Identity preview < 60 s, 4-image shoot < 90 s, 13 cards < 4 min, H3 clip < 3 min. Serially these add up to more than 3 minutes. So the path **overlaps runs** with the run HUD, and switches Motion to Preview quality when the queue is long.

| t | Screen | User does | UI shows |
|---|---|---|---|
| 0:00 | Home (empty) | Clicks `[Make an identity]` | Identity step 1 |
| 0:05 | Identity · Photos | Drops 8 selfies, types "Maya" | Tiles badge live. One "2 faces" photo is blocked and one blurry photo gets `~`. The checklist turns green. "6 usable" |
| 0:20 | Identity · Curate | `⌘↵` Build identity | The step rows tick. Refs appear with QA scores. "Preview sheet: Waiting for GPU · #1 in line", then "Developing…" |
| 0:20–1:10 | (in parallel) | Clicks `2` for Photoshoot **while the preview renders**. The identity is already selectable, because refs are saved before the preview step | The run HUD shows `◐ 1 live` |
| 0:30 | Photoshoot | Drops serum.png. Mode `Hands / close-up`. Count 4. Use it on `(Instagram)`. `⌘↵` | 4 frames: two "Waiting for GPU", two "Developing…" |
| 0:45 | Cards | Clicks `3`. The product carries over. Scope `Full set`. Types the product name and 3 bullets. Clicks `MAKE 13 CARDS` | The main tile develops first. The compliance ticks turn green. The other 12 fan out |
| 1:10 | Identity (toast) | Toast "Maya preview ready". Opens it and shows the style card | The identity sheet |
| 1:30 | Photoshoot | Returns. 4 frames done. Opens the lightbox on #2 and shows the variation panel | Maya holding the serum |
| 1:45 | Motion | Clicks `4`. Picture 1 = Maya. `[pick from sheet]` → frame #2. Prompt: `(+Person)` holds `(+Product)` up to the light. Quality: Preview if the HUD shows more than 2 live jobs, otherwise Final. `⌘↵` | "Developing… 12%", with a time-left estimate |
| 2:00 | Cards | Shows the 13-frame board filling in. Fills one `needs_input` tile (efficacy source) live, then `[Export ZIP]` | Ready tiles. One text edit re-renders instantly with no job |
| 2:30 | Motion | The clip finishes (or the presenter opens the **pre-rendered** golden clip, which is clearly labelled `pre-run`) | The player loops |
| 2:45 | Identity detail | `E`: Export `identity.json` | The download chip shows `maya.identity.zip · 4 refs · 1.9 MB` |
| 3:00 | – | Close line: "Your identity is a file you own." | – |

**Demo-safety requirements [OURS]**
- **Pre-run results** (`docs/PLAN.md:191`, golden demo assets) can be loaded into History from `fixtures/golden/`. They always carry a visible `pre-run` tag. The UI never passes them off as live.
- When a tool has no live run, its Slate remembers the last inputs, so a re-take of the demo needs no retyping.
- If Comfy queues for long, "Waiting for GPU · #n in line" is the honest state. The presenter can switch to the pre-run without cancelling the live run.

---

## 14. Accessibility

- Text meets WCAG 2.2 AA contrast in both themes (checked token pairs in §15.1). The safelight colour never carries meaning alone: every status also has a glyph and a word.
- Status changes are announced with `aria-live="polite"`: "Frame 3 developed", "Run 0409 partial: 2 need attention".
- `prefers-reduced-motion` turns the shimmer and the develop-fill into static states with a % label.
- Every chip row is a `radiogroup` (single choice) or a `group` of checkboxes, navigable with the arrow keys.
- Focus ring: 2 px safelight with a 2 px offset. It is never removed.
- Every image has alt text built from its frame caption ("Frame 2, lifestyle scene, golden hour, eye level").

---

## 15. Design tokens [OURS]

The names are semantic. Wave 2 maps them into `app/globals.css` (Tailwind `@theme`). They replace the scaffold's placeholder violet (`app/globals.css:9`).

### 15.1 Colour

| Token | Paper (light, default) | Darkroom (dark) | Use |
|---|---|---|---|
| `--bg` | `#F4F1EA` warm paper | `#141210` | page |
| `--surface` | `#FBF9F4` | `#1D1A17` | Rail, Slate, cards |
| `--surface-sunk` | `#ECE7DC` | `#0E0C0B` | frame wells, drop zones |
| `--ink` | `#1B1A17` | `#EDE8DF` | primary text |
| `--ink-2` | `#55504A` | `#A9A196` | secondary text (AA on `--bg` and `--surface`) |
| `--line` | `#D9D2C4` | `#332E29` | borders, empty-frame outlines |
| `--safelight` | `#D9431E` | `#FF6A3D` | primary CTA, focus, live state |
| `--safelight-ink` | `#FFFFFF` | `#1B0B05` | text on safelight |
| `--safelight-wash` | `#F7DCCF` | `#3A1E14` | queued shimmer, selected chip bg |
| `--verdigris` | `#2E7D6B` | `#5CC0A6` | Identity identity: active identity dot, identity chips, Person token |
| `--brass` | `#A86B12` | `#E0A23A` | partial / warning, Product token |
| `--ok` | `#2F6B3A` | `#7BC48A` | compliance pass, succeeded glyph |
| `--danger` | `#B3261E` | `#FF7B72` | failed, compliance fail |
| `--scrim` | `rgb(27 26 23 / .55)` | `rgb(0 0 0 / .65)` | lightbox, sheet backdrop |

Rules: safelight appears only on the one primary action per screen, on focus and on live states. Ordinary buttons are ink outline or ghost. There is no lime and no gradient glow.

### 15.2 Type

All three families are OFL and self-hosted; the card renderer already bundles OFL fonts (`docs/PLAN.md:178`).
- **Display**: *Fraunces* (soft serif, opsz axis), used for page titles, empty-state headlines and the identity name.
- **UI**: *IBM Plex Sans*.
- **Captions and data**: *IBM Plex Mono*, used for frame numbers, seeds, run ids, percentages and the shortcut sheet.

| Token | Size / line-height | Family / weight | Use |
|---|---|---|---|
| `--t-display` | 40 / 44 | Fraunces 600, opsz 72 | Home greeting, identity name |
| `--t-h1` | 28 / 34 | Fraunces 600 | screen titles |
| `--t-h2` | 20 / 26 | Plex Sans 600 | Slate section heads, run headers |
| `--t-body` | 15 / 22 | Plex Sans 400 | default |
| `--t-label` | 13 / 18 | Plex Sans 500, +0.02em, uppercase for section labels | chip labels, field labels |
| `--t-caption` | 12 / 16 | Plex Mono 400 | frame captions, seeds |
| `--t-micro` | 11 / 14 | Plex Mono 500 | badges, queue position |

On mobile, `--t-display` drops to 32/36 and `--t-h1` to 24/30.

### 15.3 Spacing, shape, elevation, motion

- **Spacing scale** (4 px base): `--s-1 4`, `--s-2 8`, `--s-3 12`, `--s-4 16`, `--s-5 24`, `--s-6 32`, `--s-7 48`, `--s-8 64`.
  - Slate padding is `--s-5`, the gap between frames `--s-3`, the gap between run groups `--s-7`, and the mobile gutter `--s-4`.
- **Layout**: Rail 248 px (64 px collapsed), Slate 360 px, top bar 48 px, mobile tab bar 56 px plus the safe area.
- **Radius**: `--r-frame 2px` (frames look like prints: almost square), `--r-control 6px` (inputs, buttons), `--r-chip 999px`, `--r-sheet 16px` (mobile sheet top corners only).
- **Elevation**: flat by default. The one shadow is `--e-print`: `0 1px 0 rgb(0 0 0 / .06), 0 2px 6px rgb(0 0 0 / .06)` on frames, and in dark mode a 1 px `--line` border instead. Popovers use `--e-float`: `0 8px 24px rgb(0 0 0 / .14)`.
- **Frame caption strip**: 24 px tall, `--surface`, mono `--t-caption`, separated from the image by a 1 px `--line` rule. It is the signature element of the look.
- **Motion**:
  - `--m-fast 120ms` (hover, chip select) and `--m-base 200ms` (image fade-in, sheet open), both `cubic-bezier(.2,.7,.2,1)`;
  - the develop-fill eases toward the reported progress over 600 ms;
  - the queued shimmer is a 2.4 s loop.

  All of them are disabled under reduced motion.
- **Iconography**: 1.5 px stroke line icons at 20 px (any OSS set, e.g. Lucide or Tabler).

---

## 16. Open points for Wave 2

1. **Running-time estimates.** These need the latency meter (`docs/PLAN.md`, Backend row). Until real timings exist, the estimate line shows the plan targets with a `~`. **Per-job cost is an estimate or unavailable:** `X-Comfy-Credits-Used` exists only on some Router responses, and its absence does not mean free (Comfy docs `development/comfy-router/billing.mdx:23`); our graphs run as API v2 jobs, not Router calls. The workspace usage endpoint is drawn from invoices, so recent usage may be missing: a reporting surface, not a real-time meter (`openapi-cloud.yaml:2356-2358`). So the UI shows "≈ N credits (estimate)" from the Wave 3 calibration table (#41), or no credit figure at all; never an exact per-job cost.
2. **Photo checks in the browser.** Client-side face counting needs a small open face detector, such as MediaPipe Face Detection in WASM. If that is too heavy, the browser checks only size and type, and the face checks show after the server QA step, with the same tile badges.
3. **Saving refs before the preview.** The demo overlap in §13 assumes the identity's refs are persisted before the optional preview step finishes. Today's step order is "preview → write `identity.json`" (`API:127`). The registry should save refs first and attach the preview later. Raise this with the API owner.
