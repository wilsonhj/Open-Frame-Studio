import Link from "next/link";

import manifest from "../models/manifest.json";

type ManifestModel = {
  filename: string;
  role: string;
  upstream: { repo: string; url: string };
  licence: string;
  licenceUrl: string;
  licenceNote?: string;
  cloudAvailable: boolean;
};

const TOOLS = [
  {
    href: "/photoshoot",
    n: "01",
    title: "Product Photoshoot",
    body: "Upload one product photo, pick a mode, get a contact sheet of varied shots: lighting, angle and palette change per frame.",
    live: true,
  },
  {
    href: "/cards",
    n: "02",
    title: "Marketplace Cards",
    body: "A compliant pure-white main image, then secondary and A+ tiles anchored on it: up to 13 listing assets.",
    live: true,
  },
  {
    href: "/soul",
    n: "03",
    title: "Soul ID",
    body: "3–6 reference crops plus a style card, saved as a portable soul.json you own. No training.",
    live: false,
  },
  {
    href: "/motion",
    n: "04",
    title: "Motion",
    body: "Your Soul and your product in one short reference-to-video clip.",
    live: false,
  },
];

/** One row per upstream model (several files share one repo and licence). */
function openWeights() {
  const rows = new Map<string, { repo: string; url: string; roles: string[]; licence: string; licenceUrl: string; note?: string; conditional: boolean }>();
  for (const model of (manifest as { models: ManifestModel[] }).models) {
    const key = model.upstream.repo;
    const row = rows.get(key);
    if (row) {
      row.roles.push(model.role);
      continue;
    }
    rows.set(key, {
      repo: model.upstream.repo,
      url: model.upstream.url,
      roles: [model.role],
      licence: model.licence,
      licenceUrl: model.licenceUrl,
      note: model.licenceNote,
      conditional: /conditional|community/i.test(model.licence),
    });
  }
  return [...rows.values()];
}

export default function Home() {
  const weights = openWeights();
  return (
    <div className="space-y-12">
      <section className="space-y-4 pt-2">
        <p className="label">Open Soul Studio</p>
        <h1 className="max-w-3xl text-[40px] leading-[44px]">
          Open-weights product studio on ComfyUI
        </h1>
        <p className="max-w-2xl text-ink-2">
          A clean-room rebuild of Higgsfield&apos;s Photoshoot and Marketplace Cards. Every frame comes from open
          weights you can inspect, self-host or run on Comfy Cloud.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href="/photoshoot"
            className="rounded-md bg-safelight px-4 py-2 text-sm font-medium text-safelight-ink transition hover:brightness-110"
          >
            Start a photoshoot
          </Link>
          <Link href="/cards" className="rounded-md border border-ink/30 px-4 py-2 text-sm font-medium hover:border-ink">
            Make listing cards
          </Link>
        </div>
      </section>

      <section aria-labelledby="tools" className="space-y-3">
        <h2 id="tools" className="label">
          Tools
        </h2>
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group flex flex-col gap-2 bg-surface p-5 transition-colors hover:bg-bg"
            >
              <div className="flex items-center justify-between">
                <span className="caption">{tool.n}</span>
                {tool.live ? (
                  <span className="caption flex items-center gap-1.5 text-ink">
                    <span aria-hidden className="inline-block size-1.5 rounded-full bg-safelight" /> ready
                  </span>
                ) : (
                  <span className="caption rounded border border-line px-1">soon</span>
                )}
              </div>
              <h3 className="font-display text-xl leading-7 group-hover:underline group-hover:decoration-safelight group-hover:underline-offset-4">
                {tool.title}
              </h3>
              <p className="text-sm text-ink-2">{tool.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="weights" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="weights" className="label">
            Open weights
          </h2>
          <p className="caption">models/manifest.json · retrieved {(manifest as { retrieved: string }).retrieved}</p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="label px-4 py-2 font-medium">Model</th>
                <th className="label px-4 py-2 font-medium">Used for</th>
                <th className="label px-4 py-2 font-medium">Licence</th>
              </tr>
            </thead>
            <tbody>
              {weights.map((row) => (
                <tr key={row.repo} className="border-b border-line last:border-0 align-top">
                  <td className="px-4 py-3">
                    <a href={row.url} className="font-mono text-[13px] hover:underline" rel="noreferrer" target="_blank">
                      {row.repo}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-ink-2">
                    {row.roles.length > 2 ? `${row.roles[0]} (+${row.roles.length - 1} files)` : row.roles.join("; ")}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={row.licenceUrl}
                      rel="noreferrer"
                      target="_blank"
                      title={row.note}
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${
                        row.conditional ? "border-brass/50 text-brass" : "border-ok/40 text-ok"
                      }`}
                    >
                      {row.licence}
                    </a>
                    {row.note ? <p className="caption mt-1 max-w-xs">{row.note}</p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
