"use client";

/**
 * /identity: intake → server QA and selection → chosen crops → optional
 * preview sheet → export, plus the library and bundle import
 * (docs/spec/identity.md §2). Originals go to /api/souls only; the preview
 * job uses the saved crops (§8.3).
 */
import { useState } from "react";

import { IdentityIntakeForm, type IdentityIntake } from "../identity-intake";
import { Button, StatusPill } from "../ui";
import { downloadExport, errorText, soulsFetch, type IntakeResponse } from "../../lib/identity/client";
import { IDENTITY_CONSENT_FIELD, IDENTITY_CONSENT_TEXT } from "../../lib/identity/consent";
import { REASON_TEXT, WARNING_TEXT } from "../../lib/identity/qa-copy";
import { useRun } from "../../lib/client/use-run";
import type { Identity, IdentityResult, PipelineRun } from "../../lib/types";
import { RefThumb } from "./ref-thumb";
import { SoulLibrary } from "./soul-library";

function PreviewRun({ runId }: { runId: string }) {
  const { run, error } = useRun("identity", { runId });
  const step = run?.steps[0];
  const result = run?.result as IdentityResult | null | undefined;
  return (
    <div data-testid="identity-preview" className="space-y-2">
      <p className="flex items-center gap-2 text-sm">
        Preview sheet {run ? <StatusPill status={step?.status === "queued" ? "queued" : run.status} /> : "starting…"}
      </p>
      {step?.error?.message && <p className="text-sm text-red-700 dark:text-red-400">{step.error.message}</p>}
      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      {result?.preview && (
        // eslint-disable-next-line @next/next/no-img-element -- run output served by our own route
        <img src={result.preview.url} alt="Identity preview sheet" className="max-w-md rounded-xl border border-border" />
      )}
    </div>
  );
}

export function IdentityStudio() {
  const [result, setResult] = useState<IntakeResponse | null>(null);
  const [message, setMessage] = useState("");
  const [previewRun, setPreviewRun] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [importConsent, setImportConsent] = useState(false);

  async function create(intake: IdentityIntake) {
    setResult(null);
    setPreviewRun(null);
    setMessage("");
    const form = new FormData();
    form.set("name", intake.name);
    form.set("consent", "true");
    if (intake.description) form.set("styleCard", JSON.stringify({ description: intake.description }));
    for (const photo of intake.photos) form.append("photos", photo);
    const response = await soulsFetch("/api/souls", { method: "POST", body: form });
    if (response.status !== 201 && response.status !== 422) throw new Error(await errorText(response));
    const body = (await response.json()) as IntakeResponse;
    setResult(body);
    if (body.ok) {
      setMessage(`Identity ${body.identity.name} ready.`);
      setRefresh((n) => n + 1);
    }
  }

  async function preview(identity: Identity) {
    setBusy(true);
    try {
      const response = await soulsFetch(`/api/souls/${encodeURIComponent(identity.id)}/preview`, { method: "POST" });
      if (response.status !== 202) {
        setMessage(await errorText(response));
        return;
      }
      setPreviewRun(((await response.json()) as PipelineRun<"identity">).id);
    } finally {
      setBusy(false);
    }
  }

  async function importBundle(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file || !importConsent) return;
    const form = new FormData();
    form.set(IDENTITY_CONSENT_FIELD, "true");
    form.set("bundle", file);
    const response = await soulsFetch("/api/souls/import", { method: "POST", body: form });
    if (response.status !== 201) {
      setMessage(await errorText(response));
      return;
    }
    const identity = (await response.json()) as Identity;
    setMessage(`Identity ${identity.name} imported.`);
    setRefresh((n) => n + 1);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <IdentityIntakeForm onCreate={create} />
        {result && (
          <section aria-label="Photo check" className="space-y-3">
            {!result.ok && <p className="text-sm font-medium text-red-700 dark:text-red-400">{result.error} Add more photos and try again.</p>}
            <ul className="space-y-1 text-sm" data-testid="photo-report">
              {result.photos.map((p) => (
                <li key={p.index} data-reason={p.reason ?? "ok"} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">Photo {p.index + 1}</span>
                  {p.reason ? (
                    <StatusPill status="failed" label={REASON_TEXT[p.reason]} />
                  ) : (
                    <StatusPill status="succeeded" label={p.chosen ? "Chosen" : "Passed"} />
                  )}
                  {p.warnings.map((w) => (
                    <StatusPill key={w} status="needs_input" label={WARNING_TEXT[w]} />
                  ))}
                </li>
              ))}
            </ul>
            {result.advisories.map((a) => (
              <p key={a} className="text-sm text-muted">
                {a}
              </p>
            ))}
            {result.ok && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2" data-testid="identity-refs">
                  {result.identity.refs.map((_, n) => (
                    <RefThumb key={n} id={result.identity.id} n={n} alt={`Reference ${n + 1}`} className="h-32 w-auto min-w-24 rounded-lg border border-border" />
                  ))}
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button busy={busy} onClick={() => void preview(result.identity)}>
                    Render preview sheet
                  </Button>
                  <button
                    type="button"
                    onClick={() => void downloadExport(result.identity.id).then((problem) => problem && setMessage(problem))}
                    className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm"
                  >
                    Download .identity.zip
                  </button>
                </div>
                <p className="text-xs text-muted">Anyone holding the bundle can generate this face. Share it only with people you trust.</p>
              </div>
            )}
            {previewRun && <PreviewRun key={previewRun} runId={previewRun} />}
          </section>
        )}
        <p aria-live="polite" className="text-sm text-muted" data-testid="identity-message">
          {message}
        </p>
      </div>
      <aside className="space-y-4">
        <h2 className="text-lg font-semibold">Your identities</h2>
        <SoulLibrary variant="rail" refreshKey={refresh} />
        <section aria-label="Import an identity" className="space-y-2 text-sm">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={importConsent} onChange={(event) => setImportConsent(event.target.checked)} className="mt-0.5" />
            <span>{IDENTITY_CONSENT_TEXT}</span>
          </label>
          <label className="block space-y-1">
            <span>Import a .identity.zip</span>
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={!importConsent}
              onChange={(event) => void importBundle(event.currentTarget)}
              className="block w-full text-sm"
            />
          </label>
        </section>
      </aside>
    </div>
  );
}
