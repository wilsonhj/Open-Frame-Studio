/**
 * Browser-side recovery of unfinished jobs across reloads.
 *
 * Every run has its own storage key (`studio:unfinished-job:<handle>`), and
 * every operation is a single setItem/removeItem on that key. There is no
 * shared aggregate value to read-modify-write, so no interleaving of tabs
 * can make one tab's update erase another tab's run. Each entry records the
 * tab that owns it (a per-tab id kept in sessionStorage, which survives
 * that tab's reloads), so a reloaded tab picks up its own run first. A
 * duplicated tab inherits the same id, so it may resume the original tab's
 * run first; both still poll the same job and nothing is lost or billed twice.
 * Storage is passed in so this is testable without a browser. No runtime
 * dependencies.
 */
import type { Job } from "./types.ts";

export const RECOVERY_PREFIX = "studio:unfinished-job:";
const TAB_KEY = "studio:tab-id";
/** Entries older than this are dropped: the server's deadline has long since ended the job. */
const MAX_AGE_MS = 24 * 60 * 60_000;
/**
 * A watching tab refreshes its entry on every poll attempt and on a
 * heartbeat (TOUCH_EVERY_MS) even while polling is paused or failing, so an
 * entry from another tab untouched for this long most likely belongs to a
 * tab that is gone (closed, or crashed) and may be adopted. Browsers can
 * throttle a hidden tab's timers to about once a minute, so this is well
 * above that. It is a heuristic, not a lock: a frozen tab can still lose its
 * run to another tab, which then just polls the same job (nothing is billed).
 */
export const ADOPT_AFTER_MS = 2 * 60_000;
export const TOUCH_EVERY_MS = 30_000;

/** `seeds`: what the run was submitted with (POST /api/jobs), kept across rewrites. */
type Entry = { workflow: string; tab: string; savedAt: number; job: Job; seeds?: Record<string, number> };

/** A recovered run: the job plus the seeds it was submitted with. */
export type RecoveredRun = { job: Job; seeds: Record<string, number> };

/** The Web Storage surface we use (localStorage / sessionStorage, or a test double). */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const keyFor = (jobId: string) => `${RECOVERY_PREFIX}${jobId}`;

/** Earlier formats: one `{workflow, job}` slot, then one JSON map of entries keyed by handle. */
export const LEGACY_ACTIVE_KEY = "studio:active-job";
export const LEGACY_MAP_KEY = "studio:unfinished-jobs";

function isLiveJob(job: unknown): job is Job {
  return Boolean(job) && typeof (job as Job).id === "string" && (job as Job).terminal !== true;
}

/**
 * Move legacy records onto per-job keys, then remove the legacy key. A
 * per-job key that already exists is newer and is never overwritten, and
 * nothing outside the legacy keys is touched, so a corrupt or old-format
 * record can't erase a live one. Idempotent, so tabs migrating at the same
 * time write the same values.
 *
 * The map goes first: its entries carry their owning tab and savedAt, so
 * they are the better copy of any job that is in both. A legacy slot had
 * no owning tab or time; it is stamped `now`, so like any other entry it
 * only becomes adoptable after ADOPT_AFTER_MS without a refresh, never at
 * once (an old-version tab may still be watching it).
 */
function migrateLegacy(storage: StorageLike, now: number): void {
  const adopt = (workflow: unknown, job: unknown, tab: unknown, savedAt: unknown) => {
    if (typeof workflow !== "string" || !isLiveJob(job) || storage.getItem(keyFor(job.id)) !== null) return;
    const at = typeof savedAt === "number" && Number.isFinite(savedAt) ? savedAt : now;
    if (now - at >= MAX_AGE_MS) return;
    const entry: Entry = { workflow, tab: typeof tab === "string" ? tab : "", savedAt: at, job };
    storage.setItem(keyFor(job.id), JSON.stringify(entry));
  };
  const parse = (key: string): unknown => {
    try {
      return JSON.parse(storage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  };
  if (storage.getItem(LEGACY_MAP_KEY) !== null) {
    const map = parse(LEGACY_MAP_KEY);
    if (map && typeof map === "object" && !Array.isArray(map)) {
      for (const entry of Object.values(map as Record<string, Partial<Entry> | null>)) {
        if (entry && typeof entry === "object") adopt(entry.workflow, entry.job, entry.tab, entry.savedAt);
      }
    }
    storage.removeItem(LEGACY_MAP_KEY);
  }
  if (storage.getItem(LEGACY_ACTIVE_KEY) !== null) {
    const slot = parse(LEGACY_ACTIVE_KEY) as { workflow?: unknown; job?: unknown } | null;
    if (slot && typeof slot === "object") adopt(slot.workflow, slot.job, undefined, undefined);
    storage.removeItem(LEGACY_ACTIVE_KEY);
  }
}

/** This tab's id: stable across its reloads, distinct per tab. */
export function tabId(session: Pick<Storage, "getItem" | "setItem">): string {
  let id = session.getItem(TAB_KEY);
  if (!id) {
    id = crypto.randomUUID();
    session.setItem(TAB_KEY, id);
  }
  return id;
}

function readEntry(storage: StorageLike, jobId: string): Entry | null {
  try {
    const entry = JSON.parse(storage.getItem(keyFor(jobId)) ?? "null") as Entry | null;
    return entry && typeof entry === "object" && isLiveJob(entry.job) ? entry : null;
  } catch {
    return null;
  }
}

function validSeeds(seeds: unknown): Record<string, number> | undefined {
  if (!seeds || typeof seeds !== "object" || Array.isArray(seeds)) return undefined;
  const kept = Object.entries(seeds).filter(([, value]) => Number.isSafeInteger(value));
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/**
 * Save an unfinished job, or drop its entry once it is terminal. Writes only
 * this job's key. Seeds given at submit are kept when later polls rewrite
 * the entry without them (a plain Job from GET has none).
 */
export function rememberJob(
  storage: StorageLike,
  tab: string,
  workflow: string,
  job: Job,
  now = Date.now(),
  seeds?: Record<string, number>,
): void {
  if (job.terminal) {
    storage.removeItem(keyFor(job.id));
    return;
  }
  const kept = validSeeds(seeds) ?? validSeeds(readEntry(storage, job.id)?.seeds);
  const entry: Entry = { workflow, tab, savedAt: now, job, ...(kept ? { seeds: kept } : {}) };
  storage.setItem(keyFor(job.id), JSON.stringify(entry));
}

/** Refresh an entry's savedAt (a failed or paused poll still means this tab is watching). */
export function touchJob(storage: StorageLike, tab: string, jobId: string, now = Date.now()): void {
  const entry = readEntry(storage, jobId);
  if (entry && entry.tab === tab) storage.setItem(keyFor(jobId), JSON.stringify({ ...entry, savedAt: now }));
}

/** Drop one job's entry (it can no longer be checked, or the user chose to stop watching it). */
export function forgetJob(storage: StorageLike, jobId: string): void {
  storage.removeItem(keyFor(jobId));
}

/** Every live entry; removes stale or unreadable ones (each removal touches only its own key). */
function entries(storage: StorageLike, now: number): Entry[] {
  migrateLegacy(storage, now);
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(RECOVERY_PREFIX)) keys.push(key);
  }
  const live: Entry[] = [];
  for (const key of keys) {
    try {
      const entry = JSON.parse(storage.getItem(key) ?? "null") as Entry | null;
      if (entry && isLiveJob(entry.job) && typeof entry.workflow === "string" && now - entry.savedAt < MAX_AGE_MS) {
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
 * The unfinished run this tab should resume: its own newest entry for the
 * workflow, else the newest orphan (another tab's entry untouched for
 * ADOPT_AFTER_MS, so its tab is most likely gone), which it adopts by
 * rewriting that one key. A run whose tab keeps refreshing it is left alone.
 */
export function recoverRun(storage: StorageLike, tab: string, workflow: string, now = Date.now()): RecoveredRun | null {
  const candidates = entries(storage, now)
    .filter((entry) => entry.workflow === workflow)
    .sort((a, b) => b.savedAt - a.savedAt);
  const pick =
    candidates.find((entry) => entry.tab === tab) ??
    candidates.find((entry) => now - entry.savedAt >= ADOPT_AFTER_MS);
  if (!pick) return null;
  const seeds = validSeeds(pick.seeds) ?? {};
  if (pick.tab !== tab) rememberJob(storage, tab, workflow, pick.job, now, seeds);
  return { job: pick.job, seeds };
}
