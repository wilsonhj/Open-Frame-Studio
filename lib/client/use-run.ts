"use client";
/**
 * Owner: slice G (docs/OWNERS.md). Client hook that starts and polls a
 * pipeline run through the slice-A routes:
 *   POST /api/pipelines/{kind}            -> 202 PipelineRun<K>
 *   GET  /api/pipelines/{kind}/{runId}    -> 200 PipelineRun<K> (poll until terminal)
 *   POST /api/pipelines/{kind}/{runId}/cancel
 * Keep the export names and signatures (additive changes only). Use it from
 * a "use client" component. The current run id is kept in sessionStorage
 * (per kind) so a reload resumes polling.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { PipelineKind, PipelineRun, PipelineRunStatus } from "../types";

export type UseRunOptions = {
  /** Resume polling an existing run (e.g. from `?run=` or History). */
  runId?: string | null;
  /** Poll interval in ms (default 1500). */
  intervalMs?: number;
};

export type UseRunResult<K extends PipelineKind> = {
  run: PipelineRun<K> | null;
  /** Last request/poll error message (the run itself may still be fine). */
  error: string | null;
  /** True while a run is non-terminal and being polled. */
  polling: boolean;
  /**
   * Create a run. `FormData` = multipart (`request` JSON part + file parts);
   * a plain object = `application/json` (assetId-only requests). Resolves to
   * the 202 run, or `null` on a 4xx/5xx (see `error`).
   */
  start(body: FormData | PipelineRunRequestBody): Promise<PipelineRun<K> | null>;
  cancel(): Promise<void>;
  /** POST an action path under the run, e.g. `items/2/retry` (202 PipelineRun). */
  action(path: string, body?: unknown): Promise<PipelineRun<K> | null>;
  /** Forget the current run (stops polling). */
  reset(): void;
};

/** A JSON request body for `start` (the per-kind request object). */
export type PipelineRunRequestBody = Record<string, unknown>;

export const TERMINAL_RUN_STATUSES: readonly PipelineRunStatus[] = ["succeeded", "partial", "failed", "canceled"];

export function isTerminalRun(run: Pick<PipelineRun, "status"> | null | undefined): boolean {
  return !!run && TERMINAL_RUN_STATUSES.includes(run.status);
}

const POLL_START_MS = 1000;
const POLL_MAX_MS = 5000;
const POLL_BACKOFF = 1.5;

export function runStorageKey(kind: PipelineKind): string {
  return `oss:run:${kind}`;
}

function readStored(kind: PipelineKind): string | null {
  try {
    return window.sessionStorage.getItem(runStorageKey(kind));
  } catch {
    return null;
  }
}

function writeStored(kind: PipelineKind, runId: string | null) {
  try {
    if (runId) window.sessionStorage.setItem(runStorageKey(kind), runId);
    else window.sessionStorage.removeItem(runStorageKey(kind));
  } catch {
    // Storage unavailable (private mode): resume-on-reload is best effort.
  }
}

const ACCESS_CODE_KEY = "oss.accessCode";

function storedAccessCode(): string | null {
  try {
    return sessionStorage.getItem(ACCESS_CODE_KEY);
  } catch {
    return null;
  }
}

/**
 * A billed request (start, actions). Sends the studio access code from this
 * tab's session; on 401 `access_code_required` asks for it once and retries.
 */
async function sendBilled(url: string, init: RequestInit): Promise<Response> {
  const send = (code: string | null) => {
    const headers = new Headers(init.headers);
    if (code) headers.set("X-Access-Code", code);
    return fetch(url, { ...init, headers });
  };
  const response = await send(storedAccessCode());
  if (response.status !== 401) return response;
  const body = (await response.clone().json().catch(() => null)) as { code?: string } | null;
  if (body?.code !== "access_code_required" || typeof window === "undefined") return response;
  const code = window.prompt("Studio access code")?.trim();
  if (!code) return response;
  try {
    sessionStorage.setItem(ACCESS_CODE_KEY, code);
  } catch {
    // storage blocked: use the code for this request only
  }
  return send(code);
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string | { message?: string; code?: string } };
    if (typeof body?.error === "string") return body.error;
    if (body?.error?.message) return body.error.message;
    if (body?.error?.code) return body.error.code;
  } catch {
    // not JSON
  }
  return `HTTP ${response.status}`;
}

export function useRun<K extends PipelineKind>(kind: K, options: UseRunOptions = {}): UseRunResult<K> {
  const intervalMs = options.intervalMs;
  const [runId, setRunId] = useState<string | null>(options.runId ?? null);
  const [run, setRun] = useState<PipelineRun<K> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to restart polling for the same run id (after an action).
  const [pollNonce, setPollNonce] = useState(0);
  // Bumped on every new run / reset so stale poll responses are dropped.
  const generation = useRef(0);

  const base = `/api/pipelines/${kind}`;

  // Pick up an explicit runId, else resume the one stored for this tab.
  useEffect(() => {
    const id = options.runId ?? readStored(kind);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt a stored id from browser storage after hydration
    if (id) setRunId(id);
  }, [kind, options.runId]);

  const adopt = useCallback(
    (next: PipelineRun<K>) => {
      setRun(next);
      setRunId(next.id);
      writeStored(kind, next.id);
    },
    [kind],
  );

  useEffect(() => {
    if (!runId) return;
    const gen = generation.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let delay = intervalMs ?? POLL_START_MS;

    const tick = async () => {
      try {
        const response = await fetch(`${base}/${encodeURIComponent(runId)}`, { cache: "no-store" });
        if (stopped || gen !== generation.current) return;
        if (response.status === 404) {
          // The stored run is gone (e.g. data dir wiped): forget it.
          writeStored(kind, null);
          setRunId(null);
          setRun(null);
          setError("Run not found.");
          return;
        }
        if (!response.ok) {
          setError(await errorMessage(response));
        } else {
          const next = (await response.json()) as PipelineRun<K>;
          if (stopped || gen !== generation.current) return;
          setRun(next);
          setError(null);
          if (isTerminalRun(next)) return;
        }
      } catch (err) {
        if (stopped) return;
        setError(err instanceof Error ? err.message : String(err));
      }
      if (stopped) return;
      timer = setTimeout(tick, delay);
      if (intervalMs === undefined) delay = Math.min(POLL_MAX_MS, Math.round(delay * POLL_BACKOFF));
    };

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [base, intervalMs, kind, runId, pollNonce]);

  const start = useCallback(
    async (body: FormData | PipelineRunRequestBody) => {
      generation.current += 1;
      setError(null);
      setRun(null);
      try {
        const init: RequestInit =
          body instanceof FormData
            ? { method: "POST", body }
            : { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
        const response = await sendBilled(base, init);
        if (!response.ok) {
          setError(await errorMessage(response));
          return null;
        }
        const created = (await response.json()) as PipelineRun<K>;
        adopt(created);
        return created;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [adopt, base],
  );

  const action = useCallback(
    async (path: string, body?: unknown) => {
      if (!runId) {
        setError("No run.");
        return null;
      }
      try {
        const response = await sendBilled(`${base}/${encodeURIComponent(runId)}/${path.replace(/^\/+/, "")}`, {
          method: "POST",
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) {
          setError(await errorMessage(response));
          return null;
        }
        const text = await response.text();
        if (!text) return null;
        const next = JSON.parse(text) as PipelineRun<K>;
        generation.current += 1;
        setRun(next);
        // Re-arm polling: an action can make a terminal run live again.
        setRunId(next.id);
        setPollNonce((n) => n + 1);
        writeStored(kind, next.id);
        return next;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [base, kind, runId],
  );

  const cancel = useCallback(async () => {
    await action("cancel");
  }, [action]);

  const reset = useCallback(() => {
    generation.current += 1;
    writeStored(kind, null);
    setRunId(null);
    setRun(null);
    setError(null);
  }, [kind]);

  const polling = runId !== null && !isTerminalRun(run);

  return { run, error, polling, start, cancel, action, reset };
}
