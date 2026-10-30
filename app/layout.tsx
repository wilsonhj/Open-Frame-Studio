import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Rail } from "../components/shell/rail";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Soul Studio",
  description:
    "Open-weights product studio on ComfyUI: a clean-room rebuild of Higgsfield's Photoshoot and Marketplace Cards.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Server-only read: whether scripts/demo.mjs started us against the local mock.
  const demo = process.env.OSS_DEMO === "1";
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen flex-col md:flex-row">
          <Rail demo={demo} />
          <main className="min-w-0 flex-1 px-4 py-8 md:px-10 md:py-10">
            <div className="mx-auto max-w-5xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
