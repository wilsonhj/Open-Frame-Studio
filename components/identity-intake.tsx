"use client";

/**
 * Identity intake, steps 1-3 of docs/spec/identity.md §2: name, likeness
 * consent, photos. The photo picker stays locked until consent is given, and
 * withdrawing consent drops any photos already picked, so nothing about a
 * face is read or uploaded without it. QA, selection and the identity
 * pipeline (steps 4-9) plug in through `onCreate` (Wave 2).
 */
import { useId, useState } from "react";

import { IDENTITY_CONSENT_TEXT } from "../lib/identity/consent";
import type { IdentityRequest } from "../lib/types";

export const MIN_PHOTOS = 5;
export const MAX_PHOTOS = 20;
const PHOTO_TYPES = "image/png,image/jpeg,image/webp";

export type IdentityIntake = Pick<IdentityRequest, "name" | "consent"> & {
  photos: File[];
  /** Optional look description for the style card (≤ 400 chars). */
  description?: string;
};

export function IdentityIntakeForm({ onCreate }: { onCreate?: (intake: IdentityIntake) => Promise<void> }) {
  const ids = { name: useId(), consent: useId(), photos: useId(), hint: useId(), look: useId() };
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function changeConsent(next: boolean) {
    setConsent(next);
    if (!next) {
      setPhotos([]);
      setMessage(photos.length ? "Photos removed: they can only be added with consent." : "");
    }
  }

  function pickPhotos(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length > MAX_PHOTOS) setMessage(`Only the first ${MAX_PHOTOS} photos were kept.`);
    else setMessage("");
    setPhotos(files.slice(0, MAX_PHOTOS));
  }

  const ready = consent && name.trim() !== "" && photos.length >= MIN_PHOTOS;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !onCreate || busy) return;
    setBusy(true);
    try {
      await onCreate({ name: name.trim(), consent: true, photos, description: description.trim() || undefined });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not create the identity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5 rounded-xl border border-border bg-card p-5">
      <label htmlFor={ids.name} className="block space-y-1 text-sm">
        <span>Name</span>
        <input
          id={ids.name}
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          className="block w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
        />
      </label>

      <label htmlFor={ids.consent} className="flex items-start gap-3 text-sm">
        <input
          id={ids.consent}
          type="checkbox"
          required
          checked={consent}
          onChange={(event) => changeConsent(event.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>{IDENTITY_CONSENT_TEXT}</span>
      </label>

      <div className="space-y-1 text-sm">
        <label htmlFor={ids.photos} className={consent ? "" : "text-muted"}>
          Photos ({MIN_PHOTOS}–{MAX_PHOTOS}, 8–12 is ideal)
        </label>
        <input
          id={ids.photos}
          // Re-mounted when consent changes so a withdrawn selection is really gone.
          key={consent ? "on" : "off"}
          type="file"
          multiple
          accept={PHOTO_TYPES}
          disabled={!consent}
          aria-describedby={ids.hint}
          onChange={(event) => pickPhotos(event.target.files)}
          className="block w-full text-sm disabled:opacity-50"
        />
        <p id={ids.hint} className="text-xs text-muted">
          {consent
            ? `${photos.length} selected. One sharp face per photo, varied angles and lighting, no sunglasses.`
            : "Tick the consent box to add photos."}
        </p>
      </div>

      <label htmlFor={ids.look} className="block space-y-1 text-sm">
        <span>Look (optional)</span>
        <input
          id={ids.look}
          value={description}
          maxLength={400}
          placeholder="e.g. shoulder-length curly auburn hair, hazel eyes, gold hoops"
          onChange={(event) => setDescription(event.target.value)}
          className="block w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
        />
        <span className="text-xs text-muted">Added to every prompt that uses this identity. Describe only what you choose to.</span>
      </label>

      <button
        type="submit"
        disabled={!ready || !onCreate || busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create identity"}
      </button>
      {!onCreate && <p className="text-xs text-muted">Creating identities arrives with the identity pipeline.</p>}
      <p role="status" aria-live="polite" className="text-sm text-muted">
        {message}
      </p>
    </form>
  );
}
