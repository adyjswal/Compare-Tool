/*
 * Bundles the extension host code (src/extension.ts) into a single dist/extension.js.
 *
 * Why bundle: the extension depends on the local `@large-file-compare/engine`
 * workspace package. esbuild inlines it (and any other deps) so the published
 * .vsix is self-contained and loads fast. `vscode` is the one module we must NOT
 * bundle -- it is provided by the editor at runtime, so it is marked external.
 *
 * Usage:
 *   node esbuild.js              one-shot dev build (with sourcemaps)
 *   node esbuild.js --watch      rebuild on change
 *   node esbuild.js --production minified build for packaging
 */
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("[esbuild] watching for changes...");
  } else {
    await esbuild.build(buildOptions);
    console.log("[esbuild] build complete");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
