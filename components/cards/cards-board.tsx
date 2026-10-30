"use client";

import { useState, type FormEvent } from "react";

import { useRun } from "../../lib/client/use-run";
import type { CardAssetId, CardsResult, MainImageCheck, PipelineRun } from "../../lib/types";
import { CARD_ASSETS } from "../../lib/types";
import { Button, Card, StatusPill } from "../ui";

const LABELS: Record<CardAssetId, string> = {
  main_image: "Main image",
  infographic: "Infographic",
  multi_angle: "Multi-angle",
  detail_shot: "Detail shot",
  lifestyle: "Lifestyle",
  whats_in_box: "What's in the box",
  aplus_hero_banner: "A+ hero banner",
  aplus_pain_points: "A+ pain points",
  aplus_features: "A+ features",
  aplus_ingredients: "A+ ingredients",
  aplus_efficacy: "A+ efficacy",
  aplus_how_to_use: "A+ how to use",
  aplus_endorsement: "A+ endorsement",
};

function mainView(run: PipelineRun<"cards"> | null): { url: string | null; checks: MainImageCheck[]; ok: boolean | null } {
  if (!run) return { url: null, checks: [], ok: null };
  const result: CardsResult | null = run.result;
  if (result?.main) return { url: result.main.compositeUrl, checks: result.main.checks, ok: result.main.ok };
  // Before the run is terminal, read the compose step directly.
  const step = run.steps.find((s) => s.id === "compose_main");
  const data = step?.data as { checks?: MainImageCheck[]; ok?: boolean } | undefined;
  return { url: step?.outputs?.[0]?.url ?? null, checks: data?.checks ?? [], ok: data?.ok ?? null };
}

export function CardsBoard() {
  const { run, error, polling, start, reset } = useRun("cards");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitError(null);
    setBusy(true);
    const body = new FormData();
    const request = { scope: "main", productImages: [{ upload: "product" }], ...(productName.trim() ? { productName } : {}) };
    body.append("request", JSON.stringify(request));
    body.append("product", file);
    try {
      await start(body);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const main = mainView(run);
  const mainState = run?.result?.tiles.find((t) => t.asset === "main_image")?.state ?? run?.status ?? null;

  return (
    <div className="space-y-6">
      <Card title="Product">
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span>Product photo (one product, PNG/JPEG/WebP)</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Product name</span>
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. Vitamin C serum"
              className="rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>
          <Button type="submit" disabled={!file} busy={busy || polling}>
            Generate main image
          </Button>
          {run ? (
            <Button variant="ghost" onClick={reset}>
              Reset
            </Button>
          ) : null}
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={preview} alt="Selected product" className="h-20 rounded border border-border" />
          ) : null}
        </form>
        {submitError || error ? <p className="mt-3 text-sm text-red-600">{submitError ?? error}</p> : null}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="sm:col-span-2 lg:col-span-3" data-asset="main_image">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Main image · 2000×2000 on pure white</h2>
            {mainState ? <StatusPill status={mainState} /> : null}
            {main.ok !== null ? (
              <StatusPill status={main.ok ? "succeeded" : "failed"} label={main.ok ? "compliant" : "not compliant"} />
            ) : null}
          </div>
          <div className="flex flex-col gap-6 md:flex-row">
            <div className="flex aspect-square w-full max-w-md items-center justify-center rounded-lg border border-border bg-white">
              {main.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- run file served by the pipeline route
                <img src={main.url} alt="Main image" className="h-full w-full object-contain" />
              ) : (
                <span className="text-sm text-muted">{polling ? "Cutting out and composing…" : "No image yet"}</span>
              )}
            </div>
            <div className="flex-1 space-y-3">
              <h3 className="text-sm font-semibold">Compliance checks</h3>
              {main.checks.length ? (
                <ul className="space-y-1 text-sm" data-testid="main-checks">
                  {main.checks.map((c) => (
                    <li key={c.id} className="flex gap-2">
                      <span
                        aria-label={c.ok ? "pass" : "fail"}
                        className={c.ok ? "text-green-600" : c.level === "warn" ? "text-amber-600" : "text-red-600"}
                      >
                        {c.ok ? "✓" : c.level === "warn" ? "!" : "✗"}
                      </span>
                      <span className="font-mono">{c.id}</span>
                      <span className="flex-1">{c.message}</span>
                      {c.value !== undefined ? <span className="font-mono text-muted">{c.value}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">A1–A7 run on the written file once the image is composed.</p>
              )}
              {main.url ? (
                <a
                  href={main.url}
                  download="main.png"
                  className="inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Download
                </a>
              ) : null}
            </div>
          </div>
        </Card>

        {CARD_ASSETS.filter((a) => a !== "main_image").map((asset) => (
          <Card key={asset} data-asset={asset} className="opacity-50">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{LABELS[asset]}</h2>
              <StatusPill status="skipped" label="coming next" />
            </div>
            <div className="mt-3 aspect-square rounded-lg border border-dashed border-border" />
          </Card>
        ))}
      </div>
    </div>
  );
}
