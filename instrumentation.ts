/**
 * Runs once per server instance (Next.js instrumentation hook).
 * Starts the server-owned deadline sweep for /api/jobs submissions, so an
 * overdue job is canceled even if no browser is polling it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startJobReconciler } = await import("./lib/job-deadlines.ts");
  startJobReconciler();
}
