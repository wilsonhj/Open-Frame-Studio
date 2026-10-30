import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deadlineCanceledJob } from "../lib/comfy.ts";
import { describeJob } from "../lib/job-status.ts";
import type { Job } from "../lib/types.ts";

const job = (patch: Partial<Job>): Job => ({
  id: "j",
  status: "queued",
  terminal: false,
  progress: null,
  step: null,
  queuePosition: null,
  outputs: [],
  error: null,
  ...patch,
});

describe("describeJob", () => {
  it("shows the queue position when the server reports one", () => {
    assert.equal(describeJob(job({})), "Waiting for a GPU…");
    assert.equal(describeJob(job({ queuePosition: 3 })), "Waiting for a GPU (queue position 3)…");
    assert.equal(describeJob(job({ queuePosition: 0 })), "Waiting for a GPU (queue position 0)…", "base is undefined, so no 'next up'");
  });

  it("shows the node and sampler step while running, never an invented percentage", () => {
    const step = { current: 21, total: 50, nodeClass: "KSampler" };
    assert.equal(describeJob(job({ status: "running", step, progress: 0.42 })), "Running KSampler: step 21 of 50 (42%)…");
    assert.equal(describeJob(job({ status: "running", progress: 0.5 })), "Running (50%)…");
    assert.equal(describeJob(job({ status: "running" })), "Running…");
  });

  it("reports terminal states and errors", () => {
    assert.equal(describeJob(job({ status: "succeeded", terminal: true })), "Done.");
    const error = { code: "execution_error", message: "Mock node exploded." };
    assert.equal(describeJob(job({ status: "failed", terminal: true, error })), "Mock node exploded.");
    assert.equal(describeJob(job({ status: "expired", terminal: true })), "Job expired.");
  });

  it("shows an error ahead of a still-live status (over-budget job awaiting its cancel)", () => {
    const error = { code: "poll_timeout", message: "Job ran past its 15-minute budget; cancel requested." };
    assert.equal(describeJob(job({ status: "running", error })), error.message);
    assert.equal(describeJob(job({ status: "queued", queuePosition: 2, error })), error.message);
  });

  it("a job its deadline canceled says it ran past its time budget, as the server reports it", () => {
    const canceled = job({ status: "canceled", terminal: true, error: { code: "canceled", message: "Job canceled." } });
    assert.equal(describeJob(deadlineCanceledJob(canceled, 15 * 60_000)), "Stopped: it ran past its 15-minute time budget.");
    assert.equal(describeJob(deadlineCanceledJob(canceled, 3000)), "Stopped: it ran past its 3-second time budget.");
  });
});
