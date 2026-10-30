"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { CARD_SPECS, expandAssets } from "../../lib/cards/assets";
import { regenerateBlocker, tileFor } from "../../lib/cards/tiles";
import { useRun } from "../../lib/client/use-run";
import type { CardAssetId, CardScope, CardsResult, CardTile, MainImageCheck, PipelineRun } from "../../lib/types";
import { Button, Card, Chip, StatusPill } from "../ui";
import { CopyFields, EMPTY_COPY, copyToRequest, type CopyDraft } from "./copy-fields";

const SCOPES: { id: CardScope; label: string }[] = [
  { id: "hero", label: "Hero only" },
  { id: "gallery", label: "Gallery · 6" },
  { id: "story", label: "Story · 8" },
  { id: "complete", label: "Complete set · 13" },
];

/** What each panel needs, in plain words, when its copy is missing. */
const FIELD_NAMES: Record<string, string> = {
  productName: "a product name",
  bullets: "3–5 benefits",
  boxContents: "what's in the box",
  painPoints: "problems it solves",
  "ingredients|specs": "ingredients or specs",
  efficacyClaims: "results",
  efficacySource: "the source of the results",
  howToUse: "how-to steps",
  endorsement: "an endorsement you have the rights to",
};

const LABELS: Record<CardAssetId, string> = {
  hero: "Hero image",
  gallery_callouts: "Callouts",
  gallery_angles: "Angles",
  gallery_detail: "Detail",
  gallery_in_use: "In use",
  gallery_contents: "Contents",
  story_banner: "Story banner",
  story_problem_solution: "Problem / solution",
  story_feature_grid: "Feature grid",
  story_materials: "Materials",
  story_results: "Results",
  story_how_to: "How to",
  story_social_proof: "Social proof",
};

/** What a failed check means for the user, in plain words (docs/spec/listing.md §5.1). */
const CHECK_FAILURE: Record<string, string> = {
  A1: "The border of the image is not pure white.",
  A2: "The product does not fill 85% of the frame.",
  A3: "The image is not a 2000×2000 RGB file.",
  A4: "The background was not removed: the cutout has no transparency. Try a photo on a plain background.",
  A5: "More than one object was found in the photo.",
  A6: "The product is too small in the photo (it needs at least 425 px on its longest side). Upload a larger photo.",
  A7: "The product is almost all white, so it may not stand out on a white background.",
  C3: "The product is not centred inside the frame, or it touches the edge.",
};

/**
 * Why the hero image is missing, by state, when no check explains it (for
 * example the cutout step ended without a result). Every non-success state has
 * a reason; the board pairs it with "Try again" and "Upload a different photo".
 */
const STATE_REASON: Record<string, string> = {
  failed: "The hero image could not be made.",
  timed_out: "The cutout took too long and was stopped.",
  expired: "The cutout job expired on the server before it finished.",
  unknown: "We lost track of the cutout job, so its result is unknown.",
  needs_input: "This step needs more information before it can run.",
  canceled: "The run was canceled.",
};

function mainView(run: PipelineRun<"listing"> | null): { url: string | null; checks: MainImageCheck[]; ok: boolean | null } {
  if (!run) return { url: null, checks: [], ok: null };
  const result: CardsResult | null = run.result;
  if (result?.main) return { url: result.main.compositeUrl, checks: result.main.checks, ok: result.main.ok };
  // Before the run is terminal, read the compose step directly.
  const step = run.steps.find((s) => s.id === "compose_main");
  const data = step?.data as { checks?: MainImageCheck[]; ok?: boolean } | undefined;
  return { url: step?.outputs?.[0]?.url ?? null, checks: data?.checks ?? [], ok: data?.ok ?? null };
}

/** `runId`: resume this run (the `?run=` deep link from /runs), else this tab's last run. */
export function CardsBoard({ runId }: { runId?: string } = {}) {
  const { run, error, polling, start, action, reset } = useRun("listing", { runId });
  const [scope, setScope] = useState<CardScope>("hero");
  const [copy, setCopy] = useState<CopyDraft>(EMPTY_COPY);
  const [regenerating, setRegenerating] = useState<CardAssetId | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Revoke the preview's object URL when it is replaced and on unmount.
  const previewRef = useRef<string | null>(null);
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);
  function pickFile(next: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next ? URL.createObjectURL(next) : null;
    setFile(next);
    setPreview(previewRef.current);
  }

  async function submit() {
    if (!file) return;
    setSubmitError(null);
    setBusy(true);
    const body = new FormData();
    // The hero never shows text (spec C6): copy is sent only for the panels.
    const request = { scope, productImages: [{ upload: "product" }], ...(scope === "hero" ? {} : copyToRequest(copy)) };
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

  async function regenerate(asset: CardAssetId) {
    setRegenerating(asset);
    setSubmitError(null);
    try {
      await action(`tiles/${asset}/regenerate`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenerating(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  const main = mainView(run);
  const heroTile = run?.result?.tiles.find((t) => t.asset === "hero");
  const mainState = heroTile?.state ?? run?.status ?? null;
  // Why the hero image failed, in plain words: the failing error-level checks,
  // else the step error (e.g. the cutout failed), else the run error.
  const failedChecks = main.checks.filter((c) => !c.ok && c.level === "error");
  const stateReason = mainState ? STATE_REASON[mainState] : undefined;
  const detail = heroTile?.error?.message ?? run?.error?.message;
  const failure =
    stateReason || main.ok === false
      ? failedChecks.length
        ? failedChecks.map((c) => CHECK_FAILURE[c.id] ?? c.message)
        : [stateReason ?? STATE_REASON.failed, ...(detail ? [`Details: ${detail}`] : [])]
      : [];

  const planned = run ? expandAssets(run.request) : expandAssets({ scope });
  const panels: CardTile[] = planned.filter((a) => a !== "hero").map((a) => (run ? tileFor(run, a) : emptyTile(a)));
  // Every terminal run status: a canceled run keeps the tiles it finished.
  const finished = run && ["succeeded", "partial", "failed", "canceled"].includes(run.status);
  const exportable = finished && (main.ok || panels.some((t) => t.state === "succeeded"));

  return (
    <div className="space-y-6">
      <Card title="Product">
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="What to make">
          {SCOPES.map((s) => (
            <Chip key={s.id} selected={scope === s.id} onClick={() => setScope(s.id)} disabled={!!run}>
              {s.label}
            </Chip>
          ))}
        </div>
        {scope !== "hero" && !run ? (
          <details className="mb-4 rounded-lg border border-border p-3" open>
            <summary className="cursor-pointer text-sm font-semibold">Copy for the panels</summary>
            <p className="my-2 text-xs text-muted">
              Text is drawn exactly as you type it. Panels whose copy is left empty are skipped and say what to add; nothing is
              made up.
            </p>
            <CopyFields value={copy} onChange={setCopy} />
          </details>
        ) : null}
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span>Product photo (one product, PNG/JPEG/WebP)</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <Button type="submit" disabled={!file || !!run} busy={busy || polling}>
            {scope === "hero" ? "Generate main image" : `Generate ${planned.length} images`}
          </Button>
          {exportable ? (
            <a
              href={`/api/pipelines/listing/${run!.id}/export`}
              download
              className="inline-flex rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/10"
            >
              Download ZIP
            </a>
          ) : null}
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
        <Card className="sm:col-span-2 lg:col-span-3" data-asset="hero">
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
                <p className="text-sm text-muted">Checks A1–A7 and C3 run on the written file once the image is composed.</p>
              )}
              {failure.length ? (
                <div role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <ul className="list-disc space-y-1 pl-4">
                    {failure.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    {file && failedChecks.length === 0 ? (
                      <Button onClick={() => void submit()} busy={busy || polling}>
                        Try again
                      </Button>
                    ) : null}
                    <Button variant="ghost" onClick={reset}>
                      Upload a different photo
                    </Button>
                  </div>
                </div>
              ) : null}
              {main.url && main.ok ? (
                <a
                  href={main.url}
                  download={main.url.split("/").pop() || "01_hero.png"}
                  className="inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Download
                </a>
              ) : null}
            </div>
          </div>
        </Card>

        {panels.map((tile) => (
          <PanelTile
            key={tile.asset}
            tile={tile}
            busy={regenerating === tile.asset}
            canRegenerate={!!finished && main.ok === true && tile.state !== "needs_input" && regenerateBlocker(run, tile.asset) === null}
            onRegenerate={() => void regenerate(tile.asset)}
          />
        ))}
      </div>
    </div>
  );
}

function emptyTile(asset: CardAssetId): CardTile {
  return { asset, state: "pending", seed: null, url: null, missing: [], error: null };
}

function PanelTile({
  tile,
  busy,
  canRegenerate,
  onRegenerate,
}: {
  tile: CardTile;
  busy: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
}) {
  const spec = CARD_SPECS[tile.asset];
  const [w, h] = spec.exportPx ?? [1, 1];
  const wide = w > h;
  return (
    <Card data-asset={tile.asset} className={wide ? "sm:col-span-2" : undefined}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{LABELS[tile.asset]}</h2>
        <StatusPill status={tile.state} label={tile.state === "needs_input" ? "needs input" : undefined} />
      </div>
      <div
        className="mt-3 flex items-center justify-center overflow-hidden rounded-lg border border-border bg-white"
        style={{ aspectRatio: `${w} / ${h}` }}
      >
        {tile.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- run file served by the pipeline route
          <img src={tile.url} alt={LABELS[tile.asset]} className="h-full w-full object-contain" />
        ) : (
          <span className="px-4 text-center text-xs text-muted">
            {tile.state === "needs_input"
              ? `Add ${tile.missing.map((m) => FIELD_NAMES[m] ?? m).join(" and ")} to make this panel.`
              : tile.error?.message ??
                (tile.state === "pending" ? "Waits for the hero image" : tile.state === "canceled" ? "Canceled" : "Working…")}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
        <span>
          {w}×{h}
          {tile.seed !== null ? ` · seed ${tile.seed}` : ""}
        </span>
        {canRegenerate ? (
          <Button variant="ghost" onClick={onRegenerate} busy={busy} aria-label={`Regenerate ${LABELS[tile.asset]}`}>
            Regenerate
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
