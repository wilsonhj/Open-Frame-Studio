/**
 * MODE_TEMPLATES: per-mode defaults, prompt templates and variation pools for
 * Product Photoshoot (docs/spec/photoshoot.md §2, §3, §6). Pure data, no I/O.
 *
 * Demo scope: the five product-only modes. Every pool holds at least 4 values
 * so up to 4 free-variation outputs differ on every rotating axis.
 */
import type { AspectRatio, ModeTemplate, PhotoshootMode } from "../contracts/photoshoot.ts";

/** Demo cap on outputs per run (the contract allows up to 10). */
export const MAX_OUTPUTS = 4;

const LIGHTING = [
  "soft window light",
  "golden hour sunlight",
  "studio softbox lighting",
  "overcast diffuse light",
  "crisp hard flash",
  "rim-lit edges",
] as const;

const ANGLES = [
  "eye-level straight-on view",
  "45-degree three-quarter view",
  "top-down flat lay",
  "low hero angle",
  "macro close-up",
] as const;

const PALETTES = [
  "colours drawn from the product",
  "neutral warm tones",
  "cool minimal tones",
  "soft pastel tones",
  "rich seasonal tones",
] as const;

export type DemoMode = "packshot" | "in_context" | "wide_banner" | "mood_still" | "carousel_set";

export const MODE_TEMPLATES = {
  packshot: {
    mode: "packshot",
    label: "Product shot",
    defaultAspect: "1:1",
    aspects: ["1:1", "4:5", "3:4", "4:3"],
    minOutputs: 1,
    maxOutputs: MAX_OUTPUTS,
    promptTemplate:
      "Professional e-commerce photo of {product}, placed on a {style}. {lighting}, {angle}, {palette}. Clean catalog composition, sharp focus, no text, no letters, no logos.",
    variationAxes: ["preset", "lighting", "angle", "palette"],
    sharedStyle: false,
    needsPerson: false,
    priority: 1,
    cues: ["white background", "catalog", "packshot", "amazon", "shopify"],
    count: { min: 1, max: MAX_OUTPUTS, def: 1, chips: [1, 2, 3, 4] },
    identityK: 0,
    productRef: "cutout",
    pools: {
      preset: ["pure white seamless backdrop", "light grey sweep", "beige paper sweep", "pastel seamless backdrop"],
      lighting: LIGHTING,
      angle: ANGLES,
      palette: PALETTES,
    },
  },
  in_context: {
    mode: "in_context",
    label: "Lifestyle scene",
    defaultAspect: "4:5",
    aspects: ["4:5", "1:1", "3:4", "9:16"],
    minOutputs: 1,
    maxOutputs: MAX_OUTPUTS,
    promptTemplate:
      "Lifestyle photo of {product}, in a real setting: {style}. {lighting}, {angle}, {palette}. Natural atmosphere, authentic props, no text, no letters, no logos.",
    variationAxes: ["preset", "lighting", "angle", "palette"],
    sharedStyle: false,
    needsPerson: false,
    priority: 2,
    cues: ["lifestyle", "in use", "kitchen", "scene", "real life"],
    count: { min: 1, max: MAX_OUTPUTS, def: 2, chips: [1, 2, 3, 4] },
    identityK: 0,
    productRef: "cutout",
    pools: {
      preset: ["kitchen counter", "café table", "bathroom shelf", "outdoor picnic blanket", "tidy home desk"],
      lighting: LIGHTING,
      angle: ANGLES,
      palette: PALETTES,
    },
  },
  wide_banner: {
    mode: "wide_banner",
    label: "Hero banner",
    defaultAspect: "16:9",
    aspects: ["16:9", "3:2"],
    minOutputs: 1,
    maxOutputs: MAX_OUTPUTS,
    promptTemplate:
      "Wide website hero image of {product}, set in {style}, with generous empty negative space on one side: a plain, uncluttered background area. {lighting}, {angle}, {palette}. Cinematic, no text, no letters, no logos.",
    variationAxes: ["preset", "lighting", "angle", "palette"],
    sharedStyle: false,
    needsPerson: false,
    priority: 3,
    cues: ["hero", "banner", "header", "website", "email"],
    count: { min: 1, max: MAX_OUTPUTS, def: 1, chips: [1, 2, 3, 4] },
    identityK: 0,
    productRef: "cutout",
    pools: {
      preset: ["a minimal stone plinth scene", "a sunlit studio set", "a soft gradient set", "a botanical set with leaves"],
      lighting: LIGHTING,
      angle: ["eye-level straight-on view", "45-degree three-quarter view", "low hero angle", "wide establishing view"],
      palette: PALETTES,
    },
  },
  mood_still: {
    mode: "mood_still",
    label: "Moodboard pin",
    defaultAspect: "2:3",
    aspects: ["2:3"],
    minOutputs: 1,
    maxOutputs: MAX_OUTPUTS,
    promptTemplate:
      "Vertical Pinterest-style moodboard image of {product}, styled with {style}. {lighting}, {angle}, {palette}. Editorial, airy, aspirational, no text, no letters, no logos.",
    variationAxes: ["preset", "lighting", "angle", "palette"],
    sharedStyle: false,
    needsPerson: false,
    priority: 3,
    cues: ["pinterest", "pin", "moodboard", "aesthetic"],
    count: { min: 1, max: MAX_OUTPUTS, def: 2, chips: [1, 2, 3, 4] },
    identityK: 0,
    productRef: "cutout",
    pools: {
      preset: ["linen and dried flowers", "marble and gold accents", "ceramics and soft fabric", "books and a coffee cup"],
      lighting: LIGHTING,
      angle: ANGLES,
      palette: PALETTES,
    },
  },
  carousel_set: {
    mode: "carousel_set",
    label: "Social carousel",
    defaultAspect: "4:5",
    aspects: ["4:5", "1:1"],
    minOutputs: 3,
    maxOutputs: MAX_OUTPUTS,
    promptTemplate:
      "Instagram carousel slide featuring {product}, set in {style}. {lighting}, {angle}, {palette}. Consistent visual system across slides, no text, no letters, no logos.",
    variationAxes: ["angle"],
    sharedStyle: true,
    needsPerson: false,
    priority: 3,
    cues: ["carousel", "slides", "instagram", "linkedin"],
    count: { min: 3, max: MAX_OUTPUTS, def: 4, chips: [3, 4] },
    identityK: 0,
    productRef: "cutout",
    pools: {
      preset: ["a warm minimal studio set", "a soft terracotta set", "a clean concrete set", "a sage green set"],
      lighting: LIGHTING,
      angle: ["eye-level hero framing", "macro texture detail", "hands-in-use framing", "three-quarter feature framing"],
      palette: PALETTES,
    },
    // Phrased as composition, never as labels: a model renders quoted or
    // label-like words ("cover hook", "call to action") as gibberish text.
    roles: [
      "opening cover image, a bold product hero with generous empty negative space in the upper third, plain background area",
      "close-up of the surface texture",
      "the product in use",
      "close-up of one key product feature in sharp focus",
      "the product in a lifestyle context",
      "closing image, the product centred on a clean, uncluttered background",
    ],
  },
} as const satisfies Record<DemoMode, ModeTemplate>;

export const DEMO_MODES = Object.keys(MODE_TEMPLATES) as DemoMode[];

export function isDemoMode(mode: unknown): mode is DemoMode {
  return typeof mode === "string" && Object.hasOwn(MODE_TEMPLATES, mode);
}

export function getModeTemplate(mode: PhotoshootMode): ModeTemplate | null {
  return isDemoMode(mode) ? MODE_TEMPLATES[mode] : null;
}

/** Klein base render size per aspect (docs/spec/photoshoot.md §3; multiples of 16). */
export const KLEIN_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "4:5": { width: 896, height: 1120 },
  "5:4": { width: 1120, height: 896 },
  "3:4": { width: 864, height: 1152 },
  "4:3": { width: 1152, height: 864 },
  "2:3": { width: 832, height: 1248 },
  "3:2": { width: 1248, height: 832 },
  "9:16": { width: 720, height: 1280 },
  "16:9": { width: 1280, height: 720 },
};
