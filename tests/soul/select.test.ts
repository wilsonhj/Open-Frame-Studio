/** Reference selection (docs/spec/identity.md §5.2). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Candidate, Pose } from "../../lib/identity/qa.ts";
import { selectRefs } from "../../lib/identity/select.ts";

let n = 0;
function cand(score: number, pose: Pose, phash: string, luma = 128): Candidate {
  const index = n++;
  return {
    index,
    reason: null,
    warnings: [],
    score,
    pose,
    framing: "medium",
    lighting: { luma, warmth: 1 },
    crop: { x: 0, y: 0, width: 400, height: 500 },
    png: new Uint8Array(),
    sha256: index.toString(16).padStart(64, "0"),
    phash,
    pixelSha: String(index),
  };
}

describe("selectRefs", () => {
  it("refuses fewer than 3 passing photos", () => {
    const s = selectRefs([cand(0.9, "front", "0000000000000000"), cand(0.8, "front", "ffffffffffffffff")]);
    assert.equal(s.tooFew, true);
    assert.equal(s.chosen.length, 0);
  });

  it("anchors on the best front photo, then prefers new poses, and stops at 6", () => {
    const cands = [
      cand(0.95, "three_quarter_left", "0f0f0f0f0f0f0f0f"),
      cand(0.9, "front", "f0f0f0f0f0f0f0f0"),
      cand(0.7, "three_quarter_right", "00ff00ff00ff00ff"),
      cand(0.85, "front", "ff00ff00ff00ff00"),
      cand(0.6, "profile", "0000ffff0000ffff"),
      cand(0.8, "front", "ffff0000ffff0000"),
      cand(0.75, "front", "3333333333333333"),
      cand(0.74, "front", "cccccccccccccccc"),
    ];
    const s = selectRefs(cands);
    assert.equal(s.tooFew, false);
    assert.equal(s.chosen[0].pose, "front");
    assert.equal(s.chosen[0].score, 0.9);
    assert.ok(s.chosen.length <= 6 && s.chosen.length >= 3);
    const poses = new Set(s.chosen.slice(0, 4).map((c) => c.pose));
    assert.ok(poses.size >= 3, "early picks cover new poses");
  });

  it("penalises near-duplicates of an already chosen ref", () => {
    const anchor = cand(0.9, "front", "0000000000000000");
    const twin = cand(0.89, "front", "0000000000000001");
    const other = cand(0.7, "front", "ffffffffffffffff");
    const third = cand(0.6, "front", "f0f0f0f0f0f0f0f0");
    const s = selectRefs([anchor, twin, other, third]);
    assert.equal(s.chosen[1].index, other.index);
  });

  it("advises when every photo is one pose or the set is small", () => {
    const s = selectRefs([cand(0.9, "front", "0000000000000000"), cand(0.8, "front", "ffffffffffffffff"), cand(0.7, "front", "f0f0f0f0f0f0f0f0")]);
    assert.ok(s.advisories.some((a) => /same pose/.test(a)));
    assert.ok(s.advisories.some((a) => /At least 5/i.test(a)));
  });

  it("takes pinned refs first", () => {
    const a = cand(0.9, "front", "0000000000000000");
    const b = cand(0.5, "front", "ffffffffffffffff");
    const c = cand(0.6, "front", "f0f0f0f0f0f0f0f0");
    const s = selectRefs([a, b, c], [b.index]);
    assert.equal(s.chosen[0].index, b.index);
  });
});
