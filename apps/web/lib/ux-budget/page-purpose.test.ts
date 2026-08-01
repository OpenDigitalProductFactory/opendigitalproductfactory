import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import routeManifest from "../ea/route-manifest.json";
import { buildRoutePolicies } from "./route-policy";
import {
  parsePagePurposeContract,
  parsePagePurposeRegistry,
  type PagePurposeRegistry,
  type PurposeContractSource,
  type RatifiedPurposeContract,
} from "./page-purpose";
import {
  buildPagePurposeRegistry,
  composeRatifiedPurposeContract,
  createBootstrapBaseline,
  resolvePurposeBaseState,
  validatePurposeBaselineTransition,
  validatePurposeIdentityRatchet,
  validatePurposeRouteReferences,
  validatePurposeStatusTransition,
} from "../../scripts/build-page-purpose";
import {
  buildPurposeContractSourceIndex,
  PURPOSE_CONTRACT_SOURCES,
} from "./purpose-contracts";

const draftFixture = {
  schemaVersion: 1,
  status: "draft",
  routePath: "/workspace",
  derived: {
    audience: "owner",
    destinationKind: "section-home",
    shell: "cockpit",
    confidence: "high",
    sweepEligible: true,
  },
} as const;

const validationReceiptBase = {
  schemaVersion: 1 as const,
  routePath: "/workspace",
  contractHash: "contract-hash",
  sourceSha: "source-sha",
  fixtureVersion: "fixture-1",
  viewport: "1440x900",
  inputMode: "pointer" as const,
  interactionFingerprint: "interaction-1",
  relevantDependencyFingerprint: "dependencies-1",
  metrics: {},
  thresholds: {},
  reviewerRef: "reviewer",
  observedAt: "2026-07-29T00:00:00.000Z",
  artifactIds: ["artifact-1"],
};

const ratifiedFixture: RatifiedPurposeContract = {
  schemaVersion: 1,
  status: "intent-ratified",
  routePath: "/workspace",
  derived: draftFixture.derived,
  intent: {
    primaryUser: "Business owner",
    triggeringNeed: "Understand today's work",
    prerequisites: [],
    job: "Find the next important task",
    successOutcome: "The owner starts the correct task",
    findability: {
      parentArea: "Workspace",
      entryPoints: ["Primary navigation"],
      navigationLayer: "global",
      discoveryCue: "Workspace",
      expectedPath: ["Workspace"],
    },
    contentRoles: {
      defaultVisibleKeys: ["next-task"],
      deferredRegions: [],
    },
    familyConsistency: {
      terminology: "Workspace",
      actionLocation: "lead",
      feedbackPrimitive: "inline-status",
      disclosurePattern: "details",
      returnBehavior: "return-to-workspace",
    },
  },
  stateScenarios: {
    ready: {
      statePredicate: "work is available",
      stateSource: {
        oracleKey: "fixture-read-model",
        sourceRef: "workspace-fixture",
      },
      essentialEvidenceKeys: ["next-task"],
      primaryExperience: {
        kind: "command",
        actionKey: "start-task",
      },
      prohibitedActionKeys: [],
      completionSignal: "task-started",
      errorCorrection: "Show the owning error",
      recovery: {
        actionKey: "return-to-workspace",
        routePath: "/workspace",
      },
    },
  },
  taskProtocol: {
    startRoute: "/workspace",
    taskPrompt: "Start the next important task.",
    completionOracle: "task-started",
    falseSuccessConditions: ["Opened the wrong task"],
    acceptanceThresholds: ["Correct task starts"],
  },
  ratifiedBy: { role: "owner", ref: "operator" },
  reviewRef: "review-1",
  intentEvidenceRefs: [
    {
      kind: "operator-request",
      ref: "request-1",
      summary: "Workspace should lead to the next task.",
    },
  ],
  validationReceipts: [
    {
      ...validationReceiptBase,
      evidenceClass: "automated-functional",
      runnerRef: "playwright",
      completionOracleResult: "passed",
    },
    {
      ...validationReceiptBase,
      evidenceClass: "expert-evaluation",
      evaluatorProfile: "Senior product designer",
      methodRef: "purpose-contract-review-v1",
    },
    {
      ...validationReceiptBase,
      evidenceClass: "representative-user",
      participantCohort: {
        cohortId: "owner-cohort-1",
        recruitmentCriteria: ["Runs a small business"],
        relevantExperience: "Weekly platform operator",
        participantCount: 5,
      },
      participantAttestationRef: "attestation-1",
    },
    {
      ...validationReceiptBase,
      evidenceClass: "benchmark",
      sampleSize: 10,
      taskProtocolVersion: "workspace-task-v1",
      baselineRoundRef: "baseline-1",
      completionRate: 0.9,
      timingDistribution: {
        medianMs: 2_000,
        p90Ms: 4_000,
      },
      easeAndConfidence: {
        easeMean: 4.2,
        confidenceMean: 4.4,
      },
      repeatabilityThreshold: "At least 80% across two rounds",
      comparisonResult: "improved",
    },
  ],
};

const {
  derived: _derivedPurposePolicy,
  ...ratifiedSourceFixture
} = ratifiedFixture;

function withProductionPurposeContracts(
  sources: Readonly<Record<string, PurposeContractSource>>,
): Readonly<Record<string, PurposeContractSource>> {
  return {
    ...PURPOSE_CONTRACT_SOURCES,
    ...sources,
  };
}

const quarantinedSourceFixture = {
  schemaVersion: 1,
  status: "intent-quarantined",
  routePath: "/workspace",
  quarantine: {
    reason: "Initial intent needs correction before enforcement.",
    incidentRef: "BI-QUARANTINE-TEST",
    reviewRef: "review-quarantine-1",
    approvedBy: {
      role: "design-owner",
      ref: "design-reviewer",
    },
  },
} as const;

describe("Page Purpose Contract runtime schema", () => {
  it("accepts a generated draft without pretending its intent was reviewed", () => {
    expect(parsePagePurposeContract(draftFixture)).toEqual(draftFixture);
  });

  it("rejects draft records that smuggle in ratified intent", () => {
    expect(() =>
      parsePagePurposeContract({
        ...draftFixture,
        intent: { job: "Pretend this was approved" },
      }),
    ).toThrow();
  });

  it("requires non-empty typed intent evidence on ratified records", () => {
    expect(() =>
      parsePagePurposeContract({
        schemaVersion: 1,
        status: "intent-ratified",
        routePath: "/workspace",
        derived: draftFixture.derived,
        intent: {},
        stateScenarios: {},
        taskProtocol: {},
        ratifiedBy: { role: "owner", ref: "operator" },
        reviewRef: "review-1",
        intentEvidenceRefs: [],
      }),
    ).toThrow();
  });

  it("accepts a complete ratified contract with every evidence class", () => {
    expect(parsePagePurposeContract(ratifiedFixture)).toEqual(ratifiedFixture);
  });

  it.each([
    {
      evidenceClass: "automated-functional",
      receipt: {
        ...validationReceiptBase,
        evidenceClass: "automated-functional",
      },
    },
    {
      evidenceClass: "expert-evaluation",
      receipt: {
        ...validationReceiptBase,
        evidenceClass: "expert-evaluation",
      },
    },
    {
      evidenceClass: "representative-user",
      receipt: {
        ...validationReceiptBase,
        evidenceClass: "representative-user",
      },
    },
    {
      evidenceClass: "benchmark",
      receipt: {
        ...validationReceiptBase,
        evidenceClass: "benchmark",
      },
    },
  ])(
    "rejects $evidenceClass evidence without class-specific proof",
    ({ receipt }) => {
      expect(() =>
        parsePagePurposeContract({
          ...ratifiedFixture,
          validationReceipts: [receipt],
        }),
      ).toThrow();
    },
  );

  it("rejects the removed duplicate state identity", () => {
    expect(() =>
      parsePagePurposeContract({
        ...ratifiedFixture,
        stateScenarios: {
          ready: {
            ...ratifiedFixture.stateScenarios.ready,
            renderedStateKey: "different-identity",
          },
        },
      }),
    ).toThrow();
  });

  it("rejects scenario identities that would collide after trimming", () => {
    expect(() =>
      parsePagePurposeContract({
        ...ratifiedFixture,
        stateScenarios: {
          ready: ratifiedFixture.stateScenarios.ready,
          " ready ": ratifiedFixture.stateScenarios.ready,
        },
      }),
    ).toThrow(/leading or trailing whitespace/);
  });

  it("reconciles summary counts with actual route statuses", () => {
    expect(() =>
      parsePagePurposeRegistry({
        schemaVersion: 1,
        generator: "apps/web/scripts/build-page-purpose.ts",
        pageRouteCount: 1,
        draftCount: 0,
        ratifiedCount: 1,
        quarantinedCount: 0,
        routes: [draftFixture],
      }),
    ).toThrow(/draftCount/);
  });

  it("rejects duplicate contracts across route-family modules", () => {
    expect(() =>
      buildPurposeContractSourceIndex([
        [ratifiedSourceFixture],
        [ratifiedSourceFixture],
      ]),
    ).toThrow(/Duplicate contract source/);
  });

  it("composes author-owned intent with canonical derived route policy", () => {
    const policy = buildRoutePolicies(routeManifest.routes).find(
      (candidate) => candidate.routePath === "/workspace",
    );
    if (!policy) throw new Error("Workspace policy is missing.");
    const contract = composeRatifiedPurposeContract(
      ratifiedSourceFixture,
      policy,
    );
    expect(contract.derived).toEqual({
      audience: policy.audience,
      destinationKind: policy.destinationKind,
      shell: policy.shell,
      confidence: policy.confidence,
      sweepEligible: policy.sweepEligible,
      ...(policy.sweepExclusionReason
        ? { sweepExclusionReason: policy.sweepExclusionReason }
        : {}),
    });
    expect(ratifiedSourceFixture).not.toHaveProperty("derived");
  });

  it("rejects task and recovery routes absent from the canonical manifest", () => {
    const invalid = {
      ...ratifiedFixture,
      taskProtocol: {
        ...ratifiedFixture.taskProtocol,
        startRoute: "/missing",
      },
      stateScenarios: {
        ready: {
          ...ratifiedFixture.stateScenarios.ready,
          recovery: {
            ...ratifiedFixture.stateScenarios.ready.recovery,
            routePath: "/also-missing",
          },
        },
      },
    };
    const parsed = parsePagePurposeContract(invalid);
    if (parsed.status !== "intent-ratified") {
      throw new Error("Expected a ratified fixture.");
    }
    expect(
      validatePurposeRouteReferences(
        parsed,
        new Set(["/workspace"]),
      ),
    ).toContain(
      "Ratified contract /workspace references noncanonical route /missing.",
    );
    expect(
      validatePurposeRouteReferences(parsed, new Set(["/workspace"])),
    ).toContain(
      "Ratified contract /workspace references noncanonical route /also-missing.",
    );
  });
});

describe("deterministic Page Purpose registry", () => {
  const registry = buildPagePurposeRegistry();
  const committed = JSON.parse(
    readFileSync(resolve(__dirname, "route-purpose.generated.json"), "utf8"),
  ) as PagePurposeRegistry;
  const baseline = JSON.parse(
    readFileSync(resolve(__dirname, "route-purpose-baseline.json"), "utf8"),
  ) as {
    schemaVersion: 1;
    legacyDraftRoutePaths: string[];
  };

  it("derives one policy from every canonical non-redirect page route", () => {
    const expected = routeManifest.routes.filter(
      (route) => route.kind === "page" && !route.redirectTo,
    );
    expect(buildRoutePolicies(routeManifest.routes)).toHaveLength(expected.length);
    expect(registry.routes.map((route) => route.routePath)).toEqual(
      expected.map((route) => route.routePath),
    );
  });

  it("matches the committed byte-stable generated registry", () => {
    expect(parsePagePurposeRegistry(committed)).toEqual(registry);
    expect(`${JSON.stringify(registry, null, 2)}\n`).toBe(
      readFileSync(resolve(__dirname, "route-purpose.generated.json"), "utf8"),
    );
  });

  it("keeps the exact legacy-draft exception identities from regressing", () => {
    expect(validatePurposeIdentityRatchet(registry, baseline)).toEqual([]);
  });

  it("blocks a new route from arriving as an unreviewed draft", () => {
    const withNewDraft: PagePurposeRegistry = {
      ...registry,
      pageRouteCount: registry.pageRouteCount + 1,
      draftCount: registry.draftCount + 1,
      routes: [
        ...registry.routes,
        {
          ...draftFixture,
          routePath: "/new-unreviewed-route",
        },
      ],
    };
    expect(validatePurposeIdentityRatchet(withNewDraft, baseline)).toContain(
      "Non-ratified route /new-unreviewed-route is not grandfathered; add a ratified contract.",
    );
  });

  it("blocks a PR from grandfathering its own new draft route", () => {
    const candidateBaseline = {
      ...baseline,
      legacyDraftRoutePaths: [
        ...baseline.legacyDraftRoutePaths,
        "/new-unreviewed-route",
      ],
    };
    expect(
      validatePurposeBaselineTransition(
        candidateBaseline,
        baseline,
      ),
    ).toContain(
      "Purpose baseline cannot grandfather new draft route /new-unreviewed-route.",
    );
  });

  it("derives first-use grandfathering only from the base route manifest", () => {
    const baseState = resolvePurposeBaseState(
      undefined,
      undefined,
      routeManifest.routes,
    );
    const baseBaseline = baseState.baseline;
    const candidateBaseline = {
      ...baseBaseline,
      legacyDraftRoutePaths: [
        ...baseBaseline.legacyDraftRoutePaths,
        "/new-unreviewed-route",
      ],
    };
    expect(
      validatePurposeBaselineTransition(
        candidateBaseline,
        baseBaseline,
      ),
    ).toContain(
      "Purpose baseline cannot grandfather new draft route /new-unreviewed-route.",
    );
  });

  it("fails closed when neither base baseline nor base manifest is readable", () => {
    expect(() =>
      resolvePurposeBaseState(undefined, undefined, undefined),
    ).toThrow(/base route manifest could not be read/);
  });

  it("fails closed when established base artifacts are incomplete", () => {
    expect(() =>
      resolvePurposeBaseState(baseline, undefined, routeManifest.routes),
    ).toThrow(/must either both exist or both be absent/);
    expect(() =>
      resolvePurposeBaseState(undefined, registry, routeManifest.routes),
    ).toThrow(/must either both exist or both be absent/);
  });

  it("blocks a reviewed route from reverting to an unreviewed draft", () => {
    const base = buildPagePurposeRegistry(routeManifest.routes, {
      "/workspace": ratifiedSourceFixture,
    });
    expect(validatePurposeStatusTransition(registry, base)).toContain(
      "Reviewed route /workspace reverted to an unreviewed draft.",
    );
  });

  it("allows an explicitly reviewed quarantine instead of silent regression", () => {
    const base = buildPagePurposeRegistry(
      routeManifest.routes,
      withProductionPurposeContracts({
        "/workspace": ratifiedSourceFixture,
      }),
    );
    const quarantined = buildPagePurposeRegistry(
      routeManifest.routes,
      withProductionPurposeContracts({
        "/workspace": quarantinedSourceFixture,
      }),
    );
    const baselineWithoutWorkspace = {
      ...baseline,
      legacyDraftRoutePaths: baseline.legacyDraftRoutePaths.filter(
        (routePath) => routePath !== "/workspace",
      ),
    };
    expect([
      ...validatePurposeIdentityRatchet(
        quarantined,
        baselineWithoutWorkspace,
      ),
      ...validatePurposeStatusTransition(quarantined, base),
    ]).toEqual([]);
    expect(quarantined.quarantinedCount).toBe(1);
    expect(
      quarantined.routes.find(
        (route) => route.routePath === "/workspace",
      )?.status,
    ).toBe("intent-quarantined");
  });

  it("rejects quarantine when the base route was never reviewed", () => {
    const quarantined = buildPagePurposeRegistry(routeManifest.routes, {
      "/workspace": quarantinedSourceFixture,
    });
    expect(
      validatePurposeStatusTransition(quarantined, registry),
    ).toContain(
      "Quarantined route /workspace was not reviewed in the base registry.",
    );
  });

  it("allows a net-new reviewed route to enter quarantine without a legacy exception", () => {
    const workspaceRow = routeManifest.routes.find(
      (route) => route.routePath === "/workspace",
    );
    if (!workspaceRow) throw new Error("Workspace manifest row is missing.");
    const routePath = "/new-reviewed-route";
    const manifest = [
      ...routeManifest.routes,
      {
        ...workspaceRow,
        routePath,
        segments: ["new-reviewed-route"],
        file: "apps/web/app/(shell)/new-reviewed-route/page.tsx",
      },
    ];
    const ratifiedSource = {
      ...ratifiedSourceFixture,
      routePath,
    };
    const quarantineSource = {
      ...quarantinedSourceFixture,
      routePath,
    };
    const base = buildPagePurposeRegistry(
      manifest,
      withProductionPurposeContracts({
        [routePath]: ratifiedSource,
      }),
    );
    const quarantined = buildPagePurposeRegistry(
      manifest,
      withProductionPurposeContracts({
        [routePath]: quarantineSource,
      }),
    );
    expect([
      ...validatePurposeIdentityRatchet(quarantined, baseline),
      ...validatePurposeStatusTransition(quarantined, base),
    ]).toEqual([]);
  });

  it("rejects a brand-new route that tries to enter as quarantined", () => {
    const workspaceRow = routeManifest.routes.find(
      (route) => route.routePath === "/workspace",
    );
    if (!workspaceRow) throw new Error("Workspace manifest row is missing.");
    const routePath = "/new-quarantined-route";
    const manifest = [
      ...routeManifest.routes,
      {
        ...workspaceRow,
        routePath,
        segments: ["new-quarantined-route"],
        file: "apps/web/app/(shell)/new-quarantined-route/page.tsx",
      },
    ];
    const quarantined = buildPagePurposeRegistry(manifest, {
      [routePath]: {
        ...quarantinedSourceFixture,
        routePath,
      },
    });
    expect(
      validatePurposeStatusTransition(quarantined, registry),
    ).toContain(
      `Quarantined route ${routePath} was not reviewed in the base registry.`,
    );
  });

  it("bootstraps only draft identities from a mixed-status registry", () => {
    const mixed = buildPagePurposeRegistry(routeManifest.routes, {
      "/workspace": ratifiedSourceFixture,
    });
    const bootstrap = createBootstrapBaseline(mixed);
    expect(bootstrap.legacyDraftRoutePaths).not.toContain("/workspace");
    expect(bootstrap.legacyDraftRoutePaths).toHaveLength(
      mixed.pageRouteCount - 1,
    );
  });

  it("rejects reviewed identities left in the draft-exception baseline", () => {
    const mixed = buildPagePurposeRegistry(routeManifest.routes, {
      "/workspace": ratifiedSourceFixture,
    });
    expect(validatePurposeIdentityRatchet(mixed, baseline)).toContain(
      "Reviewed route /workspace remains in the draft-exception baseline.",
    );
  });
});
