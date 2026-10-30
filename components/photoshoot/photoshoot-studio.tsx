"use client";
/**
 * Product Photoshoot screen (docs/spec/ux.md §5): contact sheet on the left,
 * Slate (product, mode, count, notes, SHOOT) on the right. Demo scope: product
 * only, no Soul. Runs through useRun("photoshoot") (slice G).
 */
import { useState } from "react";

import { Chip } from "../ui";
import { Frame } from "./frame";
import { DEMO_MODES, MODE_TEMPLATES, type DemoMode } from "../../lib/enhancer/modes";
import { useRun } from "../../lib/client/use-run";
import type { PhotoshootRequest, PipelineStep, VariationPick } from "../../lib/types";

const TERMINAL = new Set(["succeeded", "partial", "failed", "canceled"]);
const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 20 * 1024 * 1024;

function variationOf(step: PipelineStep | undefined): VariationPick | null {
  const data = step?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const v = data.variation;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as unknown as VariationPick) : null;
}

export function PhotoshootStudio() {
  const { run, error, polling, start, cancel, action, reset } = useRun("photoshoot");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<DemoMode>("lifestyle_scene");
  const [count, setCount] = useState<number>(MODE_TEMPLATES.lifestyle_scene.count.def);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [preview, setPreview] = useState<string | null>(null);

  const template = MODE_TEMPLATES[mode];
  const live = run !== null && !TERMINAL.has(run.status);

  function pickMode(next: DemoMode) {
    setMode(next);
    setCount(MODE_TEMPLATES[next].count.def);
  }

  function pickFile(next: File | null) {
    setLocalError(null);
    if (next && !ACCEPT.split(",").includes(next.type)) return setLocalError("Use a PNG, JPEG or WebP photo.");
    if (next && next.size > MAX_BYTES) return setLocalError("Photo is over 20 MB.");
    setFile(next);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return next ? URL.createObjectURL(next) : null;
    });
  }

  async function shoot() {
    if (!file) return setLocalError("Add a product photo first.");
    setLocalError(null);
    const request: PhotoshootRequest = { mode, prompt: notes.trim(), images: [{ upload: "product" }], count };
    const body = new FormData();
    body.append("request", JSON.stringify(request));
    body.append("product", file, file.name);
    setSubmitting(true);
    try {
      reset();
      await start(body);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const sheet = run ? buildSheet(run.steps, run.request.count) : null;
  const sheetMode = run && (run.request.mode as DemoMode) in MODE_TEMPLATES ? MODE_TEMPLATES[run.request.mode as DemoMode] : template;
  const aspect = run?.result?.aspectRatio ?? run?.request.aspectRatio ?? sheetMode.defaultAspect;
  const shotLabel = sheetMode.sharedStyle ? "S" : "Frame";
  const shootLabel = mode === "social_carousel" ? `Shoot ${count} slides` : `Shoot ${count}`;

  return (
    <div className="ps-root grid min-h-full gap-6 p-4 lg:grid-cols-[1fr_340px] lg:p-6">
      <section aria-label="Contact sheet" className="flex min-w-0 flex-col gap-4">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-3 font-mono text-xs uppercase tracking-widest text-muted">
          <span className="text-foreground">{run ? `Run ${run.id.slice(-4)}` : "Contact sheet"}</span>
          <span>{sheetMode.label}</span>
          <span>{aspect}</span>
          <span>{run ? `${run.request.count} frames` : "—"}</span>
          {sheetMode.sharedStyle ? <span title="one look across all slides">🔒 style lock</span> : null}
          {run ? <span className="ml-auto normal-case tracking-normal">{run.status}{polling ? " · live" : ""}</span> : null}
        </header>

        {run?.result?.notices.length ? <p className="text-xs text-muted">{run.result.notices.join(" · ")}</p> : null}
        {run?.error ? (
          <p role="alert" className="rounded-md border border-red-600/40 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            <span className="font-mono">{run.error.code}</span>: {run.error.message}
          </p>
        ) : null}
        {sheet?.cutout ? (
          <p className="font-mono text-[11px] text-muted">
            cutout · {sheet.cutout.status}
            {sheet.cutout.error ? ` · ${sheet.cutout.error.code}: ${sheet.cutout.error.message}` : ""}
          </p>
        ) : null}

        {sheet ? (
          <div className={`grid gap-4 ${gridCols(aspect)}`}>
            {sheet.shots.map((step, i) => {
              const item = run?.result?.items[i];
              return (
                <Frame
                  key={i}
                  index={i}
                  label={shotLabel}
                  aspect={aspect}
                  status={item?.status ?? step?.status ?? "pending"}
                  waitingNote={sheet.cutout && sheet.cutout.status !== "succeeded" ? "after cutout" : undefined}
                  output={item?.output ?? step?.outputs?.find((o) => o.type === "image") ?? null}
                  error={item?.error ?? step?.error ?? null}
                  variation={item?.variation ?? variationOf(step)}
                  onRetry={live ? undefined : () => void action(`items/${i}/retry`)}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-lg font-medium">Your first sheet goes here.</p>
            <p className="text-sm text-muted">Add a product photo, pick a mode, shoot.</p>
          </div>
        )}
      </section>

      <aside aria-label="Slate" className="flex flex-col gap-5 lg:sticky lg:top-4 lg:self-start">
        <Field label="Product">
          <label className="ps-drop flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm hover:border-[var(--ps-safelight)]">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={preview} alt="Product" className="size-14 rounded object-cover" />
            ) : (
              <span className="flex size-14 items-center justify-center rounded bg-[var(--ps-film)] text-xl text-[var(--ps-film-ink)]">+</span>
            )}
            <span className="min-w-0 flex-1 truncate">{file ? file.name : "Upload product photo"}</span>
            <input
              type="file"
              accept={ACCEPT}
              className="sr-only"
              data-testid="product-input"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </Field>

        <Field label="Mode">
          <div className="flex flex-wrap gap-2">
            {DEMO_MODES.map((m) => (
              <Chip key={m} selected={m === mode} title={m} onClick={() => pickMode(m)}>
                {MODE_TEMPLATES[m].label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label={`Count · ${template.count.min}–${template.count.max}`}>
          <div className="flex flex-wrap gap-2">
            {template.count.chips.map((n) => (
              <Chip key={n} selected={n === count} onClick={() => setCount(n)}>
                {n}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Notes">
          <textarea
            value={notes}
            maxLength={200}
            rows={2}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What should these shots say? e.g. on a sunlit kitchen counter"
            className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[var(--ps-safelight)]"
          />
        </Field>

        <p className="font-mono text-[11px] text-muted">
          {count + 1} jobs · cutout + {count} × {template.defaultAspect} frames
        </p>

        {localError || error ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {localError ?? error}
          </p>
        ) : null}

        {live ? (
          <button
            type="button"
            onClick={() => void cancel()}
            className="rounded-lg border-2 border-[var(--ps-safelight)] px-4 py-3 font-mono text-sm uppercase tracking-widest text-[var(--ps-safelight)]"
          >
            Cancel run
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void shoot()}
            disabled={submitting || !file}
            className="rounded-lg bg-[var(--ps-safelight)] px-4 py-3 font-mono text-sm uppercase tracking-widest text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Loading film…" : shootLabel}
          </button>
        )}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] uppercase tracking-widest text-muted">{label}</span>
      {children}
    </div>
  );
}

function buildSheet(steps: PipelineStep[], count: number) {
  const cutout = steps.find((s) => s.id === "cutout");
  const shots = Array.from({ length: count }, (_, i) => steps.find((s) => s.id === `shot-${i}`));
  return { cutout, shots };
}

function gridCols(aspect: string): string {
  const [w, h] = aspect.split(":").map(Number);
  if (w > h) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-2 xl:grid-cols-4";
}
