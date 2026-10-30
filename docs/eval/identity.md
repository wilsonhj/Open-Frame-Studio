# Identity acceptance gate

Status: protocol, pre-registered on 2026-10-29 before any result exists. The thresholds below are fixed. Changing them after a run counts as a new protocol version, and every earlier attempt stays in the record.

**Question.** Does an Instant identity (curated refs, no training; `docs/PLAN.md`, Update after Wave 0) keep the person's identity across the surfaces we demo?

## 1. Test set (fixed)

- **Subjects:** N = 3 synthetic people generated with FLUX.2 Klein 4B distilled (`klein_t2i`) from fixed seeds and fixed prompts, recorded in `docs/eval/identity.json`. Vary age, sex and skin tone across the three. No real people and no lookalikes of real people (prompts never name a person).
- **Views:** 8–10 generated photos per subject (angles, lighting, framing as in `docs/spec/identity.md` §3.1). Photo QA (`docs/spec/identity.md` §4–5) picks the 3–6 refs, exactly as for a user.
- **Optional 4th subject:** a consenting real person, run only on a local machine from `E2E_FACES_DIR`. Their images and outputs never enter the repo, CI, or `identity.json` (only the aggregate counts may be reported).
- **Products:** from `fixtures/products/`.

## 2. Items per subject (M = 9)

| Surface | Items | Settings |
|---|---|---|
| Identity preview | 2 panels of the preview sheet | default `klein_edit_multiref` |
| Photoshoot `hands_on` | 2 | count 2 |
| Photoshoot `in_context` (with person) | 2 | count 2 |
| Photoshoot `on_model` | 2 | count 2 |
| H3 r2v (Motion) | 1 clip → middle frame (`ffmpeg -ss <duration/2> -frames:v 1`) | hero settings: 20–25 steps, not turbo |

Totals: 3 × 9 = **27 genuine items**, plus **9 decoys** (an output of subject A paired with refs of subject B, three per subject, spread over the surfaces). Seeds and prompts are fixed in `identity.json` before the run.

## 3. Primary measure: blind human review

- **Reviewers:** 2, working independently. Neither saw the generation runs.
- **Presentation:** each trial shows the subject's refs next to one output. Genuine items and decoys are shuffled together; the surface, mode and subject are hidden.
- **Question:** "Same person?" `yes` / `no` / `unsure`, plus an optional 1–5 likeness score.
- **Item pass:** both reviewers answer `yes`. `unsure` counts as not yes.
- **Validity check:** each reviewer must answer `no` on at least **8 of 9** decoys. If either does not, the review is invalid and is redone with another reviewer; the gate has no verdict until then.
- **Agreement:** report raw agreement and Cohen's kappa on the genuine items.
- **LLM or vision-model judges** may be run and logged, but never count toward the verdict.

## 4. Gate (pre-registered)

The gate **passes** if and only if all of these hold:
1. ≥ 80% of genuine items pass, i.e. **≥ 22 of 27**;
2. every surface passes **≥ 2/3** of its items (preview 6, each photoshoot mode 6, H3 3);
3. the review is valid (§3: each reviewer rejects ≥ 8/9 decoys).

Otherwise it fails. A failing surface is removed from the demo's identity claims (README, demo script, comparison page) until it passes.

## 5. Secondary measure: face-embedding cosine (advisory)

- **Pipeline (CPU, `onnxruntime`):** detect and align with OpenCV Zoo **YuNet** (MIT), embed with OpenCV Zoo **SFace** (Apache-2.0, `face_recognition_sface_2021dec.onnx`).
- **Score per item:** cosine to the mean ref embedding (`cosine_mean`), plus the max over single refs (`cosine_max`). `face_found: false` when YuNet finds no face (the item still goes to the reviewers).
- **Calibration:** on same-subject vs cross-subject pairs from this set, pick the threshold at FAR ≤ 5% (or the EER point if FAR ≤ 5% is unreachable). Report n, the ROC, the chosen threshold, and OpenCV's published SFace cosine threshold 0.363 for reference.
- **Never overrides the reviewers.** It is reported next to the verdict to flag disagreements and trends.
- **Not allowed:** InsightFace weights (non-commercial licence), YOLOv8-face (AGPL-3.0), LFW or any celebrity or scraped face images.

## 6. Outputs

- This file gets a **Results** section per attempt: date, protocol version, workflow hashes, verdict, per-surface table, kappa, calibration.
- `docs/eval/identity.json`:

```json
{
  "protocol": "identity@1",
  "items": [
    { "id": "s1-closeup-1", "subject": "s1", "surface": "photoshoot", "mode": "hands_on",
      "decoy": false, "prompt": "…", "seed": 123, "workflow_sha256": "…", "output_sha256": "…",
      "votes": [ { "reviewer": "r1", "same": "yes", "likeness": 4 }, { "reviewer": "r2", "same": "yes" } ],
      "cosine_mean": 0.52, "cosine_max": 0.61, "face_found": true }
  ],
  "calibration": { "n_same": 0, "n_cross": 0, "threshold": 0.0, "far": 0.0, "frr": 0.0, "roc": [], "reference_threshold": 0.363 },
  "gate": { "verdict": "pass|fail|invalid", "pass_rate": 0.0,
            "per_surface": { "preview": "0/6", "hands_on": "0/6", "in_context": "0/6",
                             "on_model": "0/6", "h3_r2v": "0/3" },
            "decoy_rejection": { "r1": "0/9", "r2": "0/9" }, "kappa": 0.0 }
}
```

- **Planned script (not implemented yet):** `scripts/eval-identity.mjs`, run as `pnpm eval:identity` (generate items, extract the H3 frame, compute SFace scores, build the blind review sheet, fold votes into `identity.json`). `pnpm eval:identity --check` exits non-zero unless the recorded verdict is `pass` **and** every `workflow_sha256` matches the current `workflows/*.api.json`, so a graph change invalidates an old pass.

## 7. When it blocks

- **Not in PR CI** (needs Cloud runs and human reviewers).
- **Required** at feature freeze (Wave 3 checkpoint), at the final verifier's sign-off (#47), and before tagging `v1.0.0`.
- **Tuning after a fail:** refs 4–6, slot count k, ref megapixels (`17.resolution.megapixels`), H3 `ref_image_size` and steps. Then re-run the **full** protocol (all 27 items + 9 decoys, fresh review). Every attempt, pass or fail, is recorded in Results.

## 8. Consent and data

- Eval faces are synthetic or from consenting people only. No scraped, celebrity or lookalike images.
- Synthetic subjects' images may be committed under `fixtures/` only if generated by the recorded seeds and prompts.
- A consenting subject's images stay local (`E2E_FACES_DIR`); consent is recorded outside the repo, and their files are deleted after the run unless they ask otherwise.

## Results

None yet.
