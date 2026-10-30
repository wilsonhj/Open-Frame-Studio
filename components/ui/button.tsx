/**
 * Minimal primitive (W2.0 skeleton). Owner: slice G (docs/OWNERS.md). Keep the
 * export name and props (additive changes only); restyle freely.
 */
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Shows a spinner and disables the button. */
  busy?: boolean;
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:opacity-90",
  secondary: "border border-border bg-card hover:bg-background",
  ghost: "hover:bg-card",
};

export function Button({ variant = "primary", busy = false, disabled, className = "", children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {busy ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </button>
  );
}
