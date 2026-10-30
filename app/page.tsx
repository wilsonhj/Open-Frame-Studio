import Link from "next/link";

import { APP_NAME, SURFACES } from "../lib/brand";

const TOOLS = [
  {
    ...SURFACES.identity,
    body: "Turn 5–20 photos into a reusable identity: the best reference crops plus a style card, saved as a portable identity.json you keep.",
  },
  {
    ...SURFACES.photoshoot,
    body: "Ten shoot modes, from clean packshots to on-model shots and ad sets, with varied settings, lighting, angles and palettes.",
  },
  {
    ...SURFACES.listing,
    body: "A compliant white-background hero image plus gallery and story panels anchored on it.",
  },
  {
    ...SURFACES.motion,
    body: "Put a saved identity and your product in one short reference-to-video clip.",
  },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="max-w-2xl text-lg text-muted">
          Open-weights identity and product imagery on ComfyUI. Build an identity once, reuse it everywhere, and
          inspect every workflow as a plain ComfyUI graph.
        </p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="rounded-xl border border-border bg-card p-5 transition hover:border-accent"
          >
            <h2 className="text-lg font-medium">{tool.label}</h2>
            <p className="mt-2 text-sm text-muted">{tool.body}</p>
          </Link>
        ))}
      </section>
      <p className="text-sm text-muted">
        Plumbing check: <Link href="/smoke" className="underline">run the smoke workflow</Link>.
      </p>
    </div>
  );
}
