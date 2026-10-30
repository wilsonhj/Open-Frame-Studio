import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// @ts-expect-error: plain .mjs script, no type declarations
import { checkModels, referencedModels, verifyModels } from "../../scripts/check-models.mjs";

type Model = { filename: string; folder: string; licence: string; sha256: string | null; sizeBytes?: number; source: { repo: string; url: string; revision?: string; download?: string } };
const manifest = JSON.parse(readFileSync(join(process.cwd(), "models/manifest.json"), "utf8")) as { models: Model[] };

describe("models/manifest.json", () => {
  it("covers every workflow model and passes checkModels", () => {
    assert.deepEqual(checkModels(manifest, referencedModels()).problems, []);
  });

  it("pins every model to a revision with its size and sha256", () => {
    for (const m of manifest.models) {
      assert.match(m.sha256 ?? "", /^[0-9a-f]{64}$/, m.filename);
      assert.ok(Number.isSafeInteger(m.sizeBytes) && m.sizeBytes! > 0, m.filename);
      assert.match(m.source.revision ?? "", /^[0-9a-f]{40}$/, m.filename);
      assert.equal(m.source.download, `https://huggingface.co/${m.source.repo}/resolve/${m.source.revision}/${m.source.url.split("/blob/main/")[1]}`);
    }
  });

  it("never calls the MiniMax H3 licence permissive", () => {
    for (const m of manifest.models.filter((x) => /minimax/i.test(x.filename))) assert.match(m.licence, /conditional/i);
    const bad = structuredClone(manifest);
    bad.models.find((m) => /minimax/i.test(m.filename))!.licence = "MiniMax H3 Community License (permissive)";
    assert.match(checkModels(bad, referencedModels()).problems.join("\n"), /never "permissive"/);
  });
});

describe("check-models --verify", () => {
  it("matches size and sha256, reports mismatches, and skips files that aren't there", async () => {
    const dir = mkdtempSync(join(tmpdir(), "models-"));
    try {
      const good = Buffer.from("good weights");
      const bad = Buffer.from("tampered");
      const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
      mkdirSync(join(dir, "vae"));
      writeFileSync(join(dir, "vae/a.safetensors"), good);
      writeFileSync(join(dir, "vae/b.safetensors"), bad);
      const fake = {
        models: [
          { filename: "a.safetensors", folder: "vae", sha256: sha(good), sizeBytes: good.length },
          { filename: "b.safetensors", folder: "vae", sha256: sha(good), sizeBytes: bad.length },
          { filename: "c.safetensors", folder: "vae", sha256: sha(good), sizeBytes: 3 },
        ],
      };
      const result = await verifyModels(fake, dir);
      assert.deepEqual(result.ok, ["a.safetensors"]);
      assert.match(result.problems.join("\n"), /b\.safetensors: sha256/);
      assert.equal(result.missing.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
