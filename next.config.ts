import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Read from disk at request time by the API routes: graphs (comfy steps) and
  // card fonts (lib/cards). Keys are route globs (picomatch).
  outputFileTracingIncludes: {
    "/api/jobs": ["./workflows/**/*.api.json"],
    "/api/pipelines/**": ["./workflows/**/*.api.json", "./assets/fonts/**/*"],
  },
};

export default nextConfig;
