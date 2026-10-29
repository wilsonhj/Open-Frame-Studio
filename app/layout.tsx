import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Open Soul Studio",
  description:
    "Open-weights Soul ID, product photoshoots and marketplace cards on ComfyUI. Your Soul is a .safetensors file you own.",
};

const NAV = [
  { href: "/soul", label: "Soul ID" },
  { href: "/photoshoot", label: "Photoshoot" },
  { href: "/cards", label: "Marketplace Cards" },
  { href: "/motion", label: "Motion" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              Open Soul Studio
            </Link>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm text-muted hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
