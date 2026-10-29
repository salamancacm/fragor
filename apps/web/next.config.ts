import type { NextConfig } from "next";

// Fully static: the engine runs in the visitor's browser (Web Worker); there is no server.
// FRAGOR_BASE_PATH serves the app from a sub-path, e.g. "/fragor" for a GitHub Pages project site
// (https://<user>.github.io/fragor/). Unset (local development) it is served from "/".
const basePath = process.env.FRAGOR_BASE_PATH ?? "";
if (basePath !== "" && !/^\/[A-Za-z0-9._-]+$/.test(basePath)) {
  throw new Error(`FRAGOR_BASE_PATH must look like "/name", got "${basePath}"`);
}

const config: NextConfig = {
  output: "export",
  reactStrictMode: true,
  transpilePackages: ["@fragor/engine", "@fragor/importers", "@fragor/scenarios"],
  images: { unoptimized: true },
  ...(basePath === "" ? {} : { basePath }),
};

export default config;
