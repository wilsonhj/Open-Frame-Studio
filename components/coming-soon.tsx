import type { ReactNode } from "react";

export function ComingSoon({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <div className="max-w-2xl text-muted">{children}</div>
      <p className="inline-block rounded-full border border-border px-3 py-1 text-xs text-muted">In progress</p>
    </div>
  );
}
