// Bundles the CLI (and the workspace packages it imports) into one Node ESM file.
import { build } from "esbuild";

await build({
  entryPoints: ["packages/cli/src/bin.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "packages/cli/dist/fragor.mjs",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "warning",
});
