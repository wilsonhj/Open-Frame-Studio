/**
 * A small raster canvas for the code-drawn layers of Listing Images
 * (docs/spec/listing.md G1, G8, G9). Every operation is applied to a raw RGBA
 * buffer at once, so text contrast is checked against the real pixels behind it.
 * Text is drawn with the bundled OFL fonts (assets/fonts) through sharp/Pango.
 */
import { fileURLToPath } from "node:url";

async function loadSharp() {
  return (await import("sharp")).default;
}

export type Box = { x: number; y: number; w: number; h: number };
export type Rgb = [number, number, number];

export type FontFamily = "Inter" | "Playfair Display";
export type FontWeight = 400 | 500 | 600 | 700 | 800;

const FONT_FILES: Record<FontFamily, Partial<Record<FontWeight, string>>> = {
  Inter: {
    400: "Inter_400Regular.ttf",
    500: "Inter_500Medium.ttf",
    600: "Inter_600SemiBold.ttf",
    700: "Inter_700Bold.ttf",
    800: "Inter_800ExtraBold.ttf",
  },
  "Playfair Display": { 400: "PlayfairDisplay_400Regular.ttf", 700: "PlayfairDisplay_700Bold.ttf" },
};

const WEIGHT_NAMES: Record<FontWeight, string> = {
  400: "",
  500: "Medium",
  600: "Semi-Bold",
  700: "Bold",
  800: "Ultra-Bold",
};

function fontFile(family: FontFamily, weight: FontWeight): { file: string; weight: FontWeight } {
  const files = FONT_FILES[family];
  const w = (files[weight] ? weight : family === "Inter" ? 400 : weight >= 600 ? 700 : 400) as FontWeight;
  return { file: fileURLToPath(new URL(`../../assets/fonts/${files[w]}`, import.meta.url)), weight: w };
}

/** G8: copy that cannot fit its box even at the minimum size. Names the field and its budget. */
export class TextFitError extends Error {
  readonly field: string;
  readonly budget: number;
  constructor(field: string, budget: number) {
    super(`${field} is too long for its box: keep it under about ${budget} characters`);
    this.name = "TextFitError";
    this.field = field;
    this.budget = budget;
  }
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [17, 17, 17];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of an sRGB colour. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function escapeMarkup(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const WHITE: Rgb = [255, 255, 255];
export const INK: Rgb = [17, 17, 17];
export const MIN_CONTRAST = 4.5;

export type TextOptions = {
  /** Request field the copy came from, for the G8 error (e.g. `bullets[2]`). */
  field: string;
  family?: FontFamily;
  weight?: FontWeight;
  maxSize: number;
  minSize: number;
  /** Text colour; `auto` picks white or ink by contrast. Default `auto`. */
  color?: Rgb | "auto";
  align?: "left" | "centre" | "right";
  /** Brand colour for the G9 scrim. Default ink. */
  scrim?: Rgb;
};

export type TextPlacement = {
  /** Font size used (px). */
  size: number;
  /** Where the text ended up (top-left aligned inside the box). */
  bounds: Box;
  contrast: number;
  scrim: boolean;
  /** The ink the text was drawn in. */
  color: Rgb;
};

export class Canvas {
  readonly w: number;
  readonly h: number;
  private buf: Buffer;
  /** Every text block placed so far (for tests: safe areas, contrast). */
  readonly texts: TextPlacement[] = [];

  private constructor(w: number, h: number, buf: Buffer) {
    this.w = w;
    this.h = h;
    this.buf = buf;
  }

  static async create(w: number, h: number, bg: Rgb = WHITE): Promise<Canvas> {
    const sharp = await loadSharp();
    const buf = await sharp({ create: { width: w, height: h, channels: 4, background: { r: bg[0], g: bg[1], b: bg[2], alpha: 1 } } })
      .raw()
      .toBuffer();
    return new Canvas(w, h, buf);
  }

  private async composite(inputs: import("sharp").OverlayOptions[]): Promise<void> {
    const sharp = await loadSharp();
    this.buf = await sharp(this.buf, { raw: { width: this.w, height: this.h, channels: 4 } })
      .composite(inputs)
      .raw()
      .toBuffer();
  }

  /** A filled rectangle, optionally rounded and translucent. */
  async rect(box: Box, color: Rgb, opts: { radius?: number; opacity?: number } = {}): Promise<void> {
    const r = opts.radius ?? 0;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}"><rect width="${box.w}" height="${box.h}" rx="${r}" fill="${rgbToHex(color)}" fill-opacity="${opts.opacity ?? 1}"/></svg>`;
    await this.composite([{ input: Buffer.from(svg), left: Math.round(box.x), top: Math.round(box.y) }]);
  }

  /** A vertical gradient over the whole canvas. */
  async gradient(top: Rgb, bottom: Rgb): Promise<void> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rgbToHex(top)}"/><stop offset="1" stop-color="${rgbToHex(bottom)}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    await this.composite([{ input: Buffer.from(svg), left: 0, top: 0 }]);
  }

  /** A filled circle with an optional centred label (step numbers, icon dots). */
  async badge(cx: number, cy: number, radius: number, color: Rgb, label?: string, minFont = 0): Promise<void> {
    const d = Math.round(radius * 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><circle cx="${radius}" cy="${radius}" r="${radius}" fill="${rgbToHex(color)}"/></svg>`;
    await this.composite([{ input: Buffer.from(svg), left: Math.round(cx - radius), top: Math.round(cy - radius) }]);
    if (label) {
      // Through Pango and the bundled fonts, like every other text (G1).
      // `minFont`: the card's G8 minimum, which a label never goes below.
      const size = Math.max(minFont, Math.round(radius * 1.1));
      await this.text(
        label,
        { x: cx - radius, y: cy - size * 0.62, w: d, h: size * 1.4 },
        { field: "label", weight: 700, maxSize: size, minSize: Math.max(minFont, Math.round(size / 2)), align: "centre", scrim: color },
      );
    }
  }

  /**
   * Paste an image (an RGBA cutout keeps its alpha) scaled to fit `box`
   * (`contain`, centred) or to fill it (`cover`, cropped). Returns where it landed.
   */
  async image(bytes: Uint8Array, box: Box, fit: "contain" | "cover" = "contain"): Promise<Box> {
    const sharp = await loadSharp();
    const w = Math.max(1, Math.round(box.w));
    const h = Math.max(1, Math.round(box.h));
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .resize(w, h, { fit, kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    const left = Math.round(box.x + (w - info.width) / 2);
    const top = Math.round(box.y + (h - info.height) / 2);
    await this.composite([{ input: data, left, top }]);
    return { x: left, y: top, w: info.width, h: info.height };
  }

  /** Luminance at the given percentile (0..1) of the pixels inside `box`. */
  luminancePercentile(box: Box, percentile: number): number {
    const lums: number[] = [];
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(this.w, Math.ceil(box.x + box.w));
    const y1 = Math.min(this.h, Math.ceil(box.y + box.h));
    const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 40_000)));
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const i = (y * this.w + x) * 4;
        lums.push(luminance([this.buf[i], this.buf[i + 1], this.buf[i + 2]]));
      }
    }
    if (lums.length === 0) return 1;
    lums.sort((a, b) => a - b);
    return lums[Math.min(lums.length - 1, Math.floor(percentile * (lums.length - 1)))];
  }

  /**
   * Text fitted into `box` (G8): the largest size from `maxSize` down to
   * `minSize` whose wrapped text fits; else TextFitError (never truncates).
   * Contrast (G9) is measured on the 5th-percentile-worst pixel behind the
   * text; under 4.5:1 a scrim panel is added and contrast re-checked.
   */
  async text(text: string, box: Box, opts: TextOptions): Promise<TextPlacement> {
    const sharp = await loadSharp();
    const family = opts.family ?? "Inter";
    const { file, weight } = fontFile(family, opts.weight ?? 400);
    const align = opts.align ?? "left";
    const render = async (size: number, color: Rgb) => {
      const markup = `<span foreground="${rgbToHex(color)}">${escapeMarkup(text)}</span>`;
      return sharp({
        text: {
          text: markup,
          font: `${family} ${WEIGHT_NAMES[weight]} ${size}`.replace(/\s+/g, " "),
          fontfile: file,
          width: Math.round(box.w),
          dpi: 72,
          wrap: "word",
          align,
          rgba: true,
        },
      })
        .png()
        .toBuffer({ resolveWithObject: true });
    };

    let size = opts.maxSize;
    let fitted: Awaited<ReturnType<typeof render>> | null = null;
    for (;;) {
      const probe = await render(size, INK);
      if (probe.info.width <= box.w && probe.info.height <= box.h) {
        fitted = probe;
        break;
      }
      if (size <= opts.minSize) {
        const ratio = (box.w * box.h) / Math.max(1, probe.info.width * probe.info.height);
        throw new TextFitError(opts.field, Math.max(1, Math.floor(text.length * ratio)));
      }
      size = Math.max(opts.minSize, Math.floor(size * 0.92));
    }

    const width = fitted.info.width;
    const height = fitted.info.height;
    const left = align === "centre" ? box.x + (box.w - width) / 2 : align === "right" ? box.x + box.w - width : box.x;
    const bounds: Box = { x: Math.round(left), y: Math.round(box.y), w: width, h: height };

    // Worst case over the background behind the text: an ink is only as
    // legible as its contrast with the nearest-luminance 5% of pixels, the
    // brightest for light text and the darkest for dark text.
    const bright = this.luminancePercentile(bounds, 0.95);
    const dark = this.luminancePercentile(bounds, 0.05);
    const contrastFor = (c: Rgb) => Math.min(contrastRatio(luminance(c), bright), contrastRatio(luminance(c), dark));
    let color: Rgb =
      opts.color && opts.color !== "auto" ? opts.color : contrastFor(WHITE) >= contrastFor(INK) ? WHITE : INK;
    let contrast = contrastFor(color);
    let scrim = false;
    if (contrast < MIN_CONTRAST) {
      const pad = Math.round(size * 0.4);
      const panel = opts.scrim ?? INK;
      await this.rect(
        { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + 2 * pad, h: bounds.h + 2 * pad },
        panel,
        { radius: pad },
      );
      scrim = true;
      const panelL = luminance(panel);
      color = contrastRatio(luminance(WHITE), panelL) >= contrastRatio(luminance(INK), panelL) ? WHITE : INK;
      contrast = contrastRatio(luminance(color), panelL);
    }
    const final = await render(size, color);
    await this.composite([{ input: final.data, left: bounds.x, top: bounds.y }]);
    const placement = { size, bounds, contrast, scrim, color };
    this.texts.push(placement);
    return placement;
  }

  /** The finished card: RGB, no alpha (G6), PNG or JPEG q95. */
  async encode(format: "png" | "jpeg", size?: readonly [number, number]): Promise<Uint8Array> {
    const sharp = await loadSharp();
    let img = sharp(this.buf, { raw: { width: this.w, height: this.h, channels: 4 } }).flatten({ background: "#ffffff" });
    if (size && (size[0] !== this.w || size[1] !== this.h)) img = img.resize(size[0], size[1], { kernel: "lanczos3" });
    img = img.removeAlpha().toColourspace("srgb");
    const out = format === "png" ? await img.png().toBuffer() : await img.jpeg({ quality: 95 }).toBuffer();
    return new Uint8Array(out);
  }
}
