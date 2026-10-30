"use client";

/**
 * A reference-crop thumbnail. The refs route needs the studio access code
 * (an identity is a face), which an `<img src>` can't send, so the PNG is
 * fetched with the X-Access-Code header and shown from a blob URL.
 */
import { useEffect, useState } from "react";

import { refUrl, soulsFetch } from "../../lib/identity/client";

export function RefThumb({ id, n, alt, className }: { id: string; n: number; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    void soulsFetch(refUrl(id, n), { cache: "no-store" })
      .then(async (response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!alive || !blob) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, n]);

  if (!src) return <span role="img" aria-label={alt} className={`inline-block bg-border/40 ${className ?? ""}`} />;
  // eslint-disable-next-line @next/next/no-img-element -- blob URL of a local crop
  return <img src={src} alt={alt} className={className} />;
}
