/**
 * Per-asset code layouts for Listing Images (docs/spec/listing.md §4.2). Each
 * is a function of the request, the anchor cutout (R-A1) and any diffusion
 * images; all copy is drawn in code (G1), only from what the user typed (G7).
 */
import type { CardAssetId, CardsRequest } from "../types.ts";
import { CARD_SPECS } from "./assets.ts";
import { Canvas, INK, WHITE, hexToRgb, luminance, mix, type Box, type Rgb, type TextPlacement } from "./canvas.ts";
import {
  MIN_FONT_SQUARE,
  MIN_FONT_STORY,
  SAFE_MARGIN_SQUARE,
  SAFE_MARGIN_STORY,
  SQUARE_PX,
  STORY_PX,
} from "./sizes.ts";

export type Palette = { primary: Rgb; secondary: Rgb };

export type LayoutInput = {
  request: CardsRequest;
  /** The anchor: the main cutout, RGBA, trimmed to its alpha bbox. */
  anchor: Uint8Array;
  /** Diffusion outputs for this asset, in step order (may be empty). */
  generated: Uint8Array[];
  palette: Palette;
};

export type LayoutResult = { bytes: Uint8Array; texts: TextPlacement[]; width: number; height: number };

type Layout = (input: LayoutInput) => Promise<Canvas>;

/** A very light tint of a brand colour, for card backgrounds. */
function tint(c: Rgb, t = 0.88): Rgb {
  return mix(c, WHITE, t);
}

/** A brand colour dark enough to carry white text (scrim panels, badges). */
function deep(c: Rgb): Rgb {
  let out = c;
  for (let i = 0; i < 8 && luminance(out) > 0.18; i++) out = mix(out, INK, 0.25);
  return out;
}

const SQ = { w: SQUARE_PX[0], h: SQUARE_PX[1], m: SAFE_MARGIN_SQUARE, min: MIN_FONT_SQUARE };
const ST = { w: STORY_PX[0], h: STORY_PX[1], m: SAFE_MARGIN_STORY, min: MIN_FONT_STORY };

/** Stack text blocks top to bottom inside `box`, each up to `maxH` tall. */
async function column(
  canvas: Canvas,
  box: Box,
  blocks: { text: string; field: string; maxSize: number; minSize: number; weight?: 400 | 500 | 600 | 700; maxH: number; family?: "Inter" | "Playfair Display"; dot?: Rgb }[],
  gap: number,
  scrim: Rgb,
): Promise<void> {
  let y = box.y;
  for (const b of blocks) {
    const indent = b.dot ? Math.round(b.minSize * 1.6) : 0;
    if (b.dot) await canvas.badge(box.x + indent / 3, y + b.minSize * 0.75, b.minSize / 3, b.dot);
    const placed = await canvas.text(
      b.text,
      { x: box.x + indent, y, w: box.w - indent, h: Math.min(b.maxH, box.y + box.h - y) },
      { field: b.field, maxSize: b.maxSize, minSize: b.minSize, weight: b.weight, family: b.family, scrim },
    );
    y += placed.bounds.h + gap;
  }
}

const hero: Layout = async () => {
  throw new Error("hero is composed by compose_main, not a layout");
};

/** Brand background; pasted product left ~55%; headline + 3–5 call-outs right. */
const callouts: Layout = async ({ request, anchor, palette }) => {
  const c = await Canvas.create(SQ.w, SQ.h);
  await c.gradient(tint(palette.primary, 0.9), tint(palette.secondary, 0.75));
  await c.image(anchor, { x: SQ.m, y: SQ.m, w: SQ.w * 0.55 - SQ.m, h: SQ.h - 2 * SQ.m });
  const right: Box = { x: SQ.w * 0.58, y: SQ.m + 60, w: SQ.w * 0.42 - SQ.m, h: SQ.h - 2 * SQ.m - 60 };
  await column(
    c,
    right,
    [
      { text: request.productName ?? "", field: "productName", maxSize: 140, minSize: SQ.min, weight: 700, family: "Playfair Display", maxH: 360 },
      ...(request.bullets ?? []).slice(0, 5).map((b, i) => ({
        text: b,
        field: `bullets[${i}]`,
        maxSize: 72,
        minSize: SQ.min,
        weight: 500 as const,
        maxH: 190,
        dot: deep(palette.primary),
      })),
    ],
    48,
    deep(palette.primary),
  );
  return c;
};

/** 2×2 grid on light grey: tile 1 the pasted front, tiles 2–4 extra angles. */
const angles: Layout = async ({ anchor, generated }) => {
  const c = await Canvas.create(SQ.w, SQ.h, [247, 247, 247]);
  const gap = 40;
  const cell = (SQ.w - 2 * SQ.m - gap) / 2;
  const tiles = [anchor, ...generated.slice(0, 3)];
  for (const [i, bytes] of tiles.entries()) {
    const x = SQ.m + (i % 2) * (cell + gap);
    const y = SQ.m + Math.floor(i / 2) * (cell + gap);
    await c.rect({ x, y, w: cell, h: cell }, WHITE, { radius: 24 });
    await c.image(bytes, { x: x + 40, y: y + 40, w: cell - 80, h: cell - 80 });
  }
  return c;
};

/** Macro close-up full bleed, a circular inset of the pasted product, one optional call-out. */
const detail: Layout = async ({ request, anchor, generated, palette }) => {
  const c = await Canvas.create(SQ.w, SQ.h);
  if (generated[0]) await c.image(generated[0], { x: 0, y: 0, w: SQ.w, h: SQ.h }, "cover");
  const r = 300;
  const cx = SQ.w - SQ.m - r;
  const cy = SQ.h - SQ.m - r;
  await c.badge(cx, cy, r, WHITE);
  await c.image(anchor, { x: cx - r * 0.7, y: cy - r * 0.7, w: r * 1.4, h: r * 1.4 });
  const spec = request.specs?.[0];
  if (spec) {
    await c.text(`${spec.label}: ${spec.value}`, { x: SQ.m, y: SQ.m, w: SQ.w * 0.6, h: 260 }, {
      field: "specs[0]",
      maxSize: 72,
      minSize: SQ.min,
      weight: 600,
      scrim: deep(palette.primary),
    });
  }
  return c;
};

/** The diffusion scene, edge to edge; no code layer. */
const fullBleed: Layout = async ({ generated }) => {
  const c = await Canvas.create(SQ.w, SQ.h);
  if (generated[0]) await c.image(generated[0], { x: 0, y: 0, w: SQ.w, h: SQ.h }, "cover");
  return c;
};

/** Flat-lay of what's in the box, with `qty × name` labels in a bottom band. */
const contents: Layout = async ({ request, generated, palette }) => {
  const c = await Canvas.create(SQ.w, SQ.h);
  const band = 420;
  if (generated[0]) await c.image(generated[0], { x: 0, y: 0, w: SQ.w, h: SQ.h - band }, "cover");
  await c.rect({ x: 0, y: SQ.h - band, w: SQ.w, h: band }, tint(palette.primary, 0.85));
  const items = (request.boxContents ?? []).slice(0, 6);
  const colW = (SQ.w - 2 * SQ.m) / 2;
  for (const [i, item] of items.entries()) {
    await c.text(
      `${item.qty} × ${item.name}`,
      { x: SQ.m + (i % 2) * colW, y: SQ.h - band + 50 + Math.floor(i / 2) * 110, w: colW - 30, h: 100 },
      { field: `boxContents[${i}]`, maxSize: 56, minSize: SQ.min, weight: 600, scrim: deep(palette.primary) },
    );
  }
  return c;
};

/** Styled scene, product right; brand, title and optional tagline in a left panel. */
const banner: Layout = async ({ request, generated, palette }) => {
  const c = await Canvas.create(ST.w, ST.h, tint(palette.primary, 0.8));
  if (generated[0]) await c.image(generated[0], { x: 0, y: 0, w: ST.w, h: ST.h }, "cover");
  const panel: Box = { x: ST.m, y: ST.m + 40, w: ST.w * 0.4 - ST.m, h: ST.h - 2 * ST.m - 40 };
  const blocks = [
    ...(request.brandName ? [{ text: request.brandName.toUpperCase(), field: "brandName", maxSize: 30, minSize: ST.min, weight: 600 as const, maxH: 60 }] : []),
    { text: request.productName ?? "", field: "productName", maxSize: 64, minSize: ST.min, weight: 700 as const, family: "Playfair Display" as const, maxH: 200 },
    // Omitted when empty, never invented (§4.2).
    ...(request.tagline ? [{ text: request.tagline, field: "tagline", maxSize: 32, minSize: ST.min, weight: 400 as const, maxH: 110 }] : []),
  ];
  await column(c, panel, blocks, 18, deep(palette.primary));
  return c;
};

/** 2–3 problem → solution rows left; a mood image right. */
const problemSolution: Layout = async ({ request, generated, palette }) => {
  const c = await Canvas.create(ST.w, ST.h, tint(palette.primary, 0.9));
  if (generated[0]) await c.image(generated[0], { x: ST.w / 2, y: 0, w: ST.w / 2, h: ST.h }, "cover");
  const rows = (request.painPoints ?? []).slice(0, 3);
  const rowH = (ST.h - 2 * ST.m) / Math.max(rows.length, 1);
  for (const [i, p] of rows.entries()) {
    const y = ST.m + i * rowH;
    const w = ST.w / 2 - 2 * ST.m;
    await c.text(p.problem, { x: ST.m, y, w: w * 0.45, h: rowH - 12 }, {
      field: `painPoints[${i}].problem`, maxSize: 30, minSize: ST.min, weight: 500, scrim: deep(palette.primary),
    });
    await c.text("→", { x: ST.m + w * 0.46, y, w: w * 0.08, h: rowH - 12 }, {
      field: "arrow", maxSize: 30, minSize: ST.min, weight: 700, align: "centre", scrim: deep(palette.primary),
    });
    await c.text(p.solution, { x: ST.m + w * 0.55, y, w: w * 0.45, h: rowH - 12 }, {
      field: `painPoints[${i}].solution`, maxSize: 30, minSize: ST.min, weight: 700, scrim: deep(palette.primary),
    });
  }
  return c;
};

/** Pasted product centred; up to 4 feature tiles around it. */
const featureGrid: Layout = async ({ request, anchor, palette }) => {
  const c = await Canvas.create(ST.w, ST.h, tint(palette.primary, 0.9));
  await c.image(anchor, { x: ST.w * 0.36, y: ST.m, w: ST.w * 0.28, h: ST.h - 2 * ST.m });
  const feats = (request.bullets ?? []).slice(0, 4);
  const colW = ST.w * 0.32 - ST.m;
  const tileH = (ST.h - 2 * ST.m - 24) / 2;
  for (const [i, f] of feats.entries()) {
    const x = i % 2 === 0 ? ST.m : ST.w * 0.68;
    const y = ST.m + Math.floor(i / 2) * (tileH + 24);
    await c.rect({ x, y, w: colW, h: tileH }, WHITE, { radius: 18 });
    await c.badge(x + 40, y + 44, 20, deep(palette.primary), String(i + 1), ST.min);
    await c.text(f, { x: x + 76, y: y + 24, w: colW - 100, h: tileH - 48 }, {
      field: `bullets[${i}]`, maxSize: 28, minSize: ST.min, weight: 500, scrim: deep(palette.primary),
    });
  }
  return c;
};

/** Raw materials image left ~55%; ingredient list or spec table right, small product. */
const materials: Layout = async ({ request, anchor, generated, palette }) => {
  const c = await Canvas.create(ST.w, ST.h, tint(palette.primary, 0.92));
  if (generated[0]) await c.image(generated[0], { x: 0, y: 0, w: ST.w * 0.55, h: ST.h }, "cover");
  const rows = request.ingredients?.length
    ? request.ingredients.slice(0, 6).map((r, i) => ({
        text: [r.name, r.amount, r.benefit].filter(Boolean).join(" · "),
        field: `ingredients[${i}]`,
      }))
    : (request.specs ?? []).slice(0, 6).map((s, i) => ({ text: `${s.label}: ${s.value}`, field: `specs[${i}]` }));
  const x = ST.w * 0.58;
  const w = ST.w * 0.42 - ST.m - 150;
  await column(
    c,
    { x, y: ST.m, w, h: ST.h - 2 * ST.m },
    rows.map((r) => ({ ...r, maxSize: 26, minSize: ST.min, weight: 500 as const, maxH: 80, dot: deep(palette.primary) })),
    14,
    deep(palette.primary),
  );
  await c.image(anchor, { x: ST.w - ST.m - 140, y: ST.h - ST.m - 220, w: 140, h: 220 });
  return c;
};

/** 2–4 stat call-outs (big number + label), pasted product, mandatory footnote. */
const results: Layout = async ({ request, anchor, palette }) => {
  const c = await Canvas.create(ST.w, ST.h, tint(palette.primary, 0.9));
  await c.image(anchor, { x: ST.m, y: ST.m, w: ST.w * 0.24, h: ST.h - 2 * ST.m - 60 });
  const stats = (request.efficacyClaims ?? []).slice(0, 4);
  const x0 = ST.w * 0.3;
  const colW = (ST.w - x0 - ST.m) / Math.max(stats.length, 1);
  for (const [i, s] of stats.entries()) {
    const x = x0 + i * colW;
    await c.text(s.value, { x, y: ST.m + 80, w: colW - 24, h: 150 }, {
      field: `efficacyClaims[${i}].value`, maxSize: 96, minSize: ST.min, weight: 800, align: "centre", color: deep(palette.primary), scrim: deep(palette.primary),
    });
    await c.text(s.label, { x, y: ST.m + 250, w: colW - 24, h: 140 }, {
      field: `efficacyClaims[${i}].label`, maxSize: 28, minSize: ST.min, weight: 500, align: "centre", scrim: deep(palette.primary),
    });
  }
  await c.text(request.efficacySource ?? "", { x: x0, y: ST.h - ST.m - 56, w: ST.w - x0 - ST.m, h: 56 }, {
    field: "efficacySource", maxSize: ST.min, minSize: ST.min, weight: 400, scrim: deep(palette.primary),
  });
  return c;
};

/** 2–4 numbered steps left to right (the diffusion-off variant of §4.2). */
const howTo: Layout = async ({ request, anchor, palette }) => {
  const c = await Canvas.create(ST.w, ST.h, tint(palette.primary, 0.9));
  await c.image(anchor, { x: ST.m, y: ST.m, w: ST.w * 0.18, h: ST.h - 2 * ST.m });
  const steps = (request.howToUse ?? []).slice(0, 4);
  const x0 = ST.w * 0.24;
  const colW = (ST.w - x0 - ST.m) / Math.max(steps.length, 1);
  for (const [i, s] of steps.entries()) {
    const x = x0 + i * colW;
    await c.rect({ x, y: ST.m, w: colW - 24, h: ST.h - 2 * ST.m }, WHITE, { radius: 18 });
    await c.badge(x + (colW - 24) / 2, ST.m + 110, 64, deep(palette.primary), String(i + 1), ST.min);
    await c.text(s, { x: x + 24, y: ST.m + 210, w: colW - 72, h: ST.h - 2 * ST.m - 230 }, {
      field: `howToUse[${i}]`, maxSize: 30, minSize: ST.min, weight: 500, align: "centre", scrim: deep(palette.primary),
    });
  }
  return c;
};

/** A user-supplied quote or certification, drawn as a card; pasted product. */
const socialProof: Layout = async ({ request, anchor, palette }) => {
  const c = await Canvas.create(ST.w, ST.h, tint(palette.primary, 0.85));
  await c.image(anchor, { x: ST.m, y: ST.m, w: ST.w * 0.3, h: ST.h - 2 * ST.m });
  const e = request.endorsement;
  const card: Box = { x: ST.w * 0.38, y: ST.m + 20, w: ST.w * 0.62 - ST.m, h: ST.h - 2 * ST.m - 40 };
  await c.rect(card, WHITE, { radius: 28 });
  const kind = e?.type === "certification" ? "CERTIFIED" : e?.type === "expert" ? "EXPERT VIEW" : "CUSTOMER REVIEW";
  await column(
    c,
    { x: card.x + 48, y: card.y + 40, w: card.w - 96, h: card.h - 80 },
    [
      { text: kind, field: "endorsement.type", maxSize: 24, minSize: ST.min, weight: 700, maxH: 50 },
      { text: `“${e?.text ?? ""}”`, field: "endorsement.text", maxSize: 40, minSize: ST.min, weight: 400, family: "Playfair Display", maxH: 300 },
      { text: `— ${e?.by ?? ""}`, field: "endorsement.by", maxSize: 26, minSize: ST.min, weight: 600, maxH: 60 },
    ],
    18,
    deep(palette.primary),
  );
  return c;
};

export const LAYOUTS: Record<string, Layout> = {
  hero,
  callouts,
  angles,
  detail,
  full_bleed: fullBleed,
  contents,
  banner,
  problem_solution: problemSolution,
  feature_grid: featureGrid,
  materials,
  results,
  how_to: howTo,
  social_proof: socialProof,
};

/** Render one asset's card to its export size and format (G4, G6). */
export async function renderCard(asset: CardAssetId, input: LayoutInput): Promise<LayoutResult> {
  const spec = CARD_SPECS[asset];
  const layout = LAYOUTS[spec.layout ?? ""];
  if (!layout) throw new Error(`no layout for ${asset}`);
  const canvas = await layout(input);
  const [width, height] = spec.exportPx ?? [canvas.w, canvas.h];
  const bytes = await canvas.encode(spec.format ?? "jpeg", [width, height]);
  return { bytes, texts: canvas.texts.filter((t) => t.size > 0), width, height };
}

/** Brand colours: the request's (G5), else two dominant non-white colours of the cutout. */
export async function paletteFor(request: CardsRequest, anchor: Uint8Array): Promise<Palette> {
  const given = (request.brandColors ?? []).map(hexToRgb);
  if (given.length >= 2) return { primary: given[0], secondary: given[1] };
  const dominant = await dominantColours(anchor);
  const primary = given[0] ?? dominant[0] ?? [40, 70, 120];
  return { primary, secondary: dominant.find((c) => c !== primary) ?? mix(primary, WHITE, 0.4) };
}

/** Coarse colour histogram (4 bits per channel) over opaque, non-white pixels. */
async function dominantColours(png: Uint8Array): Promise<Rgb[]> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(png).ensureAlpha().resize(96, 96, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < info.width * info.height; i++) {
    const [r, g, b, a] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
    if (a < 128 || Math.min(r, g, b) >= 235) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(key, e);
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 2)
    .map((e) => [e.r / e.n, e.g / e.n, e.b / e.n] as Rgb);
}
