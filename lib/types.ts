/**
 * Shared contract types for Open Soul Studio: a re-export barrel.
 *
 * The contracts live in lib/contracts/*.ts by domain and freeze at the end of
 * Wave 1 (see docs/PLAN.md). Import from here or from the domain file; both
 * stay free of runtime dependencies so server and client code (and
 * `node --test`) can import them.
 */
export * from "./contracts/job.ts";
export * from "./contracts/bindings.ts";
export * from "./contracts/pipeline.ts";
export * from "./contracts/soul.ts";
export * from "./contracts/photoshoot.ts";
export * from "./contracts/marketplace.ts";
export * from "./contracts/motion.ts";
