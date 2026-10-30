"use client";
/**
 * Motion screen (docs/spec/ux.md §8): the clip on the left, the Slate on the
 * right (person, product, prompt, length, aspect, quality, likeness, ROLL CLIP).
 * Runs through useRun("motion") (slice G). One run = one h3_r2v job.
 *
 * Picture 1 is an uploaded person photo for now; identities come from the
 * Identity tool (slice C) through SoulLibrary once it lists them.
 */
import { useState } from "react";

import { Button, Chip, StatusPill } from "../ui";
import { SoulLibrary } from "../soul/soul-library";
import { SURFACES } from "../../lib/brand";
import { isTerminalRun, useRun } from "../../lib/client/use-run";
import {
  DEFAULT_ASPECT,
  H3_LICENCE_NOTICE,
  MOTION_CANCEL_HINT,
  MOTION_IDENTITIES_ENABLED,
  MOTION_LENGTHS,
  MOTION_TIME_HINT,
  pickClipVideo,
  stepsFor,
} from "../../lib/motion/options";
import { MAX_MOTION_PROMPT, PERSON_TOKEN, PRODUCT_TOKEN, framesFor } from "../../lib/motion/prompt";
import type { Identity, JobErrorInfo, MotionAspect, MotionRequest } from "../../lib/types";

const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 20 * 1024 * 1024;
const ASPECTS: MotionAspect[] = ["9:16", "16:9", "1:1"];

type Quality = "preview" | "final";
type Likeness = "match" | "max";

function errorText(error: JobErrorInfo | null | undefined): string | null {
  if (!error) return null;
  if (error.code === "timed_out") return "The clip took longer than its time budget. It was not resubmitted.";
  if (error.code === "canceled") return "This clip was canceled.";
  return error.message || "Something went wrong with this clip.";
}

export function MotionStudio({ runId }: { runId?: string }) {
  const { run, error, polling, start, cancel, reset } = useRun("motion", runId ? { runId } : undefined);
  const [person, setPerson] = useState<File | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [product, setProduct] = useState<File | null>(null);
  const [prompt, setPrompt] = useState(`${PERSON_TOKEN} holds ${PRODUCT_TOKEN} up to the light and smiles`);
  const [seconds, setSeconds] = useState<number>(MOTION_LENGTHS[0]);
  const [aspect, setAspect] = useState<MotionAspect>(DEFAULT_ASPECT);
  const [quality, setQuality] = useState<Quality>("final");
  const [likeness, setLikeness] = useState<Likeness>("match");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const live = run !== null && !isTerminalRun(run);
  const clip = run?.steps.find((s) => s.id === "clip");
  const video = run?.result?.video ?? pickClipVideo(clip?.outputs);
  const ranQuality = (clip?.data && typeof clip.data === "object" && !Array.isArray(clip.data) ? clip.data.quality : null) as Quality | null;

  function pick(setter: (f: File | null) => void, next: File | null) {
    setLocalError(null);
    if (next && !ACCEPT.split(",").includes(next.type)) return setLocalError("Use a PNG, JPEG or WebP photo.");
    if (next && next.size > MAX_BYTES) return setLocalError("Photo is over 20 MB.");
    setter(next);
  }

  function insert(token: string) {
    setPrompt((p) => (p.length + token.length + 1 <= MAX_MOTION_PROMPT ? `${p.trimEnd()} ${token}`.trimStart() : p));
  }

  async function roll() {
    if (!person && !identity) return setLocalError("Clips need a person and a product. Use an identity or upload a photo.");
    if (!product) return setLocalError("Add a product photo.");
    if (!prompt.trim()) return setLocalError("Describe the clip in a short line.");
    setLocalError(null);
    const request: MotionRequest = {
      productImage: { upload: "product" },
      prompt: prompt.trim(),
      duration: seconds,
      aspectRatio: aspect,
      quality,
      refFidelity: likeness,
    };
    if (identity) request.identityId = identity.id;
    else request.personImage = { upload: "person" };
    const body = new FormData();
    body.append("request", JSON.stringify(request));
    body.append("product", product, product.name);
    if (!identity && person) body.append("person", person, person.name);
    setSubmitting(true);
    try {
      reset();
      await start(body);
    } finally {
      setSubmitting(false);
    }
  }

  /** Same seed and inputs, 20 steps: a new run that reuses the uploaded assets. */
  async function rollFinal() {
    if (!run?.result) return;
    setSubmitting(true);
    try {
      const request = { ...run.request, quality: "final", seed: run.result.seed };
      reset();
      await start(request);
    } finally {
      setSubmitting(false);
    }
  }

  const runSeconds = run ? (run.request.duration ?? MOTION_LENGTHS[0]) : seconds;
  const runAspect = run?.request.aspectRatio ?? aspect;

  return (
    <div className="grid min-h-full gap-6 p-4 lg:grid-cols-[1fr_340px] lg:p-6">
      <section aria-label="Clip" className="flex min-w-0 flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{SURFACES.motion.label}</h1>
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-3 font-mono text-xs uppercase tracking-widest text-muted">
          <span className="text-foreground">{run ? `Run ${run.id.slice(-4)}` : "Clip"}</span>
          <span>{runAspect}</span>
          <span>{runSeconds} s</span>
          <span>{ranQuality ?? quality}</span>
          {run ? (
            <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">
              <StatusPill status={run.status} />
              {polling ? "live" : null}
            </span>
          ) : null}
        </header>

        {run?.error || clip?.error ? (
          <p role="alert" className="rounded-md border border-red-600/40 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            {errorText(clip?.error ?? run?.error)}
          </p>
        ) : null}

        {video ? (
          <figure className="flex flex-col gap-2">
            <video
              data-testid="motion-video"
              src={video.url}
              controls
              loop
              muted
              playsInline
              className="max-h-[70vh] w-full rounded-xl bg-black object-contain"
            />
            <figcaption className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted">
              <span>seed {run?.result?.seed ?? String(clip?.inputs.seed ?? "")}</span>
              <span>{run?.result?.frames ?? framesFor(runSeconds)} fr</span>
              <a href={video.url} download className="underline">
                Download MP4
              </a>
              {ranQuality === "preview" && run?.result ? (
                <Button variant="secondary" onClick={() => void rollFinal()} busy={submitting} title="same seed, 20 steps · 1 job">
                  Roll final
                </Button>
              ) : null}
            </figcaption>
          </figure>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
            {live ? (
              <>
                <p className="text-lg font-medium">{clip?.status === "queued" ? "Waiting for a GPU…" : "Rendering the clip…"}</p>
                <progress
                  aria-label="Clip progress"
                  className="w-48"
                  {...(run && run.progress > 0 && run.progress < 1 ? { value: run.progress } : {})}
                />
              </>
            ) : (
              <>
                <p className="text-lg font-medium">Your clip plays here.</p>
                <p className="text-sm text-muted">Pick a person and a product, describe the moment, roll.</p>
              </>
            )}
          </div>
        )}

        <p data-testid="h3-licence" className="text-xs text-muted">
          {H3_LICENCE_NOTICE}
        </p>
      </section>

      <aside aria-label="Slate" className="flex flex-col gap-5 lg:sticky lg:top-4 lg:self-start">
        <Field label="Picture 1 · person">
          {MOTION_IDENTITIES_ENABLED ? (
            <SoulLibrary
              variant="picker"
              selectedId={identity?.id ?? null}
              onSelect={(s) => {
                setIdentity(s);
                if (s) setPerson(null);
              }}
            />
          ) : null}
          <FilePick testId="person-input" label={person ? person.name : "Upload person photo"} onPick={(f) => {
            pick(setPerson, f);
            if (f) setIdentity(null);
          }} />
        </Field>

        <Field label="Picture 2 · product">
          <FilePick testId="product-input" label={product ? product.name : "Upload product photo"} onPick={(f) => pick(setProduct, f)} />
        </Field>

        <Field label="Prompt">
          <textarea
            aria-label="Prompt"
            value={prompt}
            maxLength={MAX_MOTION_PROMPT}
            rows={3}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
          />
          <div className="flex gap-2">
            <Chip onClick={() => insert(PERSON_TOKEN)}>+ Person</Chip>
            <Chip onClick={() => insert(PRODUCT_TOKEN)}>+ Product</Chip>
          </div>
        </Field>

        <Field label="Length">
          <div className="flex flex-wrap gap-2">
            {MOTION_LENGTHS.map((s) => (
              <Chip key={s} selected={s === seconds} onClick={() => setSeconds(s)}>
                {s} s
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Aspect">
          <div className="flex flex-wrap gap-2">
            {ASPECTS.map((a) => (
              <Chip key={a} selected={a === aspect} onClick={() => setAspect(a)}>
                {a}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Quality">
          <div className="flex flex-wrap gap-2">
            <Chip selected={quality === "preview"} title="Faster, likeness may drift" onClick={() => setQuality("preview")}>
              Preview
            </Chip>
            <Chip selected={quality === "final"} onClick={() => setQuality("final")}>
              Final
            </Chip>
          </div>
        </Field>

        <Field label="Likeness">
          <div className="flex flex-wrap gap-2">
            <Chip selected={likeness === "match"} onClick={() => setLikeness("match")}>
              Match
            </Chip>
            <Chip selected={likeness === "max"} title="Best identity, slower" onClick={() => setLikeness("max")}>
              Max
            </Chip>
          </div>
        </Field>

        <p data-testid="motion-estimate" className="font-mono text-[11px] text-muted">
          1 job · {stepsFor(quality)} steps · {framesFor(seconds)} frames
        </p>
        <p data-testid="motion-time" className="-mt-4 font-mono text-[11px] text-muted">
          {MOTION_TIME_HINT}. {MOTION_CANCEL_HINT}
        </p>

        {localError || error ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {localError ?? error}
          </p>
        ) : null}

        {live ? (
          <Button variant="secondary" onClick={() => void cancel()}>
            Cancel clip
          </Button>
        ) : (
          <Button onClick={() => void roll()} busy={submitting} disabled={submitting || !product || (!person && !identity)}>
            Roll clip
          </Button>
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

function FilePick({ testId, label, onPick }: { testId: string; label: string; onPick: (file: File | null) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm">
      <span className="flex size-10 items-center justify-center rounded bg-card text-lg">+</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <input type="file" accept={ACCEPT} className="sr-only" data-testid={testId} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </label>
  );
}
