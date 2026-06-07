import { fileURLToPath } from "url";

const turbopackRoot = fileURLToPath(new URL("../..", import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@dpf/db", "@dpf/validators"],
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
