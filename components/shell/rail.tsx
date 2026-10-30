"use client";
/** Left rail (docs/spec/ux.md §2.1). Owner: slice G. */
import Link from "next/link";
import { usePathname } from "next/navigation";

import { APP_NAME, SURFACES } from "../../lib/brand";

export type RailItem = { href: string; label: string; soon?: boolean };

export const TOOLS: readonly RailItem[] = [
  { ...SURFACES.photoshoot },
  { ...SURFACES.listing },
  { ...SURFACES.identity },
  { ...SURFACES.motion },
];

export function Rail({ demo }: { demo: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="flex shrink-0 flex-col gap-6 border-line bg-surface px-4 py-5 md:sticky md:top-0 md:h-screen md:w-[248px] md:border-r max-md:border-b">
      <Link href="/" className="font-display text-xl leading-6 tracking-tight">
        {APP_NAME}
      </Link>
      <nav aria-label="Tools" className="flex flex-col gap-1 max-md:flex-row max-md:flex-wrap">
        <p className="label mb-1 max-md:hidden">Tools</p>
        {TOOLS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors ${
                active ? "bg-surface-sunk text-ink" : "text-ink-2 hover:bg-surface-sunk hover:text-ink"
              }`}
            >
              <span className="flex items-center gap-2">
                <span aria-hidden className={`inline-block size-1.5 rotate-45 ${active ? "bg-safelight" : "bg-line"}`} />
                {item.label}
              </span>
              {item.soon ? <span className="caption rounded border border-line px-1 text-[10px] leading-4">soon</span> : null}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto mb-12 flex flex-col gap-2 max-md:mb-0 max-md:flex-row max-md:flex-wrap max-md:items-center max-md:gap-x-4">
        <Link href="/runs" className="text-sm text-ink-2 hover:text-ink">
          Recent runs
        </Link>
        <p className="caption flex items-center gap-2" title={demo ? "Demo mode: a local mock stands in for Comfy Cloud" : undefined}>
          <span aria-hidden className={`inline-block size-2 rounded-full ${demo ? "bg-brass" : "bg-ok"}`} />
          {demo ? "Demo · local mock" : "Comfy backend"}
        </p>
      </div>
    </aside>
  );
}
