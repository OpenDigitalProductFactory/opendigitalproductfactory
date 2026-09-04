import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CI_EVIDENCE_PLAN_SCHEMA_VERSION,
  canonicalJson,
  createEvidencePlan,
  loadEvidencePolicy,
} from "./ci-evidence-plan.mjs";

const policy = loadEvidencePolicy();

function input(overrides = {}) {
  return {
    eventName: "pull_request",
    baseSha: "base-commit",
    headSha: "head-commit",
    baseTreeSha: "base-tree",
    headTreeSha: "head-tree",
    changedFiles: [],
    knownTests: [],
    relatedTestsBySource: {},
    codeGraphAdvice: null,
    routeAdviceBySource: {},
    packageDependencies: {},
    totalTestCount: 100,
    policy,
    ...overrides,
  };
}

function trustedGraph(recommendations = {}) {
  return {
    schemaVersion: 1,
    graphKey: "source-code",
    indexStatus: "ready",
    indexedHeadSha: "head-commit",
    indexedTreeSha: "head-tree",
    workspaceDirty: false,
    relationshipCounts: {
      DEFINES: 10,
      IMPORTS: 20,
      IMPLEMENTS_ROUTE: 5,
      EXPOSES_TOOL: 5,
      TESTED_BY: 8,
    },
    recommendations,
  };
}

function escalationCodes(plan) {
  return plan.escalations.map((entry) => entry.code);
}

describe("createEvidencePlan", () => {
  it("emits a versioned deterministic semantic plan and digest", () => {
    const first = createEvidencePlan(input({
      changedFiles: [
        "apps/web/lib/orders.test.ts",
        "apps/web/lib/orders.ts",
      ],
      knownTests: ["apps/web/lib/orders.test.ts"],
      codeGraphAdvice: trustedGraph({
        "apps/web/lib/orders.ts": ["apps/web/lib/orders.test.ts"],
      }),
      generatedAt: "2026-07-27T01:00:00Z",
      hostPath: "D:/one",
    }));
    const second = createEvidencePlan(input({
      changedFiles: [
        "apps/web/lib/orders.ts",
        "apps/web/lib/orders.test.ts",
      ],
      knownTests: ["apps/web/lib/orders.test.ts"],
      codeGraphAdvice: trustedGraph({
        "apps/web/lib/orders.ts": ["apps/web/lib/orders.test.ts"],
      }),
      generatedAt: "2026-07-28T02:00:00Z",
      hostPath: "/tmp/two",
    }));

    assert.equal(first.schemaVersion, CI_EVIDENCE_PLAN_SCHEMA_VERSION);
    assert.equal(first.digest.length, 64);
    assert.equal(canonicalJson(first), canonicalJson(second));
    assert.deepEqual(first.changedFiles, [
      "apps/web/lib/orders.test.ts",
      "apps/web/lib/orders.ts",
    ]);
  });

  it("keeps the digest stable across synthetic merge commits with identical trees", () => {
    const first = createEvidencePlan(input({
      baseSha: "accepted-base-commit",
      headSha: "local-merge-one",
      changedFiles: ["docs/testing/ci-evidence.md"],
    }));
    const second = createEvidencePlan(input({
      baseSha: "other-ref-to-the-same-base-tree",
      headSha: "local-merge-two",
      changedFiles: ["docs/testing/ci-evidence.md"],
    }));

    assert.notEqual(first.headSha, second.headSha);
    assert.equal(first.headTreeSha, second.headTreeSha);
    assert.equal(first.digest, second.digest);
  });

  it("preserves the existing docs-only exemption without graph input", () => {
    const plan = createEvidencePlan(input({
      changedFiles: [
        "README.md",
        "docs/testing/ci-evidence.md",
      ],
    }));

    assert.equal(plan.scope.docsOnly, true);
    assert.equal(plan.scope.heavy, false);
    assert.equal(plan.fullSuite, false);
    assert.equal(plan.executionLane, "documentation");
    assert.equal(plan.uxMode, "none");
    assert.deepEqual(plan.escalations, []);
  });

  it("keeps a docs-only change non-portal when it includes its generated doc index", () => {
    const plan = createEvidencePlan(input({
      changedFiles: [
        "docs/architecture/archetype-operating-model-audit.md",
        "docs/architecture/platform-overview.md",
        "apps/web/lib/docs/doc-index.generated.json",
      ],
    }));

    assert.equal(plan.scope.docsOnly, true);
    assert.equal(plan.scope.heavy, false);
    assert.equal(plan.fullSuite, false);
    assert.equal(plan.uxMode, "none");
    assert.deepEqual(plan.escalations, []);
  });

  it("does not treat runtime code under a docs-named module as documentation", () => {
    const plan = createEvidencePlan(input({
      changedFiles: ["apps/web/lib/docs/doc-link-resolver.mjs"],
    }));

    assert.equal(plan.scope.docsOnly, false);
    assert.equal(plan.scope.heavy, true);
    assert.equal(plan.fullSuite, true);
  });

  it("keeps a generated doc index exhaustive when no documentation source changed", () => {
    const plan = createEvidencePlan(input({
      changedFiles: ["apps/web/lib/docs/doc-index.generated.json"],
    }));

    assert.equal(plan.scope.docsOnly, false);
    assert.equal(plan.scope.heavy, true);
    assert.equal(plan.fullSuite, true);
  });

  for (const executableStandardPath of [
    "docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md",
    "docs/architecture/four-portfolio-archetype-standard-profile-catalog.md",
  ]) {
    it(`requires workspace evidence for ${executableStandardPath}`, () => {
      const plan = createEvidencePlan(input({
        changedFiles: [
          executableStandardPath,
          "apps/mobile/app/index.tsx",
        ],
      }));

      assert.deepEqual(plan.scope, {
        docsOnly: false,
        mobileOnly: false,
        mobile: true,
        heavy: true,
      });
    });
  }

  it("recommends deterministic related tests but expands runtime source when graph input is missing", () => {
    const plan = createEvidencePlan(input({
      changedFiles: ["apps/web/lib/orders.ts"],
      knownTests: ["apps/web/lib/orders.test.ts"],
      relatedTestsBySource: {
        "apps/web/lib/orders.ts": ["apps/web/lib/orders.test.ts"],
      },
    }));

    assert.deepEqual(plan.affectedTests, ["apps/web/lib/orders.test.ts"]);
    assert.equal(plan.fullSuite, true);
    assert.ok(escalationCodes(plan).includes("graph-missing"));
  });

  it("uses exact-tree clean graph TESTED_BY advice without making it the sole selector", () => {
    const plan = createEvidencePlan(input({
      changedFiles: ["apps/web/lib/orders.ts"],
      knownTests: [
        "apps/web/lib/orders.contract.test.ts",
        "apps/web/lib/orders.test.ts",
      ],
      relatedTestsBySource: {
        "apps/web/lib/orders.ts": ["apps/web/lib/orders.test.ts"],
      },
      codeGraphAdvice: trustedGraph({
        "apps/web/lib/orders.ts": ["apps/web/lib/orders.contract.test.ts"],
      }),
    }));

    assert.deepEqual(plan.affectedTests, [
      "apps/web/lib/orders.contract.test.ts",
      "apps/web/lib/orders.test.ts",
    ]);
    assert.equal(plan.graph.trusted, true);
    assert.equal(plan.fullSuite, false);
    assert.equal(plan.executionLane, "affected");
  });

  it("accepts a different commit alias when graph advice matches the exact tree", () => {
    const plan = createEvidencePlan(input({
      changedFiles: ["apps/web/lib/orders.ts"],
      knownTests: ["apps/web/lib/orders.test.ts"],
      codeGraphAdvice: {
        ...trustedGraph({
          "apps/web/lib/orders.ts": ["apps/web/lib/orders.test.ts"],
        }),
        indexedHeadSha: "candidate-before-synthetic-merge",
      },
    }));

    assert.equal(plan.graph.trusted, true);
    assert.equal(plan.fullSuite, false);
  });

  for (const [name, advice, code] of [
    ["dirty workspace", { ...trustedGraph(), workspaceDirty: true }, "graph-dirty"],
    ["incompatible schema", { ...trustedGraph(), schemaVersion: 2 }, "graph-schema-mismatch"],
    ["stale tree", { ...trustedGraph(), indexedTreeSha: "other-tree" }, "graph-tree-mismatch"],
    ["missing TESTED_BY facts", {
      ...trustedGraph(),
      relationshipCounts: { ...trustedGraph().relationshipCounts, TESTED_BY: 0 },
    }, "graph-relationships-missing"],
  ]) {
    it(`fails safe for ${name}`, () => {
      const plan = createEvidencePlan(input({
        changedFiles: ["apps/web/lib/orders.ts"],
        knownTests: ["apps/web/lib/orders.test.ts"],
        relatedTestsBySource: {
          "apps/web/lib/orders.ts": ["apps/web/lib/orders.test.ts"],
        },
        codeGraphAdvice: advice,
      }));

      assert.equal(plan.fullSuite, true);
      assert.equal(plan.executionLane, "exhaustive");
      assert.ok(escalationCodes(plan).includes(code));
    });
  }

  for (const [path, code] of [
    ["pnpm-lock.yaml", "lockfile"],
    [".github/workflows/ci.yml", "workflow"],
    ["packages/db/prisma/schema.prisma", "migration"],
    ["apps/web/lib/auth/session.ts", "auth"],
    ["apps/web/app/layout.tsx", "routing-shell"],
    ["apps/web/vitest.config.ts", "test-config"],
    ["scripts/seed-fixtures.mjs", "install-seed"],
    ["apps/web/lib/docs/doc-index.generated.json", "generated-contract"],
    ["scripts/lib/local-integration-ci.mjs", "shared-setup"],
  ]) {
    it(`selects exhaustive evidence for ${code} risk`, () => {
      const plan = createEvidencePlan(input({
        changedFiles: [path],
        codeGraphAdvice: trustedGraph(),
      }));

      assert.equal(plan.fullSuite, true);
      assert.ok(escalationCodes(plan).includes(`risk:${code}`));
    });
  }

  for (const eventName of ["merge_group", "push", "workflow_dispatch", "schedule"]) {
    it(`keeps ${eventName} exhaustive`, () => {
      const plan = createEvidencePlan(input({
        eventName,
        changedFiles: ["apps/web/lib/orders.ts"],
        knownTests: ["apps/web/lib/orders.test.ts"],
        relatedTestsBySource: {
          "apps/web/lib/orders.ts": ["apps/web/lib/orders.test.ts"],
        },
        codeGraphAdvice: trustedGraph(),
      }));

      assert.equal(plan.fullSuite, true);
      assert.ok(escalationCodes(plan).includes("event-exhaustive"));
    });
  }

  it("marks an unmapped production file and expands to exhaustive evidence", () => {
    const plan = createEvidencePlan(input({
      changedFiles: ["apps/web/lib/unowned-behavior.ts"],
      codeGraphAdvice: trustedGraph(),
    }));

    assert.equal(plan.fullSuite, true);
    assert.ok(escalationCodes(plan).includes("unmapped-production"));
    assert.deepEqual(plan.fileDispositions, [{
      path: "apps/web/lib/unowned-behavior.ts",
      kind: "production",
      disposition: "unmapped",
      tests: [],
      routes: [],
    }]);
    assert.deepEqual(plan.observations.missingTestUpdates, [
      "apps/web/lib/unowned-behavior.ts",
    ]);
  });

  it("expands when the selected test percentage exceeds policy", () => {
    const selected = Array.from({ length: 71 }, (_, index) => `apps/web/lib/t${index}.test.ts`);
    const plan = createEvidencePlan(input({
      changedFiles: ["apps/web/lib/orders.ts"],
      knownTests: selected,
      relatedTestsBySource: {
        "apps/web/lib/orders.ts": selected,
      },
      codeGraphAdvice: trustedGraph(),
      totalTestCount: 100,
    }));

    assert.equal(plan.selection.selectedPercentage, 71);
    assert.equal(plan.fullSuite, true);
    assert.ok(escalationCodes(plan).includes("selection-threshold"));
  });

  it("selects a directly changed test without requiring graph advice", () => {
    const plan = createEvidencePlan(input({
      changedFiles: ["apps/web/lib/orders.test.ts"],
      knownTests: ["apps/web/lib/orders.test.ts"],
    }));

    assert.deepEqual(plan.affectedTests, ["apps/web/lib/orders.test.ts"]);
    assert.equal(plan.fullSuite, false);
    assert.deepEqual(plan.escalations, []);
  });

  it("derives Next route paths and route families from page ownership", () => {
    const plan = createEvidencePlan(input({
      changedFiles: ["apps/web/app/(shell)/ops/self-upgrade/page.tsx"],
      knownTests: ["apps/web/app/(shell)/ops/self-upgrade/page.test.tsx"],
      relatedTestsBySource: {
        "apps/web/app/(shell)/ops/self-upgrade/page.tsx": [
          "apps/web/app/(shell)/ops/self-upgrade/page.test.tsx",
        ],
      },
      codeGraphAdvice: trustedGraph(),
    }));

    assert.deepEqual(plan.affectedRoutes, ["/ops/self-upgrade"]);
    assert.deepEqual(plan.routeFamilies, ["/ops"]);
    assert.equal(plan.uxMode, "changed-routes");
  });

  it("expands affected packages through transitive workspace consumers", () => {
    const plan = createEvidencePlan(input({
      changedFiles: ["packages/types/src/order.ts"],
      knownTests: ["packages/types/src/order.test.ts"],
      relatedTestsBySource: {
        "packages/types/src/order.ts": ["packages/types/src/order.test.ts"],
      },
      packageDependencies: {
        "@dpf/types": [],
        "@dpf/api-client": ["@dpf/types"],
        "web": ["@dpf/api-client"],
        "mobile": ["@dpf/api-client"],
      },
      codeGraphAdvice: trustedGraph(),
    }));

    assert.deepEqual(plan.affectedPackages, [
      "@dpf/api-client",
      "@dpf/types",
      "mobile",
      "web",
    ]);
  });
});
