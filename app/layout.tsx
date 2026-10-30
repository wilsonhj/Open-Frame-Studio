import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { APP_NAME, APP_TAGLINE, SURFACES } from "../lib/brand";

import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

const NAV = Object.values(SURFACES);

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              {APP_NAME}
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
