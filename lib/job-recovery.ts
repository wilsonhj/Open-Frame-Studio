/**
 * Browser-side recovery of unfinished jobs across reloads.
 *
 * One entry per job (keyed by its handle), never one shared slot, so a job
 * finishing in one tab removes only its own entry and can't erase another
 * tab's unfinished run. Each entry records the tab that owns it (a per-tab
 * id kept in sessionStorage, which survives that tab's reloads), so a
 * reloaded tab picks up its own run first. Storage is passed in so this is
 * testable without a browser. No runtime dependencies.
 */
import type { Job } from "./types.ts";

export const RECOVERY_KEY = "studio:unfinished-jobs";
const TAB_KEY = "studio:tab-id";
/** Entries older than this are dropped: the server's deadline has long since ended the job. */
const MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_ENTRIES = 50;

type Entry = { workflow: string; tab: string; savedAt: number; job: Job };
type Entries = Record<string, Entry>;

/** The Web Storage surface we use (localStorage / sessionStorage, or a test double). */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

function read(storage: StorageLike, now: number): Entries {
  try {
    const parsed = JSON.parse(storage.getItem(RECOVERY_KEY) ?? "{}") as Entries;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, entry]) => entry?.job && !entry.job.terminal && now - entry.savedAt < MAX_AGE_MS),
    );
  } catch {
    return {};
  }
}

function write(storage: StorageLike, entries: Entries): void {
  const newest = Object.entries(entries)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_ENTRIES);
  storage.setItem(RECOVERY_KEY, JSON.stringify(Object.fromEntries(newest)));
}

/** This tab's id: stable across its reloads, distinct per tab. */
export function tabId(session: StorageLike): string {
  let id = session.getItem(TAB_KEY);
  if (!id) {
    id = crypto.randomUUID();
    session.setItem(TAB_KEY, id);
  }
  return id;
}

/** Save an unfinished job, or drop its entry once it is terminal. Touches no other entry. */
export function rememberJob(storage: StorageLike, tab: string, workflow: string, job: Job, now = Date.now()): void {
  const entries = read(storage, now);
  if (job.terminal) delete entries[job.id];
  else entries[job.id] = { workflow, tab, savedAt: now, job };
  write(storage, entries);
}

/** Drop one job's entry (it can no longer be checked, or the user chose to stop watching it). */
export function forgetJob(storage: StorageLike, jobId: string, now = Date.now()): void {
  const entries = read(storage, now);
  delete entries[jobId];
  write(storage, entries);
}

/**
 * The unfinished job this tab should resume: its own newest entry for the
 * workflow, else the newest one from another tab (e.g. a closed one), which
 * it adopts. If that other tab is still open, both just watch the same run;
 * polling is read-only, so nothing is submitted twice.
 */
export function recoverJob(storage: StorageLike, tab: string, workflow: string, now = Date.now()): Job | null {
  const entries = read(storage, now);
  const candidates = Object.values(entries)
    .filter((entry) => entry.workflow === workflow)
    .sort((a, b) => b.savedAt - a.savedAt);
  const pick = candidates.find((entry) => entry.tab === tab) ?? candidates[0];
  if (!pick) return null;
  if (pick.tab !== tab) {
    entries[pick.job.id] = { ...pick, tab, savedAt: now };
    write(storage, entries);
  }
  return pick.job;
}
