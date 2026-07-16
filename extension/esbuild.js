/*
 * Builds two separate bundles:
 *
 *  1. The extension HOST (src/extension.ts) → dist/extension.js
 *     Runs in Node inside VS Code. `vscode` is external (provided by the editor).
 *
 *  2. The WEBVIEW (webview/index.tsx) → dist/webview.js (+ dist/webview.css)
 *     Runs in a browser-like sandbox. React, react-dom and react-window are
 *     bundled in. CSS imported from the entry is emitted as a sibling file.
 *
 *  3. The DIFF WORKER (src/worker/diffWorker.ts) → dist/diffWorker.js
 *     Runs in a Node worker_thread so the heavy read/sort/diff is off the host
 *     main thread. The engine is bundled in.
 *
 * Usage:
 *   node esbuild.js              one-shot dev build (with sourcemaps)
 *   node esbuild.js --watch      rebuild both on change
 *   node esbuild.js --production minified builds for packaging
 */
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionHost = {
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

/** @type {import('esbuild').BuildOptions} */
const diffWorker = {
  entryPoints: ["src/worker/diffWorker.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "dist/diffWorker.js",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const webview = {
  entryPoints: ["webview/index.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: "dist/webview.js",
  jsx: "automatic",
  loader: { ".css": "css" },
  // React reads this to pick its dev vs production build.
  define: { "process.env.NODE_ENV": production ? '"production"' : '"development"' },
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

async function main() {
  if (watch) {
    const contexts = await Promise.all([
      esbuild.context(extensionHost),
      esbuild.context(diffWorker),
      esbuild.context(webview),
    ]);
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("[esbuild] watching for changes (extension host + worker + webview)...");
  } else {
    await Promise.all([
      esbuild.build(extensionHost),
      esbuild.build(diffWorker),
      esbuild.build(webview),
    ]);
    console.log("[esbuild] build complete (extension host + worker + webview)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
