import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADOPT_AFTER_MS,
  LEGACY_ACTIVE_KEY,
  LEGACY_MAP_KEY,
  RECOVERY_PREFIX,
  forgetJob,
  recoverRun,
  rememberJob,
  tabId,
  touchJob,
  type StorageLike,
} from "../lib/job-recovery.ts";
import type { Job } from "../lib/types.ts";

/** In-memory Web Storage double (one instance = one origin's localStorage, shared by tabs). */
function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}

const job = (id: string, terminal = false): Job => ({
  id,
  status: terminal ? "succeeded" : "running",
  terminal,
  progress: null,
  step: null,
  queuePosition: null,
  outputs: [],
  error: null,
});

describe("unfinished-job recovery", () => {
  it("one tab finishing its job doesn't erase another tab's unfinished job", () => {
    const local = memoryStorage();
    rememberJob(local, "tab-a", "image_resize_smoke", job("A"), 1_000);
    rememberJob(local, "tab-b", "image_resize_smoke", job("B"), 2_000);
    rememberJob(local, "tab-a", "image_resize_smoke", job("A", true), 3_000); // A finishes
    assert.equal(recoverRun(local, "tab-b", "image_resize_smoke", 4_000)?.job.id, "B");
  });

  it("interleaved tabs can't lose each other's run (review repro: B saves while A finishes)", () => {
    // Each tab's update is one write to its own key, so every ordering of the
    // two tabs' operations must leave B recoverable.
    const steps = {
      bSaves: (s: StorageLike) => rememberJob(s, "tab-b", "w", job("B"), 2_000),
      aFinishes: (s: StorageLike) => rememberJob(s, "tab-a", "w", job("A", true), 2_000),
      aForgets: (s: StorageLike) => forgetJob(s, "A"),
      cRecovers: (s: StorageLike) => void recoverRun(s, "tab-c", "w", 2_500),
    };
    const orders: (keyof typeof steps)[][] = [
      ["bSaves", "aFinishes"],
      ["aFinishes", "bSaves"],
      ["bSaves", "aForgets", "cRecovers"],
      ["cRecovers", "aForgets", "bSaves"],
      ["aForgets", "cRecovers", "bSaves"],
    ];
    for (const order of orders) {
      const local = memoryStorage();
      rememberJob(local, "tab-a", "w", job("A"), 1_000); // storage contains A
      for (const step of order) steps[step](local);
      const recovered = [...local.data.keys()].filter((key) => key.startsWith(RECOVERY_PREFIX));
      assert.ok(recovered.includes(`${RECOVERY_PREFIX}B`), `B survives ${order.join(" → ")}`);
      assert.equal(recoverRun(local, "tab-b", "w", 3_000)?.job.id, "B", order.join(" → "));
    }
  });

  it("a tab acting on a stale read can't erase a run written after it read (review repro)", () => {
    // Tab A reads storage, then tab B saves its run, then A writes based on its
    // earlier read. `staleView` serves A's reads from the snapshot it took
    // while its writes go through to the real storage.
    const staleView = (real: ReturnType<typeof memoryStorage>): StorageLike => {
      const snapshot = new Map(real.data);
      return {
        getItem: (key) => snapshot.get(key) ?? null,
        key: (index) => [...snapshot.keys()][index] ?? null,
        get length() {
          return snapshot.size;
        },
        setItem: (key, value) => real.setItem(key, value),
        removeItem: (key) => real.removeItem(key),
      };
    };
    const local = memoryStorage();
    rememberJob(local, "tab-a", "w", job("A"), 1_000); // 1. storage contains A
    const tabAView = staleView(local); // 3. tab A has read A
    rememberJob(local, "tab-b", "w", job("B"), 2_000); // 2/4. tab B writes A+B
    rememberJob(tabAView, "tab-a", "w", job("A", true), 3_000); // 4. A finishes from its stale read
    assert.equal(recoverRun(local, "tab-b", "w", 4_000)?.job.id, "B", "B's unfinished run is still recoverable");
    assert.equal(local.getItem(`${RECOVERY_PREFIX}A`), null, "A's own entry is gone");
  });

  it("each tab resumes its own run first, scoped by workflow", () => {
    const local = memoryStorage();
    rememberJob(local, "tab-a", "w", job("A"), 1_000);
    rememberJob(local, "tab-b", "w", job("B"), 2_000);
    assert.equal(recoverRun(local, "tab-a", "w", 3_000)?.job.id, "A");
    assert.equal(recoverRun(local, "tab-b", "w", 3_000)?.job.id, "B");
    assert.equal(recoverRun(local, "tab-a", "other_workflow", 3_000), null);
  });

  it("adopts an orphan (its tab is gone) but never a run another open tab is watching", () => {
    const local = memoryStorage();
    rememberJob(local, "open-tab", "w", job("A"), 1_000);
    assert.equal(recoverRun(local, "new-tab", "w", 1_000 + 5_000), null, "fresh entry: its tab is still polling");
    assert.equal(JSON.parse(local.getItem(`${RECOVERY_PREFIX}A`)!).tab, "open-tab", "untouched");
    assert.equal(recoverRun(local, "new-tab", "w", 1_000 + ADOPT_AFTER_MS)?.job.id, "A", "stale entry: orphan, adopted");
    assert.equal(JSON.parse(local.getItem(`${RECOVERY_PREFIX}A`)!).tab, "new-tab");
  });

  it("drops stale and unreadable entries; leaves unrelated keys alone", () => {
    const local = memoryStorage();
    local.setItem("unrelated", "keep me");
    rememberJob(local, "tab-a", "w", job("A"), 1_000);
    local.setItem(`${RECOVERY_PREFIX}broken`, "not json");
    assert.equal(recoverRun(local, "tab-a", "w", 1_000 + 25 * 60 * 60_000), null, "older than a day");
    assert.deepEqual([...local.data.keys()], ["unrelated"]);
  });

  it("migrates the old single-slot format, adoptable only once it goes unrefreshed (an old tab may still watch it)", () => {
    const local = memoryStorage();
    local.setItem(LEGACY_ACTIVE_KEY, JSON.stringify({ workflow: "w", job: job("OLD") }));
    assert.equal(recoverRun(local, "tab-a", "w", 5_000), null, "not taken at once");
    assert.equal(local.getItem(LEGACY_ACTIVE_KEY), null, "legacy key removed");
    assert.ok(local.getItem(`${RECOVERY_PREFIX}OLD`), "now on its own key");
    assert.equal(recoverRun(local, "tab-a", "w", 5_000 + ADOPT_AFTER_MS)?.job.id, "OLD", "orphaned after the usual wait");
  });

  it("when a job is in both legacy formats, the map's owned, timed entry wins over the slot", () => {
    const local = memoryStorage();
    local.setItem(LEGACY_ACTIVE_KEY, JSON.stringify({ workflow: "w", job: job("J") }));
    local.setItem(LEGACY_MAP_KEY, JSON.stringify({ J: { workflow: "w", tab: "tab-a", savedAt: 9_000, job: job("J") } }));
    assert.equal(recoverRun(local, "tab-b", "w", 10_000), null, "tab-b can't take tab-a's live run");
    assert.equal(JSON.parse(local.getItem(`${RECOVERY_PREFIX}J`)!).tab, "tab-a");
    assert.equal(recoverRun(local, "tab-a", "w", 10_000)?.job.id, "J", "its owner resumes it");
  });

  it("migrates the old shared map, keeping each entry's tab, without overwriting newer per-job records", () => {
    const local = memoryStorage();
    rememberJob(local, "tab-b", "w", { ...job("B"), progress: 0.9 }, 2_000); // newer than the map's copy
    local.setItem(
      LEGACY_MAP_KEY,
      JSON.stringify({
        A: { workflow: "w", tab: "tab-a", savedAt: 1_000, job: job("A") },
        B: { workflow: "w", tab: "tab-b", savedAt: 1_000, job: job("B") },
        D: { workflow: "w", tab: "tab-a", savedAt: 1_000, job: job("D", true) },
        bad: null,
      }),
    );
    assert.equal(recoverRun(local, "tab-a", "w", 3_000)?.job.id, "A");
    assert.equal(recoverRun(local, "tab-b", "w", 3_000)?.job.progress, 0.9, "per-job record kept, not the map's copy");
    assert.equal(local.getItem(`${RECOVERY_PREFIX}D`), null, "finished jobs are not migrated");
    assert.equal(local.getItem(LEGACY_MAP_KEY), null);
  });

  it("corrupt or old-format legacy records don't crash or erase unrelated live records", () => {
    for (const legacy of ["not json", "[1,2]", '"x"', "null", '{"A":{"job":"nope"}}']) {
      const local = memoryStorage();
      rememberJob(local, "tab-b", "w", job("LIVE"), 1_000);
      local.setItem("unrelated", "keep me");
      local.setItem(LEGACY_MAP_KEY, legacy);
      local.setItem(LEGACY_ACTIVE_KEY, legacy);
      assert.doesNotThrow(() => recoverRun(local, "tab-a", "w", 2_000));
      assert.equal(recoverRun(local, "tab-b", "w", 2_000)?.job.id, "LIVE", legacy);
      assert.equal(local.getItem("unrelated"), "keep me");
      assert.equal(local.getItem(LEGACY_MAP_KEY), null);
      assert.equal(local.getItem(LEGACY_ACTIVE_KEY), null);
    }
  });

  it("keeps the submitted seeds (including 0) when polls rewrite the entry, and restores them", () => {
    const local = memoryStorage();
    rememberJob(local, "tab-a", "w", job("A"), 1_000, { seed: 0 });
    rememberJob(local, "tab-a", "w", { ...job("A"), progress: 0.5 }, 2_000); // a poll: plain Job, no seeds
    assert.deepEqual(recoverRun(local, "tab-a", "w", 3_000), { job: { ...job("A"), progress: 0.5 }, seeds: { seed: 0 } });
    // An adopting tab gets the seeds too.
    assert.deepEqual(recoverRun(local, "tab-b", "w", 3_000 + ADOPT_AFTER_MS)?.seeds, { seed: 0 });
  });

  it("a watching tab whose polls fail or pause keeps its run by refreshing it", () => {
    const local = memoryStorage();
    rememberJob(local, "tab-a", "w", job("A"), 0);
    for (let at = 30_000; at <= 10 * ADOPT_AFTER_MS; at += 30_000) touchJob(local, "tab-a", "A", at); // heartbeat only
    assert.equal(recoverRun(local, "tab-b", "w", 10 * ADOPT_AFTER_MS + 1_000), null, "not adopted");
    assert.ok(ADOPT_AFTER_MS >= 2 * 60_000, "well above hidden-tab timer throttling");
    touchJob(local, "tab-b", "A", 10 * ADOPT_AFTER_MS + 2_000); // another tab can't refresh it on A's behalf
    assert.equal(JSON.parse(local.getItem(`${RECOVERY_PREFIX}A`)!).tab, "tab-a");
  });

  it("a tab id is stable across reloads of the same tab", () => {
    const session = memoryStorage();
    const first = tabId(session);
    assert.equal(tabId(session), first);
    assert.notEqual(tabId(memoryStorage()), first);
  });
});
