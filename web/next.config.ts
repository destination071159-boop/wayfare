import type { NextConfig } from "next";

// The browser talks to the agent hub (pnpm -C agent hub) through /api and /files (same origin).
const HUB = process.env.HUB_URL ?? "http://127.0.0.1:7373";

const REPLAY = process.env.NEXT_PUBLIC_REPLAY === "1";

// NEXT_PUBLIC_REPLAY=1: a static, read-only site (out/) for hosting anywhere; scripts/replay.mjs adds the trip data.
const nextConfig: NextConfig = REPLAY
  ? { output: "export", distDir: ".next-replay", basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined, images: { unoptimized: true }, turbopack: { root: __dirname }, devIndicators: false }
  : {
  turbopack: { root: __dirname },
  devIndicators: false,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${HUB}/api/:path*` },
      { source: "/files/:path*", destination: `${HUB}/:path*` },
    ];
  },
};

export default nextConfig;
