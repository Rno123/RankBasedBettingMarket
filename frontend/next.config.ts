import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // Polyfill Node.js built-ins for Solana/Anchor browser usage
      crypto: { browser: "crypto-browserify" },
      stream: { browser: "stream-browserify" },
      buffer: { browser: "buffer" },
    },
  },
};

export default nextConfig;
