import type { NextConfig } from "next";

const ONNX_LINUX_X64 = "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/*";

const nextConfig: NextConfig = {
  // Read from disk at request time by the API routes: graphs (comfy steps),
  // card fonts (lib/cards) and the YuNet face detector (lib/identity). Keys
  // are route globs (picomatch). The tracer follows onnxruntime-node's
  // binding (.node) but not the shared library it dlopens, so ship
  // libonnxruntime.so.1 for the Linux x64 deploy target explicitly.
  outputFileTracingIncludes: {
    "/api/jobs": ["./workflows/**/*.api.json"],
    "/api/pipelines/**": ["./workflows/**/*.api.json", "./assets/fonts/**/*", "./lib/identity/models/**/*", ONNX_LINUX_X64],
    "/api/souls/**": ["./lib/identity/models/**/*", ONNX_LINUX_X64],
  },
};

export default nextConfig;
