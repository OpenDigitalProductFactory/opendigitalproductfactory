import { fileURLToPath } from "url";

const turbopackRoot = fileURLToPath(new URL("../..", import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@dpf/db", "@dpf/validators"],
  // Server-only document parsers loaded via dynamic `import()` in the upload
  // route (lib/shared/file-parsers.ts). They MUST stay external (not bundled)
  // so Next's standalone output traces them into the shipped node_modules —
  // otherwise `import("pdf-parse")` / "mammoth" / "read-excel-file" throw
  // "Cannot find package" at runtime in the production image and every document
  // upload 500s. (These are app-level deps; their symlink lives in
  // apps/web/node_modules, which the standalone trace omits without this.)
  serverExternalPackages: ["pdf-parse", "mammoth", "read-excel-file"],
  turbopack: {
    root: turbopackRoot,
  },
  experimental: {
    // Turbopack filesystem cache for `next build` — persists compilation
    // artifacts under `.next/cache` so a warm CI cache skips recompiling
    // unchanged modules. Still EXPERIMENTAL for production builds in Next 16.2,
    // so it is gated behind an env var and enabled ONLY in the CI verification
    // build (see .github/workflows/ci.yml). The shipped Docker release build
    // (publish-image.yml) leaves it OFF and is unaffected. Flip the env to
    // measure/disable; remove the gate once the feature is stable.
    turbopackFileSystemCacheForBuild:
      process.env.DPF_TURBOPACK_BUILD_CACHE === "1" || undefined,
  },
  outputFileTracingExcludes: {
    "**/*": ["./node_modules/@swc/core*", "./node_modules/esbuild*"],
  },
};

export default config;
