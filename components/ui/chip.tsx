/**
 * Minimal primitive (W2.0 skeleton). Owner: slice G (docs/OWNERS.md). Keep the
 * export name and props (additive changes only); restyle freely.
 */
import type { ButtonHTMLAttributes } from "react";

export type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Selected state (rendered as `aria-pressed`). */
  selected?: boolean;
};

export function Chip({ selected = false, className = "", children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      {...rest}
      aria-pressed={selected}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        selected ? "border-accent bg-accent text-white" : "border-border text-muted hover:text-foreground"
      } ${className}`}
    >
      {children}
    </button>
  );
}
