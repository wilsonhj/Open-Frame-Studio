/**
 * Browser-side recovery of unfinished jobs across reloads.
 *
 * Every run has its own storage key (`studio:unfinished-job:<handle>`), and
 * every operation is a single setItem/removeItem on that key. There is no
 * shared aggregate value to read-modify-write, so no interleaving of tabs
 * can make one tab's update erase another tab's run. Each entry records the
 * tab that owns it (a per-tab id kept in sessionStorage, which survives
 * that tab's reloads), so a reloaded tab picks up its own run first.
 * Storage is passed in so this is testable without a browser. No runtime
 * dependencies.
 */
import type { Job } from "./types.ts";

export const RECOVERY_PREFIX = "studio:unfinished-job:";
const TAB_KEY = "studio:tab-id";
/** Entries older than this are dropped: the server's deadline has long since ended the job. */
const MAX_AGE_MS = 24 * 60 * 60_000;
/**
 * A watching tab rewrites its entry on every poll (every few seconds), so an
 * entry from another tab that hasn't been touched for this long belongs to a
 * tab that is gone (closed, or crashed) and may be adopted. A fresh entry
 * belongs to a tab that is still watching it and is left alone.
 */
export const ADOPT_AFTER_MS = 30_000;

type Entry = { workflow: string; tab: string; savedAt: number; job: Job };

/** The Web Storage surface we use (localStorage / sessionStorage, or a test double). */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const keyFor = (jobId: string) => `${RECOVERY_PREFIX}${jobId}`;

/** This tab's id: stable across its reloads, distinct per tab. */
export function tabId(session: Pick<Storage, "getItem" | "setItem">): string {
  let id = session.getItem(TAB_KEY);
  if (!id) {
    id = crypto.randomUUID();
    session.setItem(TAB_KEY, id);
  }
  return id;
}

/** Save an unfinished job, or drop its entry once it is terminal. Writes only this job's key. */
export function rememberJob(storage: StorageLike, tab: string, workflow: string, job: Job, now = Date.now()): void {
  if (job.terminal) storage.removeItem(keyFor(job.id));
  else storage.setItem(keyFor(job.id), JSON.stringify({ workflow, tab, savedAt: now, job } satisfies Entry));
}

/** Drop one job's entry (it can no longer be checked, or the user chose to stop watching it). */
export function forgetJob(storage: StorageLike, jobId: string): void {
  storage.removeItem(keyFor(jobId));
}

/** Every live entry; removes stale or unreadable ones (each removal touches only its own key). */
function entries(storage: StorageLike, now: number): Entry[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(RECOVERY_PREFIX)) keys.push(key);
  }
  const live: Entry[] = [];
  for (const key of keys) {
    try {
      const entry = JSON.parse(storage.getItem(key) ?? "null") as Entry | null;
      if (entry?.job && !entry.job.terminal && now - entry.savedAt < MAX_AGE_MS) {
        live.push(entry);
        continue;
      }
    } catch {
      // unreadable: fall through and drop it
    }
    storage.removeItem(key);
  }
  return live;
}

/**
 * The unfinished job this tab should resume: its own newest entry for the
 * workflow, else the newest orphan (another tab's entry untouched for
 * ADOPT_AFTER_MS, i.e. its tab is gone), which it adopts by rewriting that
 * one key. A run another open tab is still watching is never taken.
 */
export function recoverJob(storage: StorageLike, tab: string, workflow: string, now = Date.now()): Job | null {
  const candidates = entries(storage, now)
    .filter((entry) => entry.workflow === workflow)
    .sort((a, b) => b.savedAt - a.savedAt);
  const pick =
    candidates.find((entry) => entry.tab === tab) ??
    candidates.find((entry) => now - entry.savedAt >= ADOPT_AFTER_MS);
  if (!pick) return null;
  if (pick.tab !== tab) rememberJob(storage, tab, workflow, pick.job, now);
  return pick.job;
}
