/**
 * Runs once per server instance (Next.js instrumentation hook).
 * Starts the server-owned deadline sweep for /api/jobs submissions, so an
 * overdue job is canceled even if no browser is polling it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "production" && !Number(process.env.TRUSTED_PROXY_HOPS)) {
    // Without it no per-IP limit applies: everyone shares the global submit quota.
    console.warn(
      "[access] TRUSTED_PROXY_HOPS is unset: per-IP limits are off. Wrong access codes are not limited " +
        "per client (only the code's length stops guessing), and one client can use the whole submit quota.",
    );
  }
  const { startJobReconciler } = await import("./lib/job-deadlines.ts");
  startJobReconciler();
}
