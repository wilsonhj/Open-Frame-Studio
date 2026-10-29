import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BindingError, applyBindings, checkBinding, resolveAssignments, type ApiGraph } from "../lib/bindings/apply.ts";
import { cutout } from "../lib/bindings/cutout.ts";
import { H3_ASPECT_OPTIONS, h3R2v } from "../lib/bindings/h3_r2v.ts";
import { kleinEditMultiref } from "../lib/bindings/klein_edit_multiref.ts";
import { kleinT2i } from "../lib/bindings/klein_t2i.ts";
import { upscale } from "../lib/bindings/upscale.ts";
import type { GraphBinding, GraphInputBinding, GraphValue } from "../lib/types.ts";
import { WORKFLOW_NAMES } from "../lib/types.ts";

const BINDINGS: GraphBinding[] = [kleinEditMultiref, kleinT2i, cutout, upscale, h3R2v];

async function loadGraph(name: string): Promise<ApiGraph> {
  return JSON.parse(await readFile(join(process.cwd(), "workflows", `${name}.api.json`), "utf-8")) as ApiGraph;
}

/** A value of the right kind that differs from whatever the graph holds. */
function sampleValue(name: string, spec: GraphInputBinding): GraphValue {
  switch (spec.kind) {
    case "image":
      return `test_${name}.png`;
    case "text":
      return `test text for ${name}`;
    case "int":
      return 777;
    case "float":
      return 3.25;
    case "bool":
      return false;
  }
}

const SAVE_NODES = /^Save(Image|Video|Animated\w*)$/;

for (const binding of BINDINGS) {
  describe(`binding ${binding.workflow}`, () => {
    it("is a registered workflow and matches its graph (no drift)", async () => {
      assert.ok((WORKFLOW_NAMES as readonly string[]).includes(binding.workflow));
      const graph = await loadGraph(binding.workflow);
      assert.deepEqual(checkBinding(graph, binding), []);
      for (const node of Object.values(binding.outputs)) {
        assert.match(graph[node].class_type, SAVE_NODES, `output node ${node} is a Save node`);
      }
    });

    for (const [name, spec] of Object.entries(binding.inputs)) {
      it(`input "${name}" sets ${spec.node}.${spec.field}${spec.mirrors ? " (+ mirrors)" : ""} only`, async () => {
        const graph = await loadGraph(binding.workflow);
        const before = structuredClone(graph);
        const value = sampleValue(name, spec);
        const next = applyBindings(graph, binding, { [name]: value });

        assert.deepEqual(graph, before, "input graph is not mutated");
        const targets = [spec, ...(spec.mirrors ?? [])];
        for (const { node, field } of targets) {
          assert.notDeepEqual(before[node].inputs[field], value, `sample differs from the default at ${node}.${field}`);
          assert.deepEqual(next[node].inputs[field], value);
        }
        // Nothing else changed.
        for (const { node, field } of targets) next[node].inputs[field] = before[node].inputs[field];
        assert.deepEqual(next, before);
      });
    }

    it("rejects unknown logical names and wrong kinds", async () => {
      const graph = await loadGraph(binding.workflow);
      assert.throws(() => applyBindings(graph, binding, { nope: "x" }), BindingError);
      assert.throws(() => applyBindings(graph, binding, JSON.parse(`{"__proto__": "x"}`)), BindingError);
      assert.throws(() => applyBindings(graph, binding, { toString: "x" }), BindingError);
      for (const [name, spec] of Object.entries(binding.inputs)) {
        const wrong: GraphValue = spec.kind === "text" || spec.kind === "image" ? 1.5 : "not-a-number";
        assert.throws(() => applyBindings(graph, binding, { [name]: wrong }), BindingError, `${name} kind check`);
      }
    });
  });
}

describe("applyBindings", () => {
  it("validates value kinds precisely", async () => {
    const graph = await loadGraph("klein_edit_multiref");
    assert.throws(() => applyBindings(graph, kleinEditMultiref, { seed: 1.5 }), /integer/);
    assert.throws(() => applyBindings(graph, kleinEditMultiref, { cfg: Number.NaN }), /finite/);
    assert.throws(() => applyBindings(graph, kleinEditMultiref, { image_1: "  " }), /image/);
    const h3 = await loadGraph("h3_r2v");
    assert.throws(() => applyBindings(h3, h3R2v, { turbo: "true" }), /boolean/);
    // An opaque SDK asset handle is accepted for images.
    const handle = { kind: "asset" };
    assert.equal(applyBindings(graph, kleinEditMultiref, { image_1: handle })["54"].inputs.image, handle);
  });

  it("keeps Klein latent and scheduler sizes in sync", async () => {
    const next = applyBindings(await loadGraph("klein_edit_multiref"), kleinEditMultiref, { width: 832, height: 1216 });
    assert.deepEqual([next["44"].inputs.width, next["44"].inputs.height], [832, 1216]);
    assert.deepEqual([next["71"].inputs.width, next["71"].inputs.height], [832, 1216]);
  });

  it("applies many inputs at once and lists SDK assignments", async () => {
    const values = { prompt: "a mug", seed: 5, width: 1024 };
    const assignments = resolveAssignments(kleinT2i, values);
    assert.deepEqual(
      assignments.map((a) => `${a.node}.${a.field}=${String(a.value)}`).sort(),
      ["p4.text=a mug", "p44.width=1024", "p70.noise_seed=5", "p71.width=1024"],
    );
  });

  it("detects binding drift against a graph", async () => {
    const graph = await loadGraph("cutout");
    delete graph["17"];
    assert.throws(() => applyBindings(graph, cutout, { image: "a.png" }), /not in cutout/);
    assert.deepEqual(checkBinding(graph, cutout), ["image: node 17 missing"]);
    const linked = await loadGraph("cutout");
    linked["17"].inputs.image = ["99", 0];
    assert.throws(() => applyBindings(linked, cutout, { image: "a.png" }), /link/);
  });
});

describe("workflow files", () => {
  it("ships an API-format graph for every WorkflowName", async () => {
    for (const name of WORKFLOW_NAMES) {
      const graph = await loadGraph(name);
      for (const [id, node] of Object.entries(graph)) assert.equal(typeof node.class_type, "string", `${name}:${id}`);
    }
  });

  it("uses the Wave 0 model picks", async () => {
    assert.equal((await loadGraph("upscale"))["52"].inputs.unet_name, "seedvr2_3b_int8_convrot.safetensors");
    assert.equal((await loadGraph("upscale"))["59"].inputs.color_correction_method, "wavelet");
    assert.equal((await loadGraph("klein_edit_multiref"))["59"].inputs.unet_name, "flux-2-klein-4b.safetensors");
    assert.equal((await loadGraph("klein_t2i"))["59"].inputs.unet_name, "flux-2-klein-4b.safetensors");
    assert.equal((await loadGraph("h3_r2v"))["119"].inputs.vae_name, "minimax_h3_video_vae_fp16.safetensors");
    assert.ok(Object.values(H3_ASPECT_OPTIONS).includes((await loadGraph("h3_r2v"))["115"].inputs.aspect_ratio as string));
  });
});
