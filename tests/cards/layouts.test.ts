import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import { CARD_SPECS, assetFileName, expandAssets, missingCopy } from "../../lib/cards/assets.ts";
import { Canvas, INK, TextFitError, contrastRatio, luminance, WHITE } from "../../lib/cards/canvas.ts";
import { renderCard, type LayoutInput } from "../../lib/cards/layouts.ts";
import { MIN_FONT_SQUARE, MIN_FONT_STORY, SAFE_MARGIN_SQUARE, SAFE_MARGIN_STORY } from "../../lib/cards/sizes.ts";
import type { CardAssetId, CardsRequest } from "../../lib/types.ts";
import { CARD_ASSETS } from "../../lib/types.ts";

async function solid(w: number, h: number, rgb: [number, number, number], alpha = 255): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: alpha / 255 } } })
      .png()
      .toBuffer(),
  );
}

const FULL: CardsRequest = {
  scope: "complete",
  productImages: [{ assetId: "a" }],
  productName: "Hydra Serum",
  brandName: "Aster",
  tagline: "Glow that lasts all day",
  bullets: ["Hydrates for 24 hours", "Fragrance free", "Dermatologist tested", "Vegan formula"],
  specs: [{ label: "Volume", value: "30 ml" }],
  ingredients: [{ name: "Hyaluronic acid", amount: "2%", benefit: "hydration" }, { name: "Niacinamide" }],
  boxContents: [{ qty: 1, name: "Serum bottle" }, { qty: 1, name: "Dropper" }],
  painPoints: [
    { problem: "Dry, tight skin", solution: "Lasting hydration" },
    { problem: "Dull complexion", solution: "Visible glow" },
  ],
  efficacyClaims: [{ value: "92%", label: "felt more hydrated" }, { value: "24h", label: "moisture" }],
  efficacySource: "Consumer test, 50 women, 4 weeks",
  howToUse: ["Cleanse", "Apply 3 drops", "Massage in"],
  endorsement: { type: "review", text: "My skin has never felt this soft.", by: "Maya, verified buyer", rightsConfirmed: true },
  brandColors: ["#2b5d8a", "#e8b04b"],
};

async function input(request: CardsRequest = FULL, generated = 1): Promise<LayoutInput> {
  const scene = await solid(1024, 1024, [180, 160, 140]);
  return {
    request,
    anchor: await solid(300, 600, [40, 90, 160]),
    generated: Array.from({ length: generated }, () => scene),
    palette: { primary: [43, 93, 138], secondary: [232, 176, 75] },
  };
}

describe("CARD_SPECS and scope expansion (T-S1, T-S2)", () => {
  it("has a spec for every asset, square or story sized", () => {
    for (const a of CARD_ASSETS) {
      const s = CARD_SPECS[a];
      assert.equal(s.id, a);
      assert.ok(s.exportPx);
      assert.deepEqual(s.exportPx, a.startsWith("story_") ? [1464, 600] : [2000, 2000]);
    }
  });

  it("expands scopes to 1 / 6 / 8 / 13 assets in §2 order", () => {
    const base = { productImages: [{ assetId: "a" }] };
    assert.deepEqual(expandAssets({ ...base, scope: "hero" }), ["hero"]);
    assert.equal(expandAssets({ ...base, scope: "gallery" }).length, 6);
    assert.equal(expandAssets({ ...base, scope: "story" }).length, 8);
    assert.deepEqual(expandAssets({ ...base, scope: "complete" }), [...CARD_ASSETS]);
    assert.deepEqual(expandAssets({ ...base, assets: ["story_banner", "gallery_callouts", "story_banner"] }), [
      "hero",
      "gallery_callouts",
      "story_banner",
    ]);
  });

  it("names files NN_<asset_id>.<ext> (G6)", () => {
    assert.equal(assetFileName("gallery_callouts"), "02_gallery_callouts.png");
    assert.equal(assetFileName("gallery_in_use"), "05_gallery_in_use.jpg");
    assert.equal(assetFileName("story_social_proof"), "13_story_social_proof.png");
  });

  it("lists missing copy, and an unconfirmed endorsement counts as missing (G7, T-T4)", () => {
    const bare: CardsRequest = { productImages: [{ assetId: "a" }] };
    assert.deepEqual(missingCopy("story_results", bare), ["efficacyClaims", "efficacySource"]);
    assert.deepEqual(missingCopy("story_materials", bare), ["ingredients|specs"]);
    assert.deepEqual(missingCopy("story_materials", { ...bare, specs: [{ label: "a", value: "b" }] }), []);
    assert.deepEqual(missingCopy("gallery_in_use", bare), []);
    const unconfirmed = { ...FULL, endorsement: { ...FULL.endorsement!, rightsConfirmed: false } };
    assert.deepEqual(missingCopy("story_social_proof", unconfirmed), ["endorsement"]);
  });
});

/** 10th-percentile contrast of `ink` against the RGB pixels 2–4 px outside `box`. */
function ringContrast(pixels: Buffer, w: number, h: number, box: { x: number; y: number; w: number; h: number }, ink: [number, number, number]): number {
  const inkL = luminance(ink);
  const ratios: number[] = [];
  const x0 = Math.floor(box.x) - 4;
  const y0 = Math.floor(box.y) - 4;
  const x1 = Math.ceil(box.x + box.w) + 4;
  const y1 = Math.ceil(box.y + box.h) + 4;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const inside = x >= box.x - 2 && x < box.x + box.w + 2 && y >= box.y - 2 && y < box.y + box.h + 2;
      if (inside || x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 3;
      ratios.push(contrastRatio(inkL, luminance([pixels[i], pixels[i + 1], pixels[i + 2]])));
    }
  }
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length * 0.1)];
}

describe("layouts", () => {
  const generatedCount: Partial<Record<CardAssetId, number>> = { gallery_angles: 3 };
  for (const asset of CARD_ASSETS) {
    if (asset === "hero") continue;
    it(`${asset}: export size, RGB, text inside the safe area with ≥4.5:1 contrast (T-G1, G8, G9)`, async () => {
      const spec = CARD_SPECS[asset];
      const out = await renderCard(asset, await input(FULL, spec.diffusion === "none" ? 0 : (generatedCount[asset] ?? 1)));
      const meta = await sharp(out.bytes).metadata();
      assert.deepEqual([meta.width, meta.height], spec.exportPx);
      assert.equal(meta.channels, 3);
      assert.equal(meta.format, spec.format);
      const story = asset.startsWith("story_");
      const margin = story ? SAFE_MARGIN_STORY : SAFE_MARGIN_SQUARE;
      const [w, h] = spec.exportPx!;
      const pixels = await sharp(out.bytes).raw().toBuffer();
      for (const t of out.texts) {
        // Measured on the written card, not the number the renderer reported:
        // the ink against the pixels in a thin ring just outside the text.
        const measured = ringContrast(pixels, w, h, t.bounds, t.color);
        assert.ok(measured >= 4.5, `${asset}: measured contrast ${measured.toFixed(2)} (reported ${t.contrast.toFixed(2)})`);
        assert.ok(t.size >= (story ? MIN_FONT_STORY : MIN_FONT_SQUARE), `${asset}: ${t.size}px text`);
        assert.ok(t.bounds.x >= margin - 1 && t.bounds.y >= margin - 1, `${asset}: text at ${t.bounds.x},${t.bounds.y}`);
        assert.ok(t.bounds.x + t.bounds.w <= w - margin + 1 && t.bounds.y + t.bounds.h <= h - margin + 1, `${asset}: text past the safe area`);
      }
    });
  }

  it("draws every typed bullet on the callouts card and nothing on the in-use card", async () => {
    const callouts = await renderCard("gallery_callouts", await input());
    // headline + 4 bullets
    assert.equal(callouts.texts.length, 5);
    const inUse = await renderCard("gallery_in_use", await input());
    assert.equal(inUse.texts.length, 0);
  });

  it("fails a bullet too long for its box, naming the field (T-T1)", async () => {
    const long = { ...FULL, bullets: [...FULL.bullets!.slice(0, 2), "x".repeat(40).split("").join(" ").repeat(12)] };
    await assert.rejects(renderCard("gallery_callouts", await input(long)), (err: unknown) => {
      assert.ok(err instanceof TextFitError);
      assert.equal(err.field, "bullets[2]");
      assert.ok(err.budget > 0);
      return true;
    });
  });

  it("adds a scrim when text would sit on a white background (T-T2)", async () => {
    const c = await Canvas.create(800, 400, WHITE);
    const placed = await c.text("Bright on bright", { x: 40, y: 40, w: 600, h: 200 }, {
      field: "t",
      maxSize: 60,
      minSize: 30,
      color: [250, 250, 250],
    });
    assert.ok(placed.scrim);
    assert.ok(placed.contrast >= 4.5);
    assert.ok(contrastRatio(luminance(WHITE), luminance([17, 17, 17])) > 4.5);
  });

  it("measures white text against the brightest background, so mostly light grey gets a scrim (T-T2)", async () => {
    const c = await Canvas.create(800, 400, [235, 235, 235]);
    // A dark stripe under the first letters: the best-case pixels behind
    // white text, which must not decide its contrast.
    await c.rect({ x: 40, y: 40, w: 60, h: 200 }, [10, 10, 10]);
    const box = { x: 40, y: 40, w: 600, h: 200 };
    const white = await c.text("White on light grey", box, { field: "t", maxSize: 60, minSize: 30, color: WHITE });
    assert.ok(white.scrim, `white on (235,235,235) reported ${white.contrast.toFixed(2)} with no scrim`);
    assert.ok(white.contrast >= 4.5);
    // Left to choose, it picks ink, which reads on light grey without a scrim.
    const auto = await (await Canvas.create(800, 400, [235, 235, 235])).text("Ink on light grey", box, { field: "t", maxSize: 60, minSize: 30 });
    assert.deepEqual(auto.color, INK);
    assert.equal(auto.scrim, false);
    assert.ok(auto.contrast >= 4.5);
  });

  it("adds a scrim when the background is half black, half white (no ink reads on both)", async () => {
    const c = await Canvas.create(800, 400, WHITE);
    await c.rect({ x: 0, y: 0, w: 400, h: 400 }, [0, 0, 0]);
    const placed = await c.text("Split background", { x: 100, y: 100, w: 600, h: 200 }, { field: "t", maxSize: 60, minSize: 30 });
    assert.ok(placed.scrim, `split background reported ${placed.contrast.toFixed(2)} with no scrim`);
    assert.ok(placed.contrast >= 4.5);
  });
});
