/**
 * Minimal primitive (W2.0 skeleton). Owner: slice G (docs/OWNERS.md). Keep the
 * export name and props (additive changes only); restyle freely.
 */
export type SpinnerProps = {
  /** Accessible label (default "Loading"). */
  label?: string;
  className?: string;
};

export function Spinner({ label = "Loading", className = "" }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={`inline-block size-4 animate-spin rounded-full border-2 border-muted border-t-transparent ${className}`} />
  );
}
