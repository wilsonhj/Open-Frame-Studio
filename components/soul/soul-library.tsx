"use client";

/**
 * The Identity picker used by Photoshoot (D) and Motion (F), and the library
 * list on /identity. Lists identities from `GET /api/souls`. Keep the export
 * name and props (additive changes only).
 */
import { useEffect, useState } from "react";

import { downloadExport, errorText, soulsFetch } from "../../lib/identity/client";
import type { Identity } from "../../lib/types";
import { RefThumb } from "./ref-thumb";

export type SoulLibraryProps = {
  /** Selected Identity id, or null for "no identity" (Identity is always optional). */
  selectedId?: string | null;
  /** Called with the chosen Identity, or null when cleared. */
  onSelect?: (soul: Identity | null) => void;
  /** `picker` = compact chooser inside a tool; `rail` = full library list. */
  variant?: "picker" | "rail";
  className?: string;
  /** Additive: bump to reload the list (e.g. after a create or import). */
  refreshKey?: number;
};

async function fetchSouls(): Promise<{ identities: Identity[]; error: string | null }> {
  const response = await soulsFetch("/api/souls", { cache: "no-store" });
  if (!response.ok) return { identities: [], error: await errorText(response) };
  return { identities: ((await response.json()) as { identities: Identity[] }).identities, error: null };
}

export function SoulLibrary({ selectedId = null, onSelect, variant = "picker", className = "", refreshKey = 0 }: SoulLibraryProps) {
  const [souls, setSouls] = useState<Identity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void fetchSouls().then(({ identities, error: problem }) => {
      if (!alive) return;
      setError(problem);
      setSouls(identities);
    });
    return () => {
      alive = false;
    };
  }, [reload, refreshKey]);

  async function remove(soul: Identity) {
    if (!window.confirm(`Delete "${soul.name}"? Its reference crops are removed from this studio and from Comfy.`)) return;
    const response = await soulsFetch(`/api/souls/${encodeURIComponent(soul.id)}`, { method: "DELETE" });
    if (!response.ok) setError(await errorText(response));
    if (selectedId === soul.id) onSelect?.(null);
    setReload((n) => n + 1);
  }

  if (souls === null) return <p data-testid="soul-library" className={`text-sm text-muted ${className}`}>Loading identities…</p>;
  if (souls.length === 0) {
    return (
      <div data-testid="soul-library" data-variant={variant} className={`text-sm text-muted ${className}`}>
        {error ?? "No identities yet."}
      </div>
    );
  }

  if (variant === "picker") {
    return (
      <label data-testid="soul-library" data-variant="picker" className={`block space-y-1 text-sm ${className}`}>
        <span>Identity (optional)</span>
        <select
          value={selectedId ?? ""}
          onChange={(event) => onSelect?.(souls.find((s) => s.id === event.target.value) ?? null)}
          className="block w-full rounded-lg border border-border bg-transparent px-3 py-2"
        >
          <option value="">No identity</option>
          {souls.map((soul) => (
            <option key={soul.id} value={soul.id}>
              {soul.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <ul data-testid="soul-library" data-variant="rail" className={`space-y-3 ${className}`}>
      {error && <li className="text-sm text-red-700 dark:text-red-400">{error}</li>}
      {souls.map((soul) => (
        <li key={soul.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <RefThumb id={soul.id} n={0} alt="" className="size-14 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{soul.name}</p>
            <p className="text-xs text-muted">{soul.refs.length} reference crops</p>
          </div>
          {onSelect && (
            <button type="button" onClick={() => onSelect(soul)} className="text-sm text-accent">
              {selectedId === soul.id ? "Selected" : "Use"}
            </button>
          )}
          <button type="button" onClick={() => void downloadExport(soul.id).then((problem) => problem && setError(problem))} className="text-sm text-accent">
            Export
          </button>
          <button type="button" onClick={() => void remove(soul)} className="text-sm text-muted hover:text-red-700">
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
