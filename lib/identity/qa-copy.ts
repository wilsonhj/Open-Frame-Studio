/** Plain-words QA copy shared by the identity UI (no runtime dependencies). */
import type { PhotoQaReason } from "../types";

export type QaWarning =
  | "low_resolution"
  | "wide_aspect"
  | "soft_focus"
  | "exposure"
  | "small_face"
  | "eyes_not_found"
  | "same_pose"
  | "background_faces";

export const REASON_TEXT: Record<PhotoQaReason, string> = {
  unsupported_type: "Not a JPEG, PNG or WebP photo",
  too_small: "Too small (under 512 px on the short side)",
  no_face: "No face found",
  multiple_faces: "More than one person",
  face_too_small: "Face too small: move closer",
  blurry: "Face is blurry",
  duplicate: "Same as another photo",
};

export const WARNING_TEXT: Record<QaWarning, string> = {
  low_resolution: "Low resolution",
  wide_aspect: "Very wide or tall",
  soft_focus: "Slightly soft",
  exposure: "Too dark or too bright",
  small_face: "Face is small",
  eyes_not_found: "Face partly covered (sunglasses or hat?)",
  same_pose: "Similar pose to another photo",
  background_faces: "Other people in the background",
};
