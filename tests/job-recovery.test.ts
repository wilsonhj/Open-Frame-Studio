import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RECOVERY_KEY, forgetJob, recoverJob, rememberJob, tabId, type StorageLike } from "../lib/job-recovery.ts";
import type { Job } from "../lib/types.ts";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
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
  it("one tab finishing its job doesn't erase another tab's unfinished job (review repro)", () => {
    const local = memoryStorage();
    rememberJob(local, "tab-a", "image_resize_smoke", job("A"), 1_000);
    rememberJob(local, "tab-b", "image_resize_smoke", job("B"), 2_000);
    rememberJob(local, "tab-a", "image_resize_smoke", job("A", true), 3_000); // A finishes

    assert.equal(recoverJob(local, "tab-b", "image_resize_smoke", 4_000)?.id, "B", "B is still recoverable after reload");
    assert.equal(recoverJob(local, "tab-a", "image_resize_smoke", 4_000)?.id, "B", "A's own entry is gone; it may adopt B");
  });

  it("each tab resumes its own run first", () => {
    const local = memoryStorage();
    rememberJob(local, "tab-a", "image_resize_smoke", job("A"), 1_000);
    rememberJob(local, "tab-b", "image_resize_smoke", job("B"), 2_000);
    assert.equal(recoverJob(local, "tab-a", "image_resize_smoke", 3_000)?.id, "A");
    assert.equal(recoverJob(local, "tab-b", "image_resize_smoke", 3_000)?.id, "B");
    assert.equal(recoverJob(local, "tab-a", "other_workflow", 3_000), null, "scoped by workflow");
  });

  it("forgetJob drops only that job; stale and corrupt entries are ignored", () => {
    const local = memoryStorage();
    rememberJob(local, "tab-a", "w", job("A"), 1_000);
    rememberJob(local, "tab-b", "w", job("B"), 2_000);
    forgetJob(local, "A", 3_000);
    assert.equal(recoverJob(local, "tab-a", "w", 3_000)?.id, "B");
    assert.equal(recoverJob(local, "tab-a", "w", 2_000 + 25 * 60 * 60_000), null, "older than a day: dropped");
    local.setItem(RECOVERY_KEY, "not json");
    assert.equal(recoverJob(local, "tab-a", "w"), null);
  });

  it("a tab id is stable across reloads of the same tab", () => {
    const session = memoryStorage();
    const first = tabId(session);
    assert.equal(tabId(session), first);
    assert.notEqual(tabId(memoryStorage()), first, "another tab gets its own id");
  });
});
