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

const UNKNOWN_LOG = `error: connect ECONNREFUSED 127.0.0.1:5432
prisma migrate failed`;

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
