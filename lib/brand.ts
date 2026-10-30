/**
 * Product name and surface labels, in one place. These are our own names:
 * never reuse another product's trademarks as UI labels.
 */
export const APP_NAME = "Open Frame Studio";

export const APP_TAGLINE = "Open-weights identity, product photography and listing images on ComfyUI.";

export const SURFACES = {
  identity: { href: "/identity", label: "Identity" },
  photoshoot: { href: "/photoshoot", label: "Product Shoot" },
  listing: { href: "/listing", label: "Listing Images" },
  motion: { href: "/motion", label: "Motion" },
} as const;
