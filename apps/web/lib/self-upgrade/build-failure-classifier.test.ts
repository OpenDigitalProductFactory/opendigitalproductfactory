import { describe, expect, it } from "vitest";
import {
  classifyBuildFailure,
  formatClassifiedExcerpt,
} from "./build-failure-classifier";

// Verbatim from docs/triage/2026-05-24-portal-prisma-generate-rebuild-failure.md
const HOIST_LOG = `#23 [build 8/8] RUN pnpm --filter web build
#23 18.77 ✓ Compiled successfully in 17.1s
#23 18.78   Running TypeScript ...
#23 56.16 Failed to type check.
#23 56.16 ./lib/gear-interface/otel-exporter.ts:127:25
#23 56.16 Type error: Cannot find module '@opentelemetry/api' or its corresponding type declarations.
#23 56.41 Next.js build worker exited with code: 1`;

const NFT_LOG = `Creating an optimized production build ...
Error: Conflict: Multiple assets emit to the same filename static/chunks/4821.js
  at emitAsset (turbopack)
Build failed because of webpack errors`;

const BUNDLE_BOUNDARY_LOG = `Tracing apps/web/next.config.mjs
  -> lib/self-upgrade/promoter.ts
  -> queue/functions/self-upgrade.ts
  -> api/inngest/route.ts
Error: duplicate emitted asset static/chunks/self-upgrade.js (conflict)`;

const BUNDLE_BOUNDARY_UNEXPECTED_NFT_LOG = `./apps/web/next.config.mjs
Encountered unexpected file in NFT list
A file was traced that indicates that the whole project was traced unintentionally.
Import trace:
  Server Component:
    ./apps/web/next.config.mjs
    ./apps/web/lib/self-upgrade/promoter.ts
    ./apps/web/lib/actions/promotions.ts
    ./apps/web/app/(shell)/ops/self-upgrade/page.tsx

> Build error occurred
Error: Turbopack build failed with 2 errors:
./packages/integration-shared/src/oauth-refresh.ts:1:1
Module not found: Can't resolve 'undici'`;

const UNKNOWN_LOG = `error: connect ECONNREFUSED 127.0.0.1:5432
prisma migrate failed`;

// Verbatim from SUR-73668D5C (2026-07-05): the classic builder's step output
// (pnpm's own error) was lost — only compose stderr survived, ending in the
// bare non-zero RUN line. Must still classify as a retryable install failure.
const PNPM_INSTALL_RUNLINE_LOG = `time="2026-07-05T11:34:45Z" level=warning msg="Docker Compose requires buildx plugin to be installed"
 Image dpf-portal Building
 Image dpf-portal Building
The command '/bin/sh -c pnpm install --frozen-lockfile' returned a non-zero code: 1`;

const PNPM_FETCH_LOG = `#12 [build 4/8] RUN pnpm install --frozen-lockfile
#12 371.2 WARN GET https://registry.npmjs.org/smol-toml/-/smol-toml-1.7.0.tgz: ETIMEDOUT (retrying, attempt 2)
#12 402.9  ERR_PNPM_FETCH_404 or network failure
The command '/bin/sh -c pnpm install --frozen-lockfile' returned a non-zero code: 1`;

const PNPM_LOCKFILE_DRIFT_LOG = `#12 [deps 9/9] RUN pnpm install --frozen-lockfile
#12 2.1 ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with apps/web/package.json
The command '/bin/sh -c pnpm install --frozen-lockfile' returned a non-zero code: 1`;

describe("classifyBuildFailure", () => {
  it("classifies the real @opentelemetry host-vs-Docker hoist divergence", () => {
    const c = classifyBuildFailure({ log: HOIST_LOG, hostBuildPassed: true });
    expect(c.class).toBe("host-docker-hoist-divergence");
    expect(c.isMainDefectVsEnvironment).toBe("main-defect");
    expect(c.summary).toContain("@opentelemetry/api");
    expect(c.summary).toContain("host build passed");
    expect(c.playbookLink).toMatch(/portal-prisma-generate-rebuild-failure/);
    expect(c.failingTrace).toContain("Cannot find module");
  });

  it("classifies a generic Turbopack/NFT duplicate-asset cascade", () => {
    const c = classifyBuildFailure({ log: NFT_LOG });
    expect(c.class).toBe("turbopack-nft-duplicate-asset");
    expect(c.failingTrace).toContain("Multiple assets emit");
  });

  it("prefers bundle-boundary when a duplicate-asset trace fingerprints a host-only module", () => {
    const c = classifyBuildFailure({ log: BUNDLE_BOUNDARY_LOG });
    expect(c.class).toBe("bundle-boundary-static-import");
    expect(c.summary).toContain("#1555");
    expect(c.isMainDefectVsEnvironment).toBe("main-defect");
  });

  it("prefers bundle-boundary when an unexpected-NFT trace fingerprints a page/action host-only import", () => {
    const c = classifyBuildFailure({ log: BUNDLE_BOUNDARY_UNEXPECTED_NFT_LOG });
    expect(c.class).toBe("bundle-boundary-static-import");
    expect(c.summary).toContain("route/page/action/Inngest");
    expect(c.failingTrace).toContain("Encountered unexpected file");
    expect(c.isMainDefectVsEnvironment).toBe("main-defect");
  });

  it("classifies the SUR-73668D5C bare RUN-line install failure as retryable environment", () => {
    const c = classifyBuildFailure({ log: PNPM_INSTALL_RUNLINE_LOG });
    expect(c.class).toBe("pnpm-install-failure");
    expect(c.isMainDefectVsEnvironment).toBe("environment");
    expect(c.summary).toContain("Retry the upgrade first");
    expect(c.failingTrace).toContain("returned a non-zero code");
  });

  it("classifies a registry fetch error as retryable environment", () => {
    const c = classifyBuildFailure({ log: PNPM_FETCH_LOG });
    expect(c.class).toBe("pnpm-install-failure");
    expect(c.isMainDefectVsEnvironment).toBe("environment");
    expect(c.failingTrace).toContain("registry.npmjs.org");
  });

  it("classifies a frozen-lockfile drift as a main defect, not environment", () => {
    const c = classifyBuildFailure({ log: PNPM_LOCKFILE_DRIFT_LOG });
    expect(c.class).toBe("pnpm-install-failure");
    expect(c.isMainDefectVsEnvironment).toBe("main-defect");
    expect(c.summary).toContain("lockfile");
  });

  it("keeps a non-pnpm ECONNREFUSED (e.g. prisma → postgres) unclassified", () => {
    const c = classifyBuildFailure({ log: UNKNOWN_LOG });
    expect(c.class).toBe("unknown");
  });

  it("falls back to unknown with a null defect/environment verdict", () => {
    const c = classifyBuildFailure({ log: UNKNOWN_LOG });
    expect(c.class).toBe("unknown");
    expect(c.isMainDefectVsEnvironment).toBeNull();
    expect(c.failingTrace.length).toBeGreaterThan(0);
  });

  it("is total — every input yields a populated summary and playbook", () => {
    for (const log of [HOIST_LOG, NFT_LOG, BUNDLE_BOUNDARY_LOG, UNKNOWN_LOG, ""]) {
      const c = classifyBuildFailure({ log });
      expect(c.summary.length).toBeGreaterThan(0);
      expect(c.playbookLink.length).toBeGreaterThan(0);
    }
  });
});

describe("formatClassifiedExcerpt", () => {
  it("leads the excerpt with the class, summary, and playbook, keeping the raw log", () => {
    const c = classifyBuildFailure({ log: HOIST_LOG, hostBuildPassed: true });
    const excerpt = formatClassifiedExcerpt(c, HOIST_LOG);
    expect(excerpt).toMatch(/^\[build-failure-class\] host-docker-hoist-divergence/);
    expect(excerpt).toContain("playbook:");
    expect(excerpt).toContain("Cannot find module '@opentelemetry/api'");
  });
});
