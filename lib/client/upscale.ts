/**
 * Client side of a one-off SeedVR2 upscale of a finished frame: fetch the
 * frame's bytes, submit the `upscale` binding once through the single-shot
 * route, poll it until terminal.
 *   POST /api/jobs        multipart: workflow=upscale, image, scale, access_code
 *   GET  /api/jobs/{id}   -> Job (re-polled until `terminal`)
 * POST /api/jobs reads the access code from the form, not a header.
 */
import { withAccessCode } from "./use-run";
import type { Job, OutputRef, SubmittedJob } from "../types";

export const UPSCALE_FACTOR = 2;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** The multipart body for an upscale submit (pure; the code is added only when known). */
export function upscaleForm(image: File, accessCode: string | null, factor = UPSCALE_FACTOR): FormData {
  const form = new FormData();
  form.set("workflow", "upscale");
  form.set("image", image, image.name);
  form.set("scale", String(factor));
  if (accessCode) form.set("access_code", accessCode);
  return form;
}

/** A 4xx other than timeout / rate limit won't change on a re-poll. */
export function isPermanentPollFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function messageOf(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" && error ? error : fallback;
}

/** Re-host a frame output as a File the upload route accepts. */
async function outputFile(output: OutputRef): Promise<File> {
  const response = await fetch(output.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read the frame (HTTP ${response.status}).`);
  const blob = await response.blob();
  const type = IMAGE_TYPES.includes(blob.type) ? blob.type : output.contentType;
  if (!IMAGE_TYPES.includes(type)) throw new Error("Only PNG, JPEG or WebP frames can be upscaled.");
  return new File([blob], output.name || "frame.png", { type });
}

/** Submit exactly once (a resend would be a second billed job). Throws with the server's message. */
export async function submitUpscale(output: OutputRef): Promise<SubmittedJob> {
  const image = await outputFile(output);
  const response = await withAccessCode((code) => fetch("/api/jobs", { method: "POST", body: upscaleForm(image, code) }));
  const body = (await response.json().catch(() => null)) as (SubmittedJob & { error?: unknown }) | null;
  if (!response.ok || !body) throw new Error(messageOf(body, `Upscale submit failed (HTTP ${response.status}).`));
  return body;
}

/** One poll. `permanent` = stop polling, the handle will never answer. */
export async function pollUpscale(id: string): Promise<{ job: Job } | { error: string; permanent: boolean }> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as (Job & { error?: unknown }) | null;
  if (!response.ok || !body) {
    return { error: messageOf(body, "Could not check the upscale."), permanent: isPermanentPollFailure(response.status) };
  }
  return { job: body };
}
