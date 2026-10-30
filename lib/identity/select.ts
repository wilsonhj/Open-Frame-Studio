/**
 * Choosing the 3–6 reference crops (docs/spec/identity.md §5.2): greedy
 * max-coverage over photos that passed QA. Pure: no I/O.
 */
import { IDENTITY_MAX_REFS, IDENTITY_MIN_REFS } from "../types.ts";
import { hamming, type Candidate } from "./qa.ts";

const STOP_BELOW = 0.35;

/**
 * Lighting cluster per candidate: k-means (k = 3, or fewer for small sets) on
 * (luma / 255, warmth), deterministically seeded from the sorted extremes.
 */
export function lightingClusters(cands: Candidate[]): Map<number, number> {
  const pts = cands.map((c) => ({ index: c.index, v: [(c.lighting?.luma ?? 128) / 255, c.lighting?.warmth ?? 1] as const }));
  const k = Math.min(3, pts.length);
  const out = new Map<number, number>();
  if (k === 0) return out;
  const sorted = [...pts].sort((a, b) => a.v[0] - b.v[0]);
  let centres = Array.from({ length: k }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / Math.max(1, k - 1))].v.slice());
  for (let iter = 0; iter < 10; iter++) {
    const sums = centres.map(() => [0, 0, 0]);
    for (const p of pts) {
      let best = 0;
      let bestD = Infinity;
      centres.forEach((c, i) => {
        const d = (p.v[0] - c[0]) ** 2 + (p.v[1] - c[1]) ** 2;
        if (d < bestD) [best, bestD] = [i, d];
      });
      out.set(p.index, best);
      sums[best][0] += p.v[0];
      sums[best][1] += p.v[1];
      sums[best][2]++;
    }
    centres = centres.map((c, i) => (sums[i][2] ? [sums[i][0] / sums[i][2], sums[i][1] / sums[i][2]] : c));
  }
  return out;
}

export type Selection = {
  /** Chosen candidates, best-first (refs[0] is the anchor). */
  chosen: Candidate[];
  /** True when fewer than IDENTITY_MIN_REFS passed: the identity can't be created. */
  tooFew: boolean;
  /** Set-level hints (§3.3). */
  advisories: string[];
};

/**
 * §5.2: anchor = best front photo (else best overall); then repeatedly the
 * candidate maximising qaScore + 0.15·newPose + 0.10·newLighting +
 * 0.05·newFraming − 0.3·[min Hamming to chosen < 16]; stop at 6 or below 0.35.
 * `pinned` indexes are taken first, in the given order (they still had to pass QA).
 */
export function selectRefs(cands: Candidate[], pinned: number[] = []): Selection {
  const advisories: string[] = [];
  if (cands.length < IDENTITY_MIN_REFS) {
    return { chosen: [], tooFew: true, advisories: [`Need at least ${IDENTITY_MIN_REFS} usable photos; ${cands.length} passed.`] };
  }
  if (cands.length < 5) advisories.push("Only a few photos passed. At least 5, with more variety, gives a better likeness.");
  if (new Set(cands.map((c) => c.pose)).size === 1) advisories.push("Every photo is the same pose: add three-quarter views.");

  const clusters = lightingClusters(cands);
  const remaining = [...cands].sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen: Candidate[] = [];
  const take = (c: Candidate) => {
    chosen.push(c);
    remaining.splice(remaining.indexOf(c), 1);
  };
  for (const index of pinned) {
    const c = remaining.find((r) => r.index === index);
    if (c && chosen.length < IDENTITY_MAX_REFS) take(c);
  }
  if (chosen.length === 0) take(remaining.find((c) => c.pose === "front") ?? remaining[0]);

  while (chosen.length < IDENTITY_MAX_REFS && remaining.length) {
    const poses = new Set(chosen.map((c) => c.pose));
    const lights = new Set(chosen.map((c) => clusters.get(c.index)));
    const framings = new Set(chosen.map((c) => c.framing));
    let best: Candidate | null = null;
    let bestValue = -Infinity;
    for (const c of remaining) {
      const minHamming = Math.min(...chosen.map((k) => hamming(c.phash, k.phash)));
      const value =
        c.score +
        (poses.has(c.pose) ? 0 : 0.15) +
        (lights.has(clusters.get(c.index)) ? 0 : 0.1) +
        (framings.has(c.framing) ? 0 : 0.05) -
        (minHamming < 16 ? 0.3 : 0);
      if (value > bestValue) [best, bestValue] = [c, value];
    }
    // Below the bar: stop, unless that would leave fewer than the minimum.
    if (!best || (bestValue < STOP_BELOW && chosen.length >= IDENTITY_MIN_REFS)) break;
    take(best);
  }
  return { chosen, tooFew: false, advisories };
}
