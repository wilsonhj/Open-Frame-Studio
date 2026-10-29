# Spec: Soul ID, Instant (Open Soul Studio)

Status: Wave 1 behavioural spec. It covers photo intake, automated photo QA, reference selection, the portable `soul.json` format, how a Soul feeds the generation graphs, and privacy. It follows the Wave 0 override in `docs/PLAN.md:1-15`: **Soul ID is Instant only.** A Soul is a curated set of reference crops plus a style card, with no trained LoRA (`docs/PLAN.md:7`). **FLUX.2 Klein 4B distilled** is the default model (`docs/PLAN.md:6`).

## Conventions

- **`HF`** marks a fact from a Higgsfield source. Each one cites `path:line`.
- **`ours`** marks a decision we make because Higgsfield's behaviour is server-side or doesn't apply to an untrained Soul.
- **`contract`** marks something already in `lib/types.ts`, which another Wave 1 agent owns. **`proposed`** marks a field or value this spec needs that the contract doesn't have yet (listed in §10).
- Source abbreviations:
  - `SID` = `higgsfield-ai/skills (local clone)/higgsfield-soul-id/SKILL.md` (v0.13.0). Upstream 0.14.0 differs only in the `version:` line (checked with `diff -r`), so these line numbers also hold for `.../scratchpad/web/hf-gh/skills/higgsfield-soul-id/`.
  - `PG` = `higgsfield-ai/skills (local clone)/higgsfield-soul-id/references/photo-guide.md`
  - `TS` = `higgsfield-ai/skills (local clone)/higgsfield-soul-id/references/troubleshooting.md`
  - `MD` = `<scratchpad>`
  - `OI` = Comfy Cloud `GET /api/object_info`, saved on 2026-10-29 at `<scratchpad>` (3,857 node classes). This file is a scratchpad snapshot, so re-fetch it to re-check.
  - `RD` = the main research doc, (private planning document, not published) (a Claude Docs doc, indexed from `docs/RESEARCH.md:5`). Citations use its block ids.
  - The Higgsfield platform contract (REST, SDK, CLI) is in `docs/RE-FINDINGS.md`. Citations of the form `RE-F Fn` point to finding ids there.
- Licence: the skills repo is MIT (`higgsfield-ai/skills (local clone)/LICENSE:1-3`). This spec paraphrases it and copies nothing. Nothing here comes from `higgsfield-ai/app-templates`, which has no licence and no Soul-training UI anyway (only the Soul 2 and Soul Cinema generation models; see `RE-F F26`).

## 1. Higgsfield Soul ID vs our Instant Soul

| | Higgsfield Soul ID (`HF`) | Open Soul Studio Instant Soul (`ours`) |
|---|---|---|
| What it is | A trained "Soul Character", a personalised model of one face (`SID:5-6`, `SID:21`) | A curated set of 3–6 reference crops plus a style card, with no training (`docs/PLAN.md:7`) |
| Input | 5–20 photos, 8–12 ideal (`PG:7-8`, `SID:44`) | The same guidance; we accept up to 20 and need at least 3 that pass QA (§3) |
| Time to ready | "Minutes", with polling kept silent (`SID:39`). The CLI's default wait timeout is 30 min (`SID:55`, `TS:22-24`). Higgsfield's product page claims about 3–5 min (`docs/PLAN.md:86`; `RD` block `.15557`) | Photo QA on CPU takes seconds. The optional identity preview is one Klein job; its time is not yet measured (`docs/spikes/klein-multiref.md:23`) |
| Price | $2.50 per training on the API (`RD` block `.14772`), or 25 credits (`RD` block `.15557`). Needs a paid Basic+ plan (`SID:32`, `SID:78`) | No training cost. Each generation costs the normal Comfy Cloud price |
| Output | An opaque id (`reference_id` / `custom_reference_id`) that Soul models consume (`SID:10-12`, `SID:67`) | `soul.json` plus PNG crops, as a folder or `.soul.zip` (§6) |
| Portability | No export or download operation exists in any public surface: the SDK has create, get and list only (`RE-F F17–F19`); the CLI has create, wait, list and get (`SID:51-73`). The weights stay on Higgsfield's servers. **Not exportable** (inferred from that absence; `RE-F F20`) | Fully portable. Any FLUX.2 Klein or H3 graph can consume it, on Cloud or self-hosted |
| Consumers | `text2image_soul_v2`, `soul_cinematic` via `--soul-id` (`MD:303`, `MD:324`), and Marketing Studio `custom` avatars | Klein multi-reference edit (Photoshoot, preview, Cards tiles with a person) and H3 reference-to-video (Motion) (§7) |
| Identity strength | Trained model, so likely stronger. Not measured by us | Zero-shot references. Weaker on unseen angles; gated by the identity eval (`docs/eval/identity.md`) |

**Why Instant only.** Comfy Cloud has no `SaveLoRA` node, so a trained LoRA can't leave the job that trained it (`docs/spikes/lora-training.md:6`, `:19`, `:71`). A "trained Soul you own" can't run on Cloud. Instant Soul gives the user the portable artefact instead: their own curated references.

## 2. Intake flow (UX behaviour)

1. **Name.** One word or short label (`SID:43`). It is used in the UI and in the bundle filename and is never sent to Comfy.
2. **Consent.** A required checkbox: "These are photos of me, or I have this person's permission." Without it, nothing uploads. (`ours`)
3. **Photos.** Drag and drop up to 20 files. The UI shows the guidance from §3.1 in our own words (variety of angles, lighting and expressions; a single sharp face; no sunglasses).
4. **Live QA, client-side.** Each thumbnail gets a status chip (pass, warn or reject) with a one-line reason as soon as it decodes (§4, tier A).
5. **Authoritative QA, server-side.** The same checks run again on the server, together with dedup across the whole set (§4, tier B). Server results override client results.
6. **Selection.** The 3–6 best crops are chosen automatically (§5). The user can swap one in or out. The rules from §3.3 still apply.
7. **Style card.** Prefilled where possible; the user confirms or edits it (§6.3).
8. **Preview (optional, default on).** One Klein multi-reference job renders an identity preview sheet (`contract`: `SoulRequest.preview`).
9. **Save.** The Soul is stored locally (§8). The user can export it as a `.soul.zip` bundle.

The ready message says the Soul's name ("Soul *name* ready"). It never shows raw ids (mirrors `SID:36`).

## 3. Photo rules

### 3.1 Higgsfield's rules (`HF`)

| Rule | Source |
|---|---|
| 5 photos minimum, 20 maximum; 8–12 is best | `PG:7-8`, `SID:44` |
| Clear face with visible eyes; one person per photo; no heavy filters; no sunglasses | `PG:12-14` |
| Variety of angles (front, 3/4 left, 3/4 right, slightly up or down), lighting (indoor, outdoor, soft, harsh), expressions (neutral, smiling, talking) and distance (head, head-and-shoulders, full body) | `PG:16-23` |
| Sharp and in focus; ideally ≥1024×1024; JPEG or PNG | `PG:25-29` |
| Avoid group photos, unusual heavy makeup, costumes, hats over the face, and repeated poses | `PG:31-37` |
| Training fails with too few (<5) or too-similar photos, heavy occlusion (sunglasses, hats), group photos, or a non-image upload | `TS:9-16` |

### 3.2 How we enforce them (`ours`)

Each rule maps to an automated check (§4) with one of three outcomes:
- **reject**: the photo is excluded and gets a `PhotoQaReason` (`contract`).
- **warn**: the photo is kept but marked down.
- **advisory**: a hint for the whole set.

| HF rule | Our check | Outcome |
|---|---|---|
| JPEG/PNG; image upload, not video | Q1 type sniff | reject `unsupported_type` |
| ≥1024 px ideal | Q2 resolution | warn below 1024 on the short side; reject `too_small` below 512 |
| One person per photo; no group photos | Q7 face count | reject `multiple_faces` / `no_face` |
| Clear, visible face | Q7 face size, Q8 landmarks | reject `face_too_small`; warn if eyes are not found |
| Sharp, in focus | Q4 Laplacian variance | reject `blurry` below the hard threshold; warn in the band above it |
| Same pose repeated; too uniform | Q6 pHash, Q9 pose bucket | reject `duplicate` for near-identical photos; warn for the same pose |
| No sunglasses, hats or heavy filters | Q8 (eye landmarks) plus a reminder in the UI | warn only. We do not reject on a heuristic |
| Varied lighting | Q5 exposure; selection diversity (§5) | advisory |
| 5–20 photos, 8–12 ideal | Set-level checks (§3.3) | see §3.3 |

### 3.3 Set-level rules (`ours`)

- **More than 20 files:** only the first 20 are processed. The UI says so.
- **Fewer than 3 photos pass QA:** the Soul cannot be created (`contract`: `SOUL_MIN_REFS = 3`). The UI lists each rejection reason and asks for more photos. This mirrors HF's "swap in better photos and retry" (`TS:16`).
- **3–4 photos pass:** allowed, with an advisory: "Higgsfield asks for at least 5. More variety gives better likeness."
- **No pose variety** (every photo in one pose bucket, Q9): advisory to add 3/4 views.
- **Contract mismatch:** `SoulRequest.photos` is documented as "3–12 candidate photos" (`lib/types.ts:359`). HF allows up to 20. We propose raising the documented cap to 20 (§10).

## 4. Automated photo QA (runs without a GPU)

All checks run on CPU. EXIF orientation is applied first. All coordinates are in pixels of the oriented image.

**Tiers:**
- **Tier A (browser, live):** Q1, Q2, Q3, Q4, Q6 and Q7 use canvas pixels plus the in-browser MediaPipe face detector.
- **Tier B (server, authoritative):** every check, run in the Node API route with `sharp` (decode, resize, greyscale, raw pixels) plus a server-side face detector (§4.2). The checks are pure pixel math, so Q2–Q6 need no ML.

Thresholds marked *(calibrate)* are starting values. Wave 2 tunes them on the golden face set (Wave 1 agent 11) and records the final values in `lib/soul/qa.ts`.

### 4.1 Checks

| # | Check | Method | Thresholds | Result |
|---|---|---|---|---|
| Q1 | Type | Sniff magic bytes, not the extension. Accept JPEG and PNG; also WebP (converted to PNG). Reject HEIC with an advisory to export as JPEG. Max file size 25 MB. The file must decode | — | reject `unsupported_type` |
| Q2 | Resolution | Short side of the oriented image | ≥1024 pass; 512–1023 warn; <512 reject | `too_small` |
| Q3 | Aspect | Long side ÷ short side | ≤3.0 pass; >3.0 warn (cropping fixes it; no reason code) | warn |
| Q4 | Blur | Variance of the 3×3 Laplacian on the **face crop** (greyscale, resized so the short side is 512). Measuring the face, not the whole frame, avoids penalising portrait bokeh | <60 reject; 60–120 warn; >120 pass *(calibrate)* | `blurry` |
| Q5 | Exposure | Mean luma (Rec.601) in the face box, plus the share of clipped pixels (≤5 or ≥250) | Mean outside 50–210, or >8% clipped → warn | warn |
| Q6 | Duplicates | (a) SHA-256 of the decoded pixels, for exact duplicates. (b) 64-bit DCT pHash (32×32 greyscale → top-left 8×8 DCT → median threshold) of the face crop, stored as 16 hex chars (`contract`: `SoulRef.phash`). Hamming distance between each pair in the set | Exact duplicate, or distance ≤6 → reject the lower-scoring photo as `duplicate`; distance 7–12 → warn "same pose" *(calibrate)* | `duplicate` |
| Q7 | Face count and size | Face detector (§4.2), score ≥0.5. Count faces whose box area is ≥25% of the largest face's. Smaller faces count as background people: they are ignored and the crop excludes them | 0 faces → `no_face`; ≥2 significant faces → `multiple_faces`; largest face short side <160 px → `face_too_small`; 160–255 → warn | reject |
| Q8 | Eyes and occlusion | From landmarks, when the detector gives them: both eye keypoints present and inside the box. MediaPipe's landmarker also gives blendshapes (eye blink) | Eyes missing → warn "face partly covered (sunglasses or hat?)" | warn |
| Q9 | Pose bucket | Yaw estimate from keypoints: horizontal offset of the nose from the eye midpoint, divided by the eye distance | \|r\| <0.15 front; 0.15–0.45 three-quarter (left or right by sign); >0.45 profile. Used for diversity, not rejection | metadata |
| Q10 | Framing | Face box height ÷ image height | >0.6 "tight head shot"; <0.12 "full body" (HF wants a mix of distances, `PG:23`) | metadata |

**QA score** (0..1, stored as `SoulRef.qaScore`, `contract`):

> 0.35 · sharpness + 0.25 · faceSize + 0.15 · exposure + 0.15 · frontalness + 0.10 · detectorScore

Each term is normalised to 0..1:
- sharpness = clamp((lapVar − 60) / 240)
- faceSize = clamp((faceShort − 160) / 352)
- exposure = 1 − |meanLuma − 128| / 128, then 0 if clipped >8%
- frontalness = 1 − min(|r| / 0.6, 1)

### 4.2 Face detector options

The detector choice is the only part of QA that needs a model. Verified options:

| Option | Where it runs | Notes | Use |
|---|---|---|---|
| **MediaPipe Tasks Vision `FaceDetector` (BlazeFace short-range)** | Browser (WASM/CPU) | Apache-2.0. Gives a box plus 6 keypoints (eyes, nose, mouth, ears), enough for Q7–Q9. Runs in milliseconds per image, so live feedback works | **Tier A default** |
| **OpenCV YuNet ONNX** via `onnxruntime-node` | Server CPU | Small model, about 0.3 MB. Gives a box plus 5 landmarks. opencv_zoo lists it as MIT; **verify the licence before vendoring** | **Tier B default** |
| Cloud core `LoadMediaPipeFaceLandmarker` + `MediaPipeFaceLandmarker` (`comfy_extras.nodes_mediapipe`) | Comfy Cloud job | In `OI`. The model combo includes `mediapipe_face_fp32.safetensors`. Inputs: `num_faces` (default 1; 0 = no cap; max 16), `min_confidence` (default 0.5), `detector_variant` short/full/both. Outputs `FACE_LANDMARKS` and `BOUNDING_BOX`. Core node, so it also works self-hosted | Optional second opinion. It can be folded into the preview job (same submission, no extra job). Costs a paid-tier submission |
| Cloud core `SAM3_Detect` (text-prompted "face") | Comfy Cloud job | In `OI`; outputs masks and boxes. Heavier than needed for counting faces | Not used for QA |
| Cloud custom `BBoxDetect(FaceParsing)` with `bbox/face_yolov8{m,n}.pt` | Comfy Cloud job | In `OI`, but a custom node (not in core ComfyUI self-hosted). Ultralytics YOLOv8 weights are AGPL-3.0 | **Avoid** (licence) |
| Cloud custom `FaceSegment` (comfyui-rmbg), `FaceParse(FaceParsing)` | Comfy Cloud job | In `OI`. Skin and hair masks; could feed automatic style-card colour hints | Optional, Wave 3 at most |
| WAS `Image Crop Face` (Haar cascade) | Comfy Cloud job | In `OI`. Low accuracy on non-frontal faces | No |

**Decision (`ours`):** use MediaPipe in the browser and YuNet on the server. Both are CPU-only, need no Cloud submission, and work on the free tier and offline. The Cloud MediaPipe node is an optional extra check that runs inside the preview job.

## 5. Choosing the 3–6 reference crops (`ours`)

### 5.1 Crop

From the largest face box `(fx, fy, fw, fh)`, cut a head-and-shoulders crop:
- **Width:** `2.2·fw`.
- **Aspect:** 4:5, so height = width × 1.25.
- **Horizontal position:** centred on the face.
- **Vertical position:** the face centre sits at 42% of the crop height, which leaves room for hair.
- **Clamping:** clamp to the image. If clamping breaks the aspect, shrink the other side instead of padding.
- **Minimum size:** if the crop's short side is under 512 px, widen it, up to the whole image.
- **Background faces:** must not enter the crop. If they would, tighten towards the main face, down to `1.6·fw`.

Store the crop box in source pixels (`contract`: `CropBox`). Save the crop as PNG, resized so its long side is at most 1024 px. Klein resizes references to about 1 MP anyway (`docs/spikes/klein-multiref.md:69`).

The background is **not** removed: context helps identity and it saves a Cloud job. BiRefNet cutout (`docs/spikes/cutout-upscale.md:15-17`) is available later as a per-use option, for example a person composite on Cards.

### 5.2 Selection

This is greedy, max-coverage selection over photos that passed QA:
1. **`refs[0]`** is the anchor: the highest QA score among `front` photos, or the highest overall if there are none. It is the slot used whenever only one ref fits (H3 `<Picture 1>`, single-ref edits).
2. **Each next ref** is the candidate that maximises `qaScore + 0.15·newPoseBucket + 0.10·newLightingCluster + 0.05·newFraming − 0.3·[minHamming < 16]`:
   - `newPoseBucket`: from Q9.
   - `newLightingCluster`: k-means with k=3 on (mean luma, warm/cool ratio) of the face box.
   - `newFraming`: from Q10.
3. **Stop** at 6 refs (`contract`: `SOUL_MAX_REFS`), or when the best remaining candidate scores below 0.35.
4. **Fewer than 3:** the Soul cannot be created (§3.3).
5. **Order:** refs are stored best-first (`contract`), so slot order in §7 is deterministic.

The user can pin or unpin refs in the wizard. Pinned refs skip step 2 but still need to pass QA.

## 6. `soul.json`: the portable format

### 6.1 Bundle layout

```
<name>.soul/            (or <name>.soul.zip with the same tree)
  soul.json
  refs/ref_0.png … ref_5.png
  preview.png           (optional identity sheet)
```

Inside a bundle each ref has a `path` relative to `soul.json`. In the server registry each ref has an `assetId` instead (`contract`: `SoulRef` holds exactly one of the two). Original photos are **never** in a bundle.

### 6.2 Fields

| Field | Type | Status | Notes |
|---|---|---|---|
| `schema` | `"open-soul-studio/soul@1"` | contract | Bump the version on breaking changes. Readers reject unknown majors |
| `id` | string (UUID v4) | contract | Generated locally. Not a Higgsfield id |
| `name` | string | contract | From intake step 1 |
| `createdAt` | ISO-8601 | contract | Named `created` in the Wave 1 brief; the contract name wins |
| `refs[]` | 3–6 × `SoulRef` | contract | Best-first |
| `refs[].crop` | `{x,y,width,height}` | contract | Source pixels, top-left origin, after EXIF orientation |
| `refs[].phash` | 16 hex chars | contract | Q6 pHash of the crop |
| `refs[].qaScore` | 0..1 | contract | §4.1 |
| `refs[].sha256` | 64 hex chars | contract (required) | Hash of the PNG file. Integrity check on import, and the asset-cache key (§7.1 Upload) |
| `refs[].pose` | `front`/`three_quarter_left`/`three_quarter_right`/`profile` | **proposed** | Q9. Lets prompt builders say "image 2 shows her left profile" |
| `styleCard.description` | string ≤400 chars | contract | Appended to every prompt that uses the Soul |
| `styleCard.traits` | `{skinTone, hair, eyes, faceShape, ageRange, accessories, wardrobe}` (all optional) | contract | Plain descriptors, for example `hair: "shoulder-length curly dark auburn"` |
| `styleCard.keep[]` | string[] | contract | Features that must never change ("small mole above left lip") |
| `preferredAspect` | `AspectRatio` | **proposed** | Default output aspect for this Soul, for example `4:5` for portraits. Defaults to the aspect of `refs[0]`, snapped to the whitelist |
| `generator` | `{ model: string, workflow: string, app: string }` | **proposed** | What the Soul was curated for and tested with, for example `{model:"flux-2-klein-4b", workflow:"klein_edit_multiref", app:"open-soul-studio@0.1.0"}`. Informational: a Soul is plain images, so it works with other models too |

### 6.3 Style card

- **Default:** chips in the wizard (hair length and colour, eye colour, glasses yes/no, typical wardrobe), plus a free-text `keep` list. The user fills them in or confirms them.
- **No automatic labels for sensitive traits:** we do not infer ethnicity or exact age automatically. `skinTone` and `ageRange` are only filled from the user's own choice.
- **Optional auto-fill:** a VLM caption of `refs[0]` prefills hair, wardrobe and accessories for the user to confirm. Candidates in `OI`: `AILab_QwenVL` (custom node on Cloud) or a self-hosted open VLM. Off by default; Cloud only.
- **Rendering:** the `description` comes from `traits` with a fixed template ("a woman with shoulder-length curly dark auburn hair, hazel eyes, gold hoop earrings"), followed by `keep`.

### 6.4 Example

```json
{
  "schema": "open-soul-studio/soul@1",
  "id": "8d0b2f0e-3c3a-4b7e-9a51-2f6f3f0c9e11",
  "name": "maya",
  "createdAt": "2026-10-29T21:40:12Z",
  "refs": [
    { "path": "refs/ref_0.png", "crop": { "x": 412, "y": 180, "width": 880, "height": 1100 },
      "phash": "c3a1f0e07c3c1e0f", "qaScore": 0.91,
      "sha256": "…", "pose": "front" },
    { "path": "refs/ref_1.png", "crop": { "x": 96, "y": 240, "width": 760, "height": 950 },
      "phash": "93b1e4e07a3c5e0d", "qaScore": 0.84,
      "sha256": "…", "pose": "three_quarter_left" },
    { "path": "refs/ref_2.png", "crop": { "x": 300, "y": 120, "width": 1020, "height": 1275 },
      "phash": "c1e1b0f43c3c1a8f", "qaScore": 0.80,
      "sha256": "…", "pose": "three_quarter_right" }
  ],
  "styleCard": {
    "description": "a woman with shoulder-length curly dark auburn hair, hazel eyes, gold hoop earrings, charcoal t-shirt",
    "traits": { "hair": "shoulder-length curly dark auburn", "eyes": "hazel",
                "accessories": "gold hoop earrings", "wardrobe": "charcoal t-shirt" },
    "keep": ["small mole above the left lip"]
  },
  "preferredAspect": "4:5",
  "generator": { "model": "flux-2-klein-4b", "workflow": "klein_edit_multiref", "app": "open-soul-studio@0.1.0" }
}
```

### 6.5 Import

- Validate `schema`, the ref count (3–6), file presence, and `refs[].sha256` (required; each must equal the SHA-256 of its PNG file).
- Run Q1, Q2 and Q7 again on each ref. An imported bundle is untrusted input.
- Never execute or fetch anything named in a bundle. `path` must be relative, with no `..`.
- Import always uploads every ref to the current backend and assigns fresh `assetId`s. A bundle never carries `assetId`s or Comfy URLs.

### 6.6 S-R1: Soul reuse across separate jobs

A Soul counts as reusable only after this test passes (`docs/PLAN.md`, Update after Wave 0). The mock version runs in CI (`tests/e2e/soul.spec.ts`, mock scenario `asset_missing`); the Cloud version is a Wave 3 sign-off.

| Step | Action | Check |
|---|---|---|
| 1 | Create a Soul (job A: preview) | Soul saved with 3–6 refs, each with `sha256` |
| 2 | Export `.soul.zip` | Contains `soul.json` + `refs/ref_N.png`; no `assetId`s or Comfy URLs; every `refs[].sha256` matches its file |
| 3 | Cold restart | Stop the app, wipe `.data/souls/`, delete the cached Comfy assets |
| 4 | Import the `.soul.zip` | Refs re-uploaded; fresh `assetId`s cached |
| 5 | Photoshoot `closeup_product_with_person`, count 2, as separate job(s) B | Soul slots (image 1–3) bound to the imported refs; uploaded hashes match `refs[].sha256` |
| 6 | Motion, job C | `<Picture 1>` (node 137) bound to the Soul's `refs[0]` |
| 7 | Stale cache: make one cached `assetId` return 404, then run again | The run re-uploads that ref by `sha256` and succeeds with exactly one job submit |
| 8 | Optional: proxy-backend portability | Import the same bundle with `COMFY_BASE_URL` set; refs re-upload to the proxy |

**Pass criteria:** B and C succeed in separate requests after the restart; slot bindings and hashes match; step 7 recovers with no 4xx/5xx shown to the user. Identity is scored per the identity gate (`docs/eval/identity.md`).

## 7. How a Soul feeds the graphs

### 7.1 FLUX.2 Klein multi-reference edit (default)

Graph: `workflows/klein_edit_multiref.api.json`. Bindings are in `lib/bindings/klein_edit_multiref.ts`; node ids are from `docs/spikes/klein-multiref.md:58-83`.

| Slot (binding) | Node.field | `ReferenceMultiLatent` key | Prompt word (FLUX.2) | FLUX.3 token (flag only) |
|---|---|---|---|---|
| `image_1` | `54.image` | `images.image0` | "image 1" | `<ref_image_0>` |
| `image_2` | `60.image` | `images.image1` | "image 2" | `<ref_image_1>` |
| `image_3` | `61.image` | `images.image2` | "image 3" | `<ref_image_2>` |
| `image_4` | `62.image` | `images.image3` | "image 4" | `<ref_image_3>` |

**Prompt syntax.** FLUX.2 prompts name references in plain words ("image 1…4"), not with `<ref_image_N>` tokens (`docs/spikes/klein-multiref.md:83`). The `<ref_image_N>` tokens are 0-indexed and only apply to the FLUX.3 graph, which stays behind a flag (`docs/PLAN.md:6`, `docs/spikes/klein-multiref.md:31`). The prompt builder emits the right form for whichever model is active.

**Slot allocation (`ours`):**

| Use | Slots | Prompt pattern |
|---|---|---|
| Soul preview sheet | `refs[0..3]` → image 1–4 (fewer if the Soul has 3) | "the same person as in images 1, 2 and 3 …" plus `styleCard.description` |
| Photoshoot with a person (modes `closeup_product_with_person`, `virtual_model_tryout`, lifestyle with a person) | `refs[0..2]` → image 1–3; product cutout → image 4 | "the person from images 1–3 … holding the product from image 4" |
| Soul with 5–6 refs, no product | Add `LoadImage` nodes and keys `images.image4`, `images.image5`. The node accepts up to 100 (`docs/spikes/klein-multiref.md:73`) | "images 1–6" |
| Fewer slots needed | Drop the `images.imageN` key and its `LoadImage` node (`docs/spikes/klein-multiref.md:73`) | — |

**Reference resolution:** `17.resolution.megapixels`, default 1.0 (`docs/spikes/klein-multiref.md:69`). How the number of refs and their megapixels affect identity and cost is **not measured**: Wave 0 had zero runs (`docs/spikes/klein-multiref.md:3`, `:23`). Wave 2 should A/B 3 vs 4 vs 6 refs.

**Upload.** Each ref is uploaded once per Soul as a Comfy asset and its `assetId` cached in the registry. The cache key is (backend base URL, `sha256`); the Comfy assets API itself dedups by hash (`scratchpad/web/comfy-sdk/comfy-api-proxy/src/comfy_api_proxy/assets.py:6`, `:38`). Refs are set with `wf.set_input(node, "image", asset)` (`docs/spikes/klein-multiref.md:64`).

**Cache miss.** Before a submit that uses a Soul, check each cached asset (`GET /api/v2/assets/{id}`). If it is missing (404), or the backend base URL changed since it was cached, re-upload that ref from the local PNG and update the cache. This is one upload, never a job resubmit. Import always uploads and assigns fresh `assetId`s (§6.5). Test S-R1 (§6.6) covers it.

### 7.2 MiniMax H3 reference-to-video (Motion)

Graph: `workflows/h3_r2v.api.json`. Node ids are from `docs/spikes/h3-r2v.md:62-76`.

| Role | Node.field | Autogrow key | Prompt tag |
|---|---|---|---|
| Soul anchor = `refs[0]` | `137.image` | `ref_images.ref_image_0` | `<Picture 1>` |
| Product (optional) | `139.image` | `ref_images.ref_image_1` | `<Picture 2>` |
| Extra Soul refs (optional, `refs[1..]`) | new `LoadImage` → `136.ref_images.ref_image_2…8` | `ref_image_2..8` (up to 9 images) | `<Picture 3…>` (tag = index + 1; order is images, then videos, then audio) |

**Rules (`ours`, based on `docs/spikes/h3-r2v.md:100-106`):**
- The prompt builder tags every reference and gives it a role, for example "`<Picture 1>` is the woman: keep her face, hair … exactly". Insert `styleCard.description` and `keep` into that sentence.
- Turbo (4 steps, `146.value=true`) is the preview. The 20-step run with `136.ref_image_size = max` is the final render, because turbo weakens reference fidelity (`docs/PLAN.md:8`, `docs/spikes/h3-r2v.md:104`).
- Default to the anchor only. Add one extra Soul ref (a 3/4 view) only for clips with head turns. More refs is untested.

### 7.3 Higgsfield equivalents (for the comparison page)

On Higgsfield, the Soul is passed as `--soul-id`, which the CLI sends as `custom_reference_id` (`SID:67`). Only Soul models accept it (`text2image_soul_v2`, `soul_cinematic`; `MD:303`, `MD:324`). Those models take at most one extra image reference (`MD:307`, `MD:328`). Our Soul is plain images, so it works with any multi-reference model, and alongside a product reference.

## 8. Privacy and data handling (`ours`; Wave 3 reviewer #39 checks these, `docs/PLAN.md:188`)

1. **Local by default.**
   - Souls live on the app server under `${DATA_DIR:-.data}/souls/<id>/`, which is gitignored and outside `public/`.
   - Originals go to a temp directory during QA and are **deleted when QA finishes**. Only the 3–6 crops are kept.
   - No database, no third-party storage, no analytics on faces.
2. **Strip metadata.** Re-encode crops from raw pixels, which drops EXIF, GPS and maker notes. Only `crop` coordinates are kept.
3. **Minimal upload.**
   - Only the chosen crops (never originals) go to Comfy, as job input assets, and only when a job needs them.
   - The upload goes to the configured backend only: Comfy Cloud, or the self-hosted `comfy-api-proxy` (`COMFY_BASE_URL`).
   - Nothing goes to Higgsfield or any other service. QA needs no network.
4. **Delete on request.** `DELETE /api/souls/:id` does three things:
   - removes the local folder;
   - calls `DELETE /api/v2/assets/{id}` for each cached Comfy asset (Comfy API contract: 204 on success, 409 `asset_in_use` while a job's outputs reference it; `scratchpad/web/comfy-sdk/comfy-typescript-sdk/src/low/generated/types.gen.ts:386-425`);
   - retries 409s once the referencing jobs are gone, and reports any asset it couldn't delete.

   Comfy Cloud's own job and output retention is outside our control. **Gap:** not documented in the sources read; README must say so.
5. **No secrets or PII in logs.** Log Soul ids and hashes only. Never log file names, the user-given name, signed URLs or the API key. The key stays server-side (`docs/PLAN.md:178`).
6. **Export is the user's copy.** The `.soul.zip` holds crops plus `soul.json` only. The UI warns that anyone holding the bundle can generate this face.
7. **Consent and misuse.**
   - The consent checkbox is required (§2).
   - Don't ship a public gallery of Souls.
   - The demo uses only the consenting demo face set (Wave 1 agent 11).
8. **Eval faces.** Synthetic or consenting only; no scraped or celebrity images (`docs/eval/identity.md`).

## 9. Error and status vocabulary

| State | Shown as | Mirrors HF |
|---|---|---|
| QA rejects everything / fewer than 3 pass | "Need at least 3 usable photos": list reasons, offer to add more | `Training failed` advice (`SID:79`, `TS:9-16`) |
| Comfy submit 403 (free-tier key) | "Your Comfy Cloud plan doesn't allow API jobs; QA and saving still work, preview needs a paid key" | `Minimum Basic plan required` (`SID:78`) |
| Preview job failed or timed out | The Soul is still saved, marked "no preview"; offer a retry. Never auto-resubmit (`docs/PLAN.md` Known traps) | — |

## 10. Contract changes proposed (for the `lib/types.ts` owner)

1. `SoulRef.sha256: string` (done: required in `lib/types.ts`) and `SoulRef.pose?: "front" | "three_quarter_left" | "three_quarter_right" | "profile"`.
2. `Soul.preferredAspect?: AspectRatio` and `Soul.generator?: { model: string; workflow: string; app: string }`.
3. `SoulRequest.photos` doc comment: change "3–12" to "up to 20 (HF: 5–20, 8–12 ideal)".
4. `SoulRequest.consent: true` (required literal), so the API refuses requests without it.
5. Optional: a `PhotoQaWarning` union (`low_resolution`, `soft_focus`, `exposure`, `eyes_not_found`, `same_pose`, `background_faces`), so warnings are typed like rejections.

## 11. Open questions

- The blur, pHash and face-size thresholds need calibration on real photos. The golden face set does not exist yet (`docs/spikes/klein-multiref.md:104`).
- Identity quality of 3 vs 4 vs 6 refs on Klein 4B distilled, and 1 vs 2 refs on H3, has not been measured (0 Cloud runs in Wave 0). It is now decided by the identity gate (`docs/eval/identity.md`), not by eye.
- YuNet's licence and its packaging in `onnxruntime-node` need checking before vendoring.
- Higgsfield's claim of 20–80 photos in 3–5 min (`RD` block `.15557`) contradicts the skill's 5–20 (`PG:7`). We follow the skill, which is the public contract the CLI agent uses.
