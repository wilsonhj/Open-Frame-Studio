/**
 * Listing Images sizes (docs/spec/listing.md G4, §4.2). Configurable here so
 * they can follow current marketplace documentation.
 */

/** Square cards (hero and gallery): exported at 2000×2000. */
export const SQUARE_PX = [2000, 2000] as const;
/** Story panels: exported at 1464×600 (drawn directly at this size; the 2928×1200 master of §4.2 is not written yet). */
export const STORY_PX = [1464, 600] as const;

/** Klein generation sizes (multiples of 16). */
export const SQUARE_GEN_PX = [1024, 1024] as const;
export const STORY_GEN_PX = [1472, 608] as const;

/** G8: minimum font size on the exported card. */
export const MIN_FONT_SQUARE = 44;
export const MIN_FONT_STORY = 22;

/** Safe area: no text or icon within this many px of the card edge. */
export const SAFE_MARGIN_SQUARE = 80;
export const SAFE_MARGIN_STORY = 32;
