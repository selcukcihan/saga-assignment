import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

await build({
  entryPoints: {
    "api/main": "src/api/main.ts",
    "worker/main": "src/worker/main.ts",
    "infrastructure/db/migrate": "src/infrastructure/db/migrate.ts",
  },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  outdir: "dist",
  sourcemap: true,
  sourcesContent: true,
  keepNames: true,
  logLevel: "info",
});
