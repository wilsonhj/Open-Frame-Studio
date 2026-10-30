/**
 * Client-safe Product Shoot constants and wording, shared by the pipeline
 * (server) and the studio (client). No server imports here.
 */
import type { JobErrorInfo } from "../contracts/job.ts";

/** Longest notes (`prompt`) a request may carry; the studio's field uses the same cap. */
export const MAX_NOTES = 500;

const REASONS: Record<string, string> = {
  cutout_failed: "The product cutout failed, so this frame couldn't start.",
  content_moderated: "The image was blocked by content moderation.",
  poll_failed: "We lost contact with Comfy while this frame ran.",
  poll_timeout: "This frame took longer than its time budget.",
  timed_out: "This frame took longer than its time budget.",
  output_download_failed: "Comfy finished this frame, but downloading the image failed.",
  submit_unconfirmed: "We couldn't confirm the job started; it may have been billed.",
  input_missing: "An input this frame needs wasn't available.",
  node_execution_error: "Comfy hit an error while running this frame's workflow.",
  canceled: "This frame was canceled.",
};

/** A short human reason for a step error; the raw code and message stay available for a tooltip. */
export function humanReason(error: JobErrorInfo | null | undefined): string | null {
  if (!error) return null;
  return REASONS[error.code] ?? "Something went wrong with this frame.";
}

/** `code: message`, for a title attribute. */
export function errorDetail(error: JobErrorInfo | null | undefined): string | undefined {
  return error ? `${error.code}: ${error.message}` : undefined;
}
