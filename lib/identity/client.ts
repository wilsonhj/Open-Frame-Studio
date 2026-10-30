/**
 * Browser helpers for the /api/souls routes (slice C). Sends the studio
 * access code the same way useRun does (sessionStorage `oss.accessCode`,
 * header `X-Access-Code`), asking once on a 401 `access_code_required`.
 * Plain module: import it from "use client" components only.
 */
import type { Identity, PhotoQaReason } from "../types";
import type { QaWarning } from "./qa-copy";

const ACCESS_CODE_KEY = "oss.accessCode";

function storedCode(): string | null {
  try {
    return sessionStorage.getItem(ACCESS_CODE_KEY);
  } catch {
    return null;
  }
}

export async function soulsFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = (code: string | null) => {
    const headers = new Headers(init.headers);
    if (code) headers.set("X-Access-Code", code);
    return fetch(url, { ...init, headers });
  };
  const response = await send(storedCode());
  if (response.status !== 401) return response;
  const body = (await response.clone().json().catch(() => null)) as { code?: string } | null;
  if (body?.code !== "access_code_required" || typeof window === "undefined") return response;
  const code = window.prompt("Studio access code")?.trim();
  if (!code) return response;
  try {
    sessionStorage.setItem(ACCESS_CODE_KEY, code);
  } catch {
    // storage blocked: use the code for this request only
  }
  return send(code);
}

export async function errorText(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return typeof body?.error === "string" ? body.error : `Request failed (HTTP ${response.status}).`;
}

export type PhotoReport = { index: number; reason: PhotoQaReason | null; warnings: QaWarning[]; score: number; chosen: boolean };
export type IntakeResponse =
  | { ok: true; identity: Identity; photos: PhotoReport[]; advisories: string[] }
  | { ok: false; error: string; photos: PhotoReport[]; advisories: string[] };

export const refUrl = (id: string, n: number) => `/api/souls/${encodeURIComponent(id)}/refs/${n}`;
export const exportUrl = (id: string) => `/api/souls/${encodeURIComponent(id)}/export`;

/**
 * Download the `.identity.zip` through soulsFetch (the route needs the access
 * code header, which a plain link can't send). Returns an error text or null.
 */
export async function downloadExport(id: string): Promise<string | null> {
  const response = await soulsFetch(exportUrl(id), { cache: "no-store" });
  if (!response.ok) return errorText(response);
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "identity.identity.zip";
  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return null;
}
