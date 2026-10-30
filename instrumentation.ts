/**
 * Boot hook (docs/spec/api.md §2.0): on the Node.js server, reconcile every
 * non-terminal run in the store so restarts pick up where they left off.
 * Skipped when Comfy is not configured, so a misconfigured boot does not fail
 * resumable runs; they still resume lazily on the next GET.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.COMFY_API_KEY?.trim() && !process.env.COMFY_BASE_URL?.trim()) {
    console.warn("[runs] Comfy is not configured; skipping boot resume.");
    return;
  }
  try {
    const { resumeRuns } = await import("./lib/pipeline/runner.ts");
    await resumeRuns();
  } catch (error) {
    console.error("[runs] boot resume failed:", error instanceof Error ? error.message : error);
  }
}
