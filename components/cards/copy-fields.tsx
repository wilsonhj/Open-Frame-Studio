"use client";

/**
 * The copy the gallery and story panels draw (docs/spec/listing.md §7). Every
 * field is optional: a card whose copy is missing ends "needs input" and says
 * which field to add (G7). Lists are one entry per line.
 */
import type { ReactNode } from "react";

import type { CardsRequest } from "../../lib/types";

export type CopyDraft = {
  productName: string;
  brandName: string;
  tagline: string;
  category: string;
  bullets: string;
  specs: string;
  ingredients: string;
  boxContents: string;
  painPoints: string;
  efficacyClaims: string;
  efficacySource: string;
  howToUse: string;
  endorsementType: "review" | "expert" | "certification";
  endorsementText: string;
  endorsementBy: string;
  rightsConfirmed: boolean;
  brandColor: string;
  accentColor: string;
  useColors: boolean;
};

export const EMPTY_COPY: CopyDraft = {
  productName: "",
  brandName: "",
  tagline: "",
  category: "",
  bullets: "",
  specs: "",
  ingredients: "",
  boxContents: "",
  painPoints: "",
  efficacyClaims: "",
  efficacySource: "",
  howToUse: "",
  endorsementType: "review",
  endorsementText: "",
  endorsementBy: "",
  rightsConfirmed: false,
  brandColor: "#2b5d8a",
  accentColor: "#e8b04b",
  useColors: false,
};

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Split `a <sep> b` into two trimmed halves (b may be empty). */
function pair(line: string, sep: RegExp): [string, string] {
  const m = sep.exec(line);
  if (!m) return [line.trim(), ""];
  return [line.slice(0, m.index).trim(), line.slice(m.index + m[0].length).trim()];
}

/** The request fields for this draft; blank fields are left out (never invented). */
export function copyToRequest(d: CopyDraft): Partial<CardsRequest> {
  const out: Partial<CardsRequest> = {};
  const set = <K extends keyof CardsRequest>(k: K, v: CardsRequest[K] | undefined) => {
    if (v === undefined || (Array.isArray(v) && v.length === 0) || v === "") return;
    out[k] = v;
  };
  set("productName", d.productName.trim());
  set("brandName", d.brandName.trim());
  set("tagline", d.tagline.trim());
  set("category", d.category.trim());
  set("bullets", lines(d.bullets));
  set(
    "specs",
    lines(d.specs).map((l) => {
      const [label, value] = pair(l, /:\s*/);
      return { label, value };
    }),
  );
  set(
    "ingredients",
    lines(d.ingredients).map((l) => {
      const [name, rest] = pair(l, /\s+[-–—]\s+/);
      return rest ? { name, benefit: rest } : { name };
    }),
  );
  set(
    "boxContents",
    lines(d.boxContents).map((l) => {
      const m = /^(\d+)\s*[x×]\s*(.+)$/i.exec(l);
      return m ? { qty: Number(m[1]), name: m[2].trim() } : { qty: 1, name: l };
    }),
  );
  set(
    "painPoints",
    lines(d.painPoints).map((l) => {
      const [problem, solution] = pair(l, /\s*(->|→)\s*/);
      return { problem, solution };
    }),
  );
  set(
    "efficacyClaims",
    lines(d.efficacyClaims).map((l) => {
      const [value, label] = pair(l, /\s+/);
      return { value, label };
    }),
  );
  set("efficacySource", d.efficacySource.trim());
  set("howToUse", lines(d.howToUse));
  if (d.endorsementText.trim() || d.endorsementBy.trim()) {
    out.endorsement = {
      type: d.endorsementType,
      text: d.endorsementText.trim(),
      by: d.endorsementBy.trim(),
      rightsConfirmed: d.rightsConfirmed,
    };
  }
  if (d.useColors) out.brandColors = [d.brandColor, d.accentColor];
  return out;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const input = "rounded-lg border border-border bg-background px-3 py-2 text-sm";

export function CopyFields({ value, onChange }: { value: CopyDraft; onChange: (next: CopyDraft) => void }) {
  const up = <K extends keyof CopyDraft>(k: K) => (v: CopyDraft[K]) => onChange({ ...value, [k]: v });
  const text = (k: keyof CopyDraft, label: string, hint?: string, max?: number) => (
    <Field label={label} hint={hint}>
      <input className={input} value={value[k] as string} maxLength={max} onChange={(e) => up(k)(e.target.value as never)} />
    </Field>
  );
  const area = (k: keyof CopyDraft, label: string, hint: string) => (
    <Field label={label} hint={hint}>
      <textarea className={input} rows={3} value={value[k] as string} onChange={(e) => up(k)(e.target.value as never)} />
    </Field>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="listing-copy">
      {text("productName", "Product name", "Headline on callouts and the story banner", 80)}
      {text("brandName", "Brand", undefined, 40)}
      {text("tagline", "Tagline", "Optional; left out when empty", 60)}
      {text("category", "Category", "For scene prompts, e.g. beauty, kitchen", 40)}
      {area("bullets", "Benefits", "3–5 lines, each at most 90 characters")}
      {area("specs", "Specs", "One per line: Volume: 30 ml")}
      {area("ingredients", "Ingredients or materials", "One per line: Name – benefit")}
      {area("boxContents", "In the box", "One per line: 2 × Refill pad")}
      {area("painPoints", "Problems it solves", "2–3 lines: Dry skin → Lasting hydration")}
      {area("efficacyClaims", "Results", "2–4 lines: 92% felt more hydrated")}
      {text("efficacySource", "Source of the results", "Required with results; shown as a footnote", 120)}
      {area("howToUse", "How to use", "2–4 steps, each at most 60 characters")}
      <Field label="Endorsement" hint="A quote you have the right to use">
        <select className={input} value={value.endorsementType} onChange={(e) => up("endorsementType")(e.target.value as CopyDraft["endorsementType"])}>
          <option value="review">Customer review</option>
          <option value="expert">Expert</option>
          <option value="certification">Certification</option>
        </select>
        <textarea className={input} rows={2} maxLength={160} value={value.endorsementText} onChange={(e) => up("endorsementText")(e.target.value)} />
        <input className={input} placeholder="Who said it" maxLength={50} value={value.endorsementBy} onChange={(e) => up("endorsementBy")(e.target.value)} />
        <span className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={value.rightsConfirmed} onChange={(e) => up("rightsConfirmed")(e.target.checked)} />I have the right to use this
        </span>
      </Field>
      <Field label="Brand colours" hint="Otherwise taken from the product">
        <span className="flex items-center gap-3">
          <input type="checkbox" aria-label="Use brand colours" checked={value.useColors} onChange={(e) => up("useColors")(e.target.checked)} />
          <input type="color" aria-label="Brand colour" value={value.brandColor} onChange={(e) => up("brandColor")(e.target.value)} />
          <input type="color" aria-label="Accent colour" value={value.accentColor} onChange={(e) => up("accentColor")(e.target.value)} />
        </span>
      </Field>
    </div>
  );
}
