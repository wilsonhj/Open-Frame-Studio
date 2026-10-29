import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workflows are read from disk at request time by the API routes.
  outputFileTracingIncludes: {
    "/api/jobs": ["./workflows/**/*.api.json"],
  },
};

export default nextConfig;
