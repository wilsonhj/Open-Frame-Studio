/**
 * Runs once per server instance (Next.js instrumentation hook).
 * Starts the server-owned deadline sweep for /api/jobs submissions, so an
 * overdue job is canceled even if no browser is polling it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { trustedProxyHops } = await import("./lib/access.ts");
  if (process.env.NODE_ENV === "production" && trustedProxyHops() === null) {
    // Same parser as clientIp: without a valid value no per-IP limit applies.
    const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
    console.warn(
      `[access] TRUSTED_PROXY_HOPS is ${raw ? `invalid (${JSON.stringify(raw)}; use a positive integer)` : "unset"}: ` +
        "per-IP limits are off. Wrong access codes are not limited per client (only the code's length stops " +
        "guessing), and one client can use the whole submit quota.",
    );
  }
  const { startJobReconciler } = await import("./lib/job-deadlines.ts");
  startJobReconciler();
}
