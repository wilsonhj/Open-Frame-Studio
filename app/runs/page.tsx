"use client";
/** Recent runs in this tab (the ids useRun keeps in sessionStorage). Owner: slice G. */
import Link from "next/link";
import { useEffect, useState } from "react";

import { runStorageKey } from "../../lib/client/use-run";
import type { PipelineKind } from "../../lib/types";

const KINDS: readonly PipelineKind[] = ["photoshoot", "listing", "identity", "motion"];

export default function RunsPage() {
  const [runs, setRuns] = useState<Array<{ kind: PipelineKind; id: string }>>([]);

  useEffect(() => {
    const found: Array<{ kind: PipelineKind; id: string }> = [];
    for (const kind of KINDS) {
      try {
        const id = window.sessionStorage.getItem(runStorageKey(kind));
        if (id) found.push({ kind, id });
      } catch {
        // storage unavailable
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of browser storage on mount
    setRuns(found);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-[28px] leading-[34px]">Recent runs</h1>
      {runs.length === 0 ? (
        <p className="text-ink-2">No runs in this tab yet. Start one from Photoshoot or Cards.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {runs.map((run) => (
            <li key={run.kind} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="label">{run.kind}</span>
              <Link href={`/${run.kind}?run=${encodeURIComponent(run.id)}`} className="caption hover:underline">
                {run.id}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
