import type { NextConfig } from "next";

// Fully static: the engine runs in the visitor's browser (Web Worker); there is no server.
const config: NextConfig = {
  output: "export",
  reactStrictMode: true,
  transpilePackages: ["@fragor/engine", "@fragor/scenarios"],
  images: { unoptimized: true },
};

export default config;
