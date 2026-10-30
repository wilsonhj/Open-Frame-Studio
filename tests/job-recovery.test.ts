import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ADOPT_AFTER_MS, RECOVERY_PREFIX, forgetJob, recoverJob, rememberJob, tabId, type StorageLike } from "../lib/job-recovery.ts";
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
    assert.equal(recoverJob(local, "tab-b", "image_resize_smoke", 4_000)?.id, "B");
  });

  it("interleaved tabs can't lose each other's run (review repro: B saves while A finishes)", () => {
    // Each tab's update is one write to its own key, so every ordering of the
    // two tabs' operations must leave B recoverable.
    const steps = {
      bSaves: (s: StorageLike) => rememberJob(s, "tab-b", "w", job("B"), 2_000),
      aFinishes: (s: StorageLike) => rememberJob(s, "tab-a", "w", job("A", true), 2_000),
      aForgets: (s: StorageLike) => forgetJob(s, "A"),
      cRecovers: (s: StorageLike) => void recoverJob(s, "tab-c", "w", 2_500),
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
      assert.equal(recoverJob(local, "tab-b", "w", 3_000)?.id, "B", order.join(" → "));
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
    assert.equal(recoverJob(local, "tab-b", "w", 4_000)?.id, "B", "B's unfinished run is still recoverable");
    assert.equal(local.getItem(`${RECOVERY_PREFIX}A`), null, "A's own entry is gone");
  });

  it("each tab resumes its own run first, scoped by workflow", () => {
    const local = memoryStorage();
    rememberJob(local, "tab-a", "w", job("A"), 1_000);
    rememberJob(local, "tab-b", "w", job("B"), 2_000);
    assert.equal(recoverJob(local, "tab-a", "w", 3_000)?.id, "A");
    assert.equal(recoverJob(local, "tab-b", "w", 3_000)?.id, "B");
    assert.equal(recoverJob(local, "tab-a", "other_workflow", 3_000), null);
  });

  it("adopts an orphan (its tab is gone) but never a run another open tab is watching", () => {
    const local = memoryStorage();
    rememberJob(local, "open-tab", "w", job("A"), 1_000);
    assert.equal(recoverJob(local, "new-tab", "w", 1_000 + 5_000), null, "fresh entry: its tab is still polling");
    assert.equal(JSON.parse(local.getItem(`${RECOVERY_PREFIX}A`)!).tab, "open-tab", "untouched");
    assert.equal(recoverJob(local, "new-tab", "w", 1_000 + ADOPT_AFTER_MS)?.id, "A", "stale entry: orphan, adopted");
    assert.equal(JSON.parse(local.getItem(`${RECOVERY_PREFIX}A`)!).tab, "new-tab");
  });

  it("drops stale and unreadable entries; leaves unrelated keys alone", () => {
    const local = memoryStorage();
    local.setItem("unrelated", "keep me");
    rememberJob(local, "tab-a", "w", job("A"), 1_000);
    local.setItem(`${RECOVERY_PREFIX}broken`, "not json");
    assert.equal(recoverJob(local, "tab-a", "w", 1_000 + 25 * 60 * 60_000), null, "older than a day");
    assert.deepEqual([...local.data.keys()], ["unrelated"]);
  });

  it("a tab id is stable across reloads of the same tab", () => {
    const session = memoryStorage();
    const first = tabId(session);
    assert.equal(tabId(session), first);
    assert.notEqual(tabId(memoryStorage()), first);
  });
});
