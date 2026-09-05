import { fileURLToPath } from "url";

const turbopackRoot = fileURLToPath(new URL("../..", import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  // Type checking is OWNED BY THE `Typecheck` CI JOB, not by `next build`.
  //
  // `next build` runs its own TypeScript pass after compiling. On this monorepo
  // that pass is where the production build dies: the compile finishes in ~2min,
  // then "Running TypeScript ..." never completes and the runner is reclaimed
  // 13-23 minutes later ("The runner has received a shutdown signal") — well
  // inside the job's 45m timeout, so it is the runner going away, not the job
  // timing out. Observed on PR #3872 (three merge-queue evictions, cache OFF on
  // merge_group) and PR #3982 (cache ON, pull_request), so it is NOT the
  // experimental Turbopack build cache: it hangs either way.
  //
  // Safe because the SAME work already runs, reliably, as its own required gate:
  // in the very run where the build hung 13min, the standalone `Typecheck` job
  // (tsc across all workspaces) passed in 3m36s. Merge Readiness depends on it,
  // so a type error still blocks merge.
  //
  // Coverage checked before flipping this, not assumed: `typedRoutes` is NOT
  // enabled, so the generated `.next/types` surface that only `next build`
  // produces is negligible, and tsconfig already covers `**/*.ts(x)`. If
  // typedRoutes is ever enabled, this needs revisiting — the Typecheck job would
  // then have to generate those types first.
  typescript: { ignoreBuildErrors: true },
  transpilePackages: ["@dpf/db", "@dpf/storefront-templates", "@dpf/validators"],
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
  // BI-018AE129: lib/design-intelligence.ts reads these CSVs with runtime
  // readFileSync, which NFT tracing cannot see — without this include the
  // standalone output ships no design-intelligence data and every
  // search_design_intelligence / generate_design_system call returns empty
  // in production (the loader also falls back to the apps/web-src copy).
  outputFileTracingIncludes: {
    "**/*": ["./data/design-intelligence/**"],
  },
  // EP-0AF96937 Phase 5: the decision-governance surface moved from /wiki to
  // /coworker-decisions. Permanently redirect the old paths so existing
  // bookmarks, deep links, and any lingering internal references keep working.
  async redirects() {
    return [
      { source: "/wiki", destination: "/coworker-decisions", permanent: true },
      {
        source: "/wiki/:path*",
        destination: "/coworker-decisions/:path*",
        permanent: true,
      },
    ];
  },
};

export default config;
