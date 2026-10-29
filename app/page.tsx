import Link from "next/link";

const TOOLS = [
  {
    href: "/soul",
    title: "Soul ID",
    body: "Turn 5–20 photos into an identity: instant (reference-based) or trained into a LoRA you download and own.",
  },
  {
    href: "/photoshoot",
    title: "Product Photoshoot",
    body: "Ten shoot modes from clean product shots to virtual try-ons, with varied lighting, angles and palettes.",
  },
  {
    href: "/cards",
    title: "Marketplace Cards",
    body: "A compliant white-background main image plus secondary and A+ images anchored on it: up to 13 assets.",
  },
  {
    href: "/motion",
    title: "Motion",
    body: "Put your Soul and your product in one short reference-to-video clip.",
  },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">Open Soul Studio</h1>
        <p className="max-w-2xl text-lg text-muted">
          Open-weights identity and product imagery on ComfyUI. Train a Soul once, reuse it everywhere, and keep
          the <code>.safetensors</code> file.
        </p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="rounded-xl border border-border bg-card p-5 transition hover:border-accent"
          >
            <h2 className="text-lg font-medium">{tool.title}</h2>
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
