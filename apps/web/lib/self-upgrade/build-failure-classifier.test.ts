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

// Reconstructed from self-upgrade run SUR-BCFB72BB (2026-07-11, BI-062CFB41).
// Structurally IDENTICAL to BUNDLE_BOUNDARY_UNEXPECTED_NFT_LOG — a Turbopack NFT
// "whole project traced unintentionally" WARNING whose trace fingerprints the
// host-only self-upgrade barrel, printed ABOVE the fatal — EXCEPT the fatal is a
// relative path escaping to a repo-root dir (config/), not a bare specifier.
// That single difference must flip the class to the build-context miss, so this
// asserts the fatal marker wins over the NFT warning above it.
const DOCKER_CONTEXT_MISS_LOG = `#30 [build 7/8] RUN pnpm --filter web build
#30 12.40   ▲ Next.js 15.3.0 (Turbopack)
#30 40.10 ./apps/web/next.config.mjs
#30 40.11 Encountered unexpected file in NFT list
#30 40.11 A file was traced that indicates that the whole project was traced unintentionally.
#30 40.12 Import trace:
#30 40.12     ./apps/web/lib/self-upgrade/promoter.ts
#30 40.12     ./apps/web/lib/actions/promotions.ts
#30 52.73  ⨯ Build error occurred
#30 52.73 Error: Module not found: Can't resolve '../../../../config/seed-content-paths.json'
#30 52.73     at lib/integrate/seed-contribution-fit.ts:4:1
#30 52.90 Next.js build worker exited with code: 1
#30 ERROR: process "/bin/sh -c pnpm --filter web build" did not complete successfully: exit code: 1`;

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

// Verbatim shape from the BET-5 live upgrades (SUR-*, 2026-07-14): a pre-BET-5
// install on postgres:16-alpine failed the vector migration at CREATE EXTENSION.
const PGVECTOR_MISSING_LOG = `Applying migration \`20260714110000_bet5_pgvector_foundation\`
Error: P3018
A migration failed to apply. New migrations cannot be applied before the error is recovered from.
Migration name: 20260714110000_bet5_pgvector_foundation
Database error code: 0A000
Database error:
ERROR: extension "vector" is not available
DETAIL: Could not open extension control file "/usr/local/share/postgresql/extension/vector.control": No such file or directory.
HINT: The extension must first be installed on the system where PostgreSQL is running.`;

// The downstream symptom on a RETRY after the pgvector failure above: Prisma's
// P3009 now blocks every migration until the failed record is resolved. Note it
// carries NO "extension vector" text — only the P3009 state — so it must classify
// as p3009-failed-migration in its own right.
const P3009_BLOCKED_LOG = `Error: P3009
migrate found failed migrations in the target database, new migrations will not be applied. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve
The \`20260714110000_bet5_pgvector_foundation\` migration started at 2026-07-14 11:02:03 UTC failed`;

// Verbatim shape from SUR-859DB221 (2026-07-16): the staging-gate migration's
// bulk backfill UPDATE over PlatformIssueReport collided with the log-signature
// scanner still writing the same hot table, tripping the partial unique index.
// P3018 + 23505 + a dedupeKey duplicate — NO "vector" text, so it must NOT be
// swept up as pgvector, and it precedes the P3009 the identical retry hits.
const MIGRATION_UNIQUE_VIOLATION_LOG = `Applying migration \`20260716130000_add_pir_reach_staging_gate\`
Error: P3018
A migration failed to apply. New migrations cannot be applied before the error is recovered from.
Migration name: 20260716130000_add_pir_reach_staging_gate
Database error code: 23505
Database error:
ERROR: duplicate key value violates unique constraint "PlatformIssueReport_dedupeKey_open_key"
DETAIL: Key ("dedupeKey")=(log-sig:sandbox:3c148b45c3) already exists.`;

// Verbatim shape from BI-D8C0D045 (run SUR-C8BC533B, 2026-07-15): postgres was
// unreachable during the upgrade (stranded in `Created` by the pre-#2978
// ensure-pgvector bug), so the boot backfill's Prisma write hit P1001.
const DB_UNREACHABLE_LOG = `[bet5-backfill] starting projection backfill
Invalid \`prisma.selfUpgradeRun.update()\` invocation:
Error querying the database: Can't reach database server at \`postgres\`:\`5432\`
Please make sure your database server is running at \`postgres\`:\`5432\`.`;

describe("classifyBuildFailure", () => {
  it("classifies promoter readiness failures and retains their machine code", () => {
    const c = classifyBuildFailure({ log: "upgrade failed: promoter-readiness-failed:install_state_invalid" });
    expect(c.class).toBe("promoter-readiness-failed");
    expect(c.summary).toContain("install_state_invalid");
    expect(c.summary).toContain("refused to quiesce");
    expect(c.failingTrace).toContain("promoter-readiness-failed:install_state_invalid");
  });

  it.each([
    "promoter-readiness-failed: Promoter readiness check failed: install_state_invalid",
    "promoter-readiness-failed: install_state_invalid",
    "prefix promoter-readiness-failed: Promoter readiness check failed: state_mount_unreadable\ntrailing diagnostics",
  ])("extracts the terminal promoter readiness machine code from production output: %s", (log) => {
    const c = classifyBuildFailure({ log });
    expect(c.class).toBe("promoter-readiness-failed");
    expect(c.summary).toContain(log.includes("state_mount") ? "state_mount_unreadable" : "install_state_invalid");
  });

  it("classifies a production readiness prefix even when the report has no machine code", () => {
    const c = classifyBuildFailure({ log: "promoter-readiness-failed: Promoter readiness returned an invalid report." });
    expect(c.class).toBe("promoter-readiness-failed");
    expect(c.summary).toContain("refused to quiesce");
    expect(c.failingTrace).toContain("invalid report");
  });

  it("classifies the real @opentelemetry host-vs-Docker hoist divergence", () => {
    const c = classifyBuildFailure({ log: HOIST_LOG, hostBuildPassed: true });
    expect(c.class).toBe("host-docker-hoist-divergence");
    expect(c.isMainDefectVsEnvironment).toBe("main-defect");
    expect(c.summary).toContain("@opentelemetry/api");
    expect(c.summary).toContain("host build passed");
    expect(c.playbookLink).toMatch(/portal-prisma-generate-rebuild-failure/);
    expect(c.failingTrace).toContain("Cannot find module");
  });

  it("classifies the Docker Desktop /dpf-state mounts-denied blocker with a DPF_STATE_DIR fix (#3262)", () => {
    // The real fleet symptom: image builds fine, then step=migrate's
    // `docker compose run portal` fails because the /dpf-state mount resolved to
    // /root/.dpf under the root-run promoter.
    const log = [
      "Successfully tagged dpf-portal:latest",
      "step=ensure-pgvector target=9ca9ca2e",
      "step=migrate target=9ca9ca2e",
      "Error response from daemon: mounts denied: ",
      "The path /root/.dpf is not shared from the host and is not known to Docker.",
    ].join("\n");
    const c = classifyBuildFailure({ log });
    expect(c.class).toBe("docker-mount-denied");
    expect(c.summary).toContain("DPF_STATE_DIR");
    expect(c.summary).toContain("/root/.dpf");
    expect(c.isMainDefectVsEnvironment).toBe("environment");
    expect(c.failingTrace).toContain("mounts denied");
  });

  it("classifies the capability_state_stale preflight abort instead of leaving it unknown (BI-B132DF1D)", () => {
    // The real fleet symptom: promote.sh's capability preflight aborts in ~4s
    // before any build, and the wrapper reported it as "unknown (unclassified)".
    const log = [
      "[build-failure-class] unknown (unclassified)",
      "--- stderr (tail) ---",
      "error: capability_state_stale",
    ].join("\n");
    const c = classifyBuildFailure({ log });
    expect(c.class).toBe("capability-state-preflight-unavailable");
    expect(c.class).not.toBe("unknown");
    expect(c.summary).toContain("MISLABEL");
    expect(c.summary).toContain("#3272");
    expect(c.isMainDefectVsEnvironment).toBe("environment");
    expect(c.failingTrace).toContain("capability_state_stale");
  });

  it("classifies the #3282 migration-handoff crossing block instead of leaving it unknown (BI-BE8BBDE9)", () => {
    // Live symptom on a pre-#3282 install: readiness passes, promote.sh exits 78,
    // and the wrapper reported it as "unknown (unclassified)" with the wrong playbook.
    const log = [
      "[build-failure-class] unknown (unclassified)",
      "--- stderr (tail) ---",
      "error: install_state_migration_handoff_missing",
    ].join("\n");
    const c = classifyBuildFailure({ log });
    expect(c.class).toBe("install-state-migration-handoff-missing");
    expect(c.class).not.toBe("unknown");
    // Must steer to the out-of-band crossing bootstrap, not a retry/rebuild.
    expect(c.summary).toContain("Do NOT retry");
    expect(c.summary).toContain("runtime-transition.secret");
    expect(c.isMainDefectVsEnvironment).toBe("environment");
    expect(c.failingTrace).toContain("install_state_migration_handoff_missing");
  });

  it("keeps an unrelated mounts-denied path out of the state-dir advice", () => {
    const log = "Error response from daemon: mounts denied: The path /some/other/vol is not shared from the host.";
    const c = classifyBuildFailure({ log });
    expect(c.class).toBe("docker-mount-denied");
    // Generic File-Sharing advice, NOT the specific "state dir fell back to
    // /root/.dpf, set it to /Users/<user>/.dpf" instruction.
    expect(c.summary).not.toContain("fell back");
    expect(c.summary).toContain("File Sharing");
    expect(c.summary).toContain("/some/other/vol");
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

  it("prioritizes the fatal Module-not-found over an NFT warning above it (SUR-BCFB72BB)", () => {
    const c = classifyBuildFailure({ log: DOCKER_CONTEXT_MISS_LOG });
    // The escaping relative-path fatal wins — NOT bundle-boundary, even though a
    // "whole project traced unintentionally" warning fingerprinting the
    // self-upgrade barrel (the exact BUNDLE_BOUNDARY_UNEXPECTED_NFT signature)
    // sits above it. This is the mislabel BI-062CFB41 was filed against.
    expect(c.class).toBe("docker-build-context-missing-path");
    expect(c.class).not.toBe("bundle-boundary-static-import");
    expect(c.summary).toContain("config/");
    expect(c.summary).toContain("#2786");
    expect(c.playbookLink).toMatch(/dockerfile-build-context\.guard\.test\.ts/);
    expect(c.failingTrace).toContain(
      "Can't resolve '../../../../config/seed-content-paths.json'",
    );
    expect(c.isMainDefectVsEnvironment).toBe("main-defect");
  });

  it("keeps a bare-specifier miss with an NFT host-only trace on bundle-boundary, not build-context", () => {
    // Guards the discriminator: 'undici' is a bare specifier, not a relative
    // escape, so the existing bundle-boundary heuristic must still own it.
    const c = classifyBuildFailure({ log: BUNDLE_BOUNDARY_UNEXPECTED_NFT_LOG });
    expect(c.class).toBe("bundle-boundary-static-import");
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

  it("classifies a promoter timeout as retryable environment, superseding earlier build noise", () => {
    // The kill happened because nothing completed, so a half-emitted NFT trace
    // above the marker is noise — the timeout must win.
    const log = `#30 [build 66/105] RUN apk add --no-cache docker-cli curl nmap
#30 40.11 (12/27) Installing docker-cli (29.5.3-r0)
[promoter-timeout] promoter did not finish within 25m — killed and container force-removed.`;
    const c = classifyBuildFailure({ log });
    expect(c.class).toBe("promoter-timeout");
    expect(c.isMainDefectVsEnvironment).toBe("environment");
    expect(c.summary).toContain("Retry the upgrade");
    expect(c.failingTrace).toContain("[promoter-timeout]");
  });

  it("classifies a pgvector-missing migrate failure as environment, pointing at the recreate playbook", () => {
    const c = classifyBuildFailure({ log: PGVECTOR_MISSING_LOG });
    expect(c.class).toBe("pgvector-extension-missing");
    expect(c.isMainDefectVsEnvironment).toBe("environment");
    expect(c.summary).toContain("ensure-pgvector");
    expect(c.summary).toContain("rebuild the promoter");
    expect(c.playbookLink).toMatch(/bet5-windows-self-upgrade/);
    expect(c.failingTrace).toContain("vector");
  });

  it("classifies a P3009 blocked-migration state as environment, pointing at BOTH resolve directions", () => {
    const c = classifyBuildFailure({ log: P3009_BLOCKED_LOG });
    expect(c.class).toBe("p3009-failed-migration");
    expect(c.isMainDefectVsEnvironment).toBe("environment");
    // Guidance must offer both directions so a schema-already-applied failure
    // (data-collision) is not mis-recovered with --rolled-back (SUR-859DB221).
    expect(c.summary).toContain("resolve --rolled-back");
    expect(c.summary).toContain("resolve --applied");
    expect(c.playbookLink).toMatch(/bet5-windows-self-upgrade/);
  });

  it("classifies a P3018 unique-constraint migration failure as its own class with --applied guidance (SUR-859DB221)", () => {
    const c = classifyBuildFailure({ log: MIGRATION_UNIQUE_VIOLATION_LOG });
    expect(c.class).toBe("migration-unique-violation");
    expect(c.isMainDefectVsEnvironment).toBe("environment");
    // Names the offending constraint and steers to the correct resolve direction.
    expect(c.summary).toContain("PlatformIssueReport_dedupeKey_open_key");
    expect(c.summary).toContain("resolve --applied");
    expect(c.failingTrace).toContain("duplicate key value violates unique constraint");
  });

  it("does NOT sweep the pgvector P3018 (0A000, no 23505) into the unique-violation class", () => {
    // Both are P3018 apply failures; only the 23505 one is the unique-violation class.
    expect(classifyBuildFailure({ log: PGVECTOR_MISSING_LOG }).class).toBe("pgvector-extension-missing");
    expect(classifyBuildFailure({ log: MIGRATION_UNIQUE_VIOLATION_LOG }).class).toBe("migration-unique-violation");
  });

  it("prefers the pgvector root cause over P3009 when a log carries both", () => {
    const c = classifyBuildFailure({ log: `${P3009_BLOCKED_LOG}\n${PGVECTOR_MISSING_LOG}` });
    expect(c.class).toBe("pgvector-extension-missing");
  });

  it("keeps a bare 'prisma migrate failed' (no P3009/pgvector signature) unclassified", () => {
    // Guards the specificity: the generic UNKNOWN_LOG must NOT be swept up by the
    // new migrate-failure classes.
    const c = classifyBuildFailure({ log: UNKNOWN_LOG });
    expect(c.class).toBe("unknown");
  });

  it("classifies a Prisma P1001 database-unreachable failure as environment", () => {
    const c = classifyBuildFailure({ log: DB_UNREACHABLE_LOG });
    expect(c.class).toBe("database-unreachable");
    expect(c.isMainDefectVsEnvironment).toBe("environment");
    expect(c.summary).toContain("Can't reach database server");
    expect(c.playbookLink).toMatch(/bet5-windows-self-upgrade/);
    expect(c.failingTrace).toContain("Can't reach database server");
  });

  it("discriminates P1001 (database-unreachable) from a bare ECONNREFUSED (unknown)", () => {
    // The specific Prisma phrasing is classified; the ambiguous bare errno is not
    // (UNKNOWN_LOG is `connect ECONNREFUSED 127.0.0.1:5432` with no P1001 text).
    expect(classifyBuildFailure({ log: DB_UNREACHABLE_LOG }).class).toBe("database-unreachable");
    expect(classifyBuildFailure({ log: UNKNOWN_LOG }).class).toBe("unknown");
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
    for (const log of [HOIST_LOG, NFT_LOG, BUNDLE_BOUNDARY_LOG, DOCKER_CONTEXT_MISS_LOG, PGVECTOR_MISSING_LOG, P3009_BLOCKED_LOG, DB_UNREACHABLE_LOG, UNKNOWN_LOG, ""]) {
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
