/**
 * Minimal primitive (W2.0 skeleton). Owner: slice G (docs/OWNERS.md). Keep the
 * export name and props (additive changes only); restyle freely.
 */
import type { HTMLAttributes } from "react";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** Optional heading rendered above the content. */
  title?: string;
};

export function Card({ title, className = "", children, ...rest }: CardProps) {
  return (
    <div {...rest} className={`rounded-xl border border-border bg-card p-4 ${className}`}>
      {title ? <h2 className="mb-3 text-sm font-semibold">{title}</h2> : null}
      {children}
    </div>
  );
}
