import { build } from "esbuild";

const result = await build({
  entryPoints: ["apps/web/client/app.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  outdir: "apps/web/dist",
  metafile: true,
  logLevel: "warning",
});
for (const [file, info] of Object.entries(result.metafile.outputs)) console.log(`${file}: ${(info.bytes / 1024).toFixed(1)} KB`);
