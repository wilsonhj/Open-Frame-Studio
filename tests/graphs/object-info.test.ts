import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BINDINGS } from "../../lib/bindings/index.ts";
// @ts-expect-error: plain .mjs script, no type declarations
import * as oi from "../../scripts/check-object-info.mjs";

type Info = Record<string, { input?: Record<string, Record<string, unknown>>; output?: string[]; api_node?: boolean; deprecated?: boolean }>;
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

const { nodes } = oi.loadSnapshot() as { nodes: Info };
const graphs = oi.loadWorkflows() as Record<string, Graph>;

const problemsFor = (graph: Graph, info: Info = nodes): string[] => oi.checkGraph("t", graph, info);
const mutate = (name: string, edit: (g: Graph) => void): Graph => {
  const g = structuredClone(graphs[name]);
  edit(g);
  return g;
};

describe("check-object-info: workflows vs the Comfy Cloud snapshot", () => {
  it("every workflow passes against the saved snapshot", () => {
    assert.deepEqual(oi.checkAll(graphs, nodes), []);
  });

  it("the snapshot carries no account-specific upload names", () => {
    const spec = nodes.LoadImage.input!.required.image as [string, { options: unknown[] }];
    assert.deepEqual(spec[1].options, []);
  });

  it("flags a node class Cloud doesn't have", () => {
    const g = mutate("image_resize_smoke", (g) => (g["2"].class_type = "NoSuchNode"));
    assert.match(problemsFor(g).join("\n"), /node class not on Comfy Cloud/);
  });

  it("flags a partner (API) node", () => {
    const info = structuredClone(nodes);
    info.ImageScaleBy.api_node = true;
    assert.match(problemsFor(graphs.image_resize_smoke, info).join("\n"), /partner \(API\) node/);
  });

  it("flags out-of-range numbers, wrong types and bad COMBO values", () => {
    const g = mutate("upscale", (g) => {
      g["54"].inputs.steps = 0; // KSampler.steps min 1
      g["54"].inputs.cfg = "1.0";
      g["54"].inputs.sampler_name = "not_a_sampler";
    });
    const out = problemsFor(g).join("\n");
    assert.match(out, /steps: 0 < min 1/);
    assert.match(out, /cfg: expected FLOAT/);
    assert.match(out, /sampler_name: "not_a_sampler" is not one of/);
  });

  it("flags a model file that wasn't on Cloud at snapshot time", () => {
    const g = mutate("klein_t2i", (g) => (g["59"].inputs.unet_name = "flux-3-klein.safetensors"));
    assert.match(problemsFor(g).join("\n"), /not available on Comfy Cloud at snapshot time/);
  });

  it("flags unknown inputs, missing required inputs and bad links", () => {
    const g = mutate("image_resize_smoke", (g) => {
      g["2"].inputs.bogus = 1;
      delete g["2"].inputs.scale_by;
      g["3"].inputs.images = ["2", 5];
      g["2"].inputs.image = ["404", 0];
    });
    const out = problemsFor(g).join("\n");
    assert.match(out, /unknown input "bogus"/);
    assert.match(out, /required input "scale_by" not set/);
    assert.match(out, /no output slot 5/);
    assert.match(out, /links to missing node 404/);
  });

  it("resolves V3 dynamic combo children through the selected option", () => {
    const ok = problemsFor(graphs.upscale);
    assert.deepEqual(ok, []);
    const g = mutate("upscale", (g) => (g["57"].inputs["resize_type.nonexistent"] = 1));
    assert.match(problemsFor(g).join("\n"), /unknown input "resize_type.nonexistent"/);
  });

  it("flags a link whose output type the input doesn't accept", () => {
    const g = mutate("klein_t2i", (g) => (g.p8.inputs.vae = ["59", 0])); // UNETLoader MODEL into VAEDecode.vae
    assert.match(problemsFor(g).join("\n"), /p8 VAEDecode\.vae: expects VAE, but UNETLoader output 0 is MODEL/);
    const slot = mutate("cutout", (g) => (g["16"].inputs.alpha = ["17", 0])); // LoadImage IMAGE into a MASK input
    assert.match(problemsFor(slot).join("\n"), /alpha: expects MASK, but LoadImage output 0 is IMAGE/);
  });

  it("accepts unions, `*` and V3 match types on links, and checks match-type allowed_types", () => {
    // h3_r2v: ComfySwitchNode (allowed *) feeds MODEL and INT; FLOAT feeds the "FLOAT,INT,BOOLEAN" autogrow.
    assert.deepEqual(problemsFor(graphs.h3_r2v), []);
    // upscale: ResizeImageMaskNode output (IMAGE,MASK) feeds IMAGE inputs; it must not feed a MODEL input.
    const g = mutate("upscale", (g) => (g["61"].inputs.model = ["57", 0]));
    assert.match(problemsFor(g).join("\n"), /SeedVR2Conditioning\.model: expects MODEL, but ResizeImageMaskNode output 0 is IMAGE,MASK/);
    const union = mutate("h3_r2v", (g) => (g["131"].inputs["values.a"] = ["138", 0])); // STRING into FLOAT,INT,BOOLEAN
    assert.match(problemsFor(union).join("\n"), /values\.a: expects FLOAT,INT,BOOLEAN, but PrimitiveStringMultiline output 0 is STRING/);
  });

  it("validates autogrow child names and counts", () => {
    const named = mutate("klein_edit_multiref", (g) => (g["17"].inputs["images.foo"] = ["54", 0]));
    assert.match(problemsFor(named).join("\n"), /unknown input "images\.foo"/);
    const prefixed = mutate("h3_r2v", (g) => (g["136"].inputs["ref_images.ref_image_x"] = ["137", 0]));
    assert.match(problemsFor(prefixed).join("\n"), /unknown input "ref_images\.ref_image_x"/);
    const letters = mutate("h3_r2v", (g) => (g["131"].inputs["values.a1"] = ["132", 0])); // names template: a..z only
    assert.match(problemsFor(letters).join("\n"), /unknown input "values\.a1"/);
    const tooMany = mutate("h3_r2v", (g) => {
      for (let i = 2; i < 10; i++) g["136"].inputs[`ref_images.ref_image_${i}`] = ["137", 0];
    });
    assert.match(problemsFor(tooMany).join("\n"), /10 "ref_images" inputs, max 9/);
    const tooFew = mutate("h3_r2v", (g) => delete g["131"].inputs["values.a"]); // required, min 1
    assert.match(problemsFor(tooFew).join("\n"), /0 "values" input\(s\), min 1/);
  });

  it("requires the inputs of the selected dynamic combo option", () => {
    const g = mutate("klein_edit_multiref", (g) => delete g["17"].inputs["resolution.megapixels"]);
    assert.match(problemsFor(g).join("\n"), /required input "resolution\.megapixels" not set \(resolution = "resize"\)/);
    const keep = mutate("klein_edit_multiref", (g) => {
      g["17"].inputs.resolution = "keep resolution";
      delete g["17"].inputs["resolution.megapixels"];
    });
    assert.deepEqual(problemsFor(keep), []);
  });
});

describe("bindings agree with the Cloud widget specs", () => {
  const typeOf = (spec: unknown): [string | undefined, Record<string, unknown>] => {
    if (!Array.isArray(spec)) return [undefined, {}];
    const [type, opts = {}] = spec as [unknown, Record<string, unknown>];
    return Array.isArray(type) ? ["COMBO", { ...opts, options: type }] : [type as string, opts];
  };
  const KIND: Record<string, string[]> = { int: ["INT"], float: ["FLOAT"], bool: ["BOOLEAN"], text: ["STRING", "COMBO"], image: ["COMBO"] };

  for (const binding of Object.values(BINDINGS)) {
    it(`${binding.workflow}: kinds, ranges and choices fit each bound widget`, () => {
      const graph = graphs[binding.workflow];
      for (const [name, spec] of Object.entries(binding.inputs)) {
        for (const { node, field } of [spec, ...(spec.mirrors ?? [])]) {
          const info = nodes[graph[node].class_type];
          const widgets = { ...(info.input?.required ?? {}), ...(info.input?.optional ?? {}) };
          const dot = field.indexOf(".");
          if (dot !== -1) continue; // dynamic child: covered by checkGraph on the literal value
          const [type, opts] = typeOf(widgets[field]);
          assert.ok(type, `${name}: ${node}.${field} is a widget`);
          assert.ok(KIND[spec.kind].includes(type!), `${name}: kind ${spec.kind} vs widget ${type}`);
          if (spec.min !== undefined && typeof opts.min === "number") assert.ok(spec.min >= opts.min, `${name}: min ${spec.min} < widget min ${opts.min}`);
          if (spec.max !== undefined && typeof opts.max === "number") assert.ok(spec.max <= opts.max, `${name}: max ${spec.max} > widget max ${opts.max}`);
          if (spec.choices && type === "COMBO" && !opts._trimmed) {
            const options = (opts.options as unknown[]).map((o) => (typeof o === "object" && o ? (o as { key: string }).key : o));
            for (const c of spec.choices) assert.ok(options.includes(c), `${name}: choice ${c} not a widget option`);
          }
          if (spec.randomize) assert.equal(type, "INT", `${name}: randomize needs an INT widget`);
        }
      }
    });
  }
});
