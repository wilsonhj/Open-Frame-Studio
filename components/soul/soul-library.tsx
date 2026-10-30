"use client";

/**
 * STUB (W2.0 skeleton). Owner: slice C (docs/OWNERS.md). The Identity picker used
 * by Photoshoot (D) and Motion (F) and the Rail library: lists Souls from
 * `GET /api/souls` and reports the chosen one. Keep the export name and props
 * (additive changes only).
 */
import type { Identity } from "../../lib/types";

export type SoulLibraryProps = {
  /** Selected Identity id, or null for "no identity" (Identity is always optional). */
  selectedId?: string | null;
  /** Called with the chosen Identity, or null when cleared. */
  onSelect?: (soul: Identity | null) => void;
  /** `picker` = compact chooser inside a tool; `rail` = full library list. */
  variant?: "picker" | "rail";
  className?: string;
};

export function SoulLibrary({ variant = "picker", className = "" }: SoulLibraryProps) {
  return (
    <div data-testid="soul-library" data-variant={variant} className={`text-sm text-muted ${className}`}>
      No Souls yet.
    </div>
  );
}
