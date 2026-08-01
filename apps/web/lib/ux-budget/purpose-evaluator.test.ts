import { describe, expect, it } from "vitest";

import type {
  RatifiedPurposeContract,
  TaskValidationReceipt,
} from "./page-purpose";
import {
  evaluateRoutePurpose,
  routeMatchesPurposeTemplate,
  summarisePurposeCoverage,
  type PurposeDomEvidence,
  type PurposeEvaluationContext,
} from "./purpose-evaluator";

const contract: RatifiedPurposeContract = {
  schemaVersion: 1,
  status: "intent-ratified",
  routePath: "/ops/self-upgrade",
  derived: {
    audience: "admin",
    destinationKind: "advanced-diagnostic",
    shell: "detail",
    confidence: "high",
    sweepEligible: false,
    sweepExclusionReason: "wall-clock-collection",
  },
  intent: {
    primaryUser: "Platform operator",
    triggeringNeed: "An update needs attention.",
    prerequisites: [],
    job: "Understand the current update state and take the one safe next action.",
    successOutcome: "The intended version is healthy or a truthful recovery path is available.",
    findability: {
      parentArea: "Platform operations",
      entryPoints: ["Platform navigation"],
      navigationLayer: "section",
      discoveryCue: "Self-Upgrade",
      expectedPath: ["Platform", "Self-Upgrade"],
    },
    contentRoles: {
      defaultVisibleKeys: ["current-state", "impact-on-work", "next-action", "recovery-status"],
      deferredRegions: [
        {
          key: "deploy-controls-history",
          role: "Technical controls, history, and diagnostics",
          trigger: "Deploy controls & history",
        },
      ],
    },
    familyConsistency: {
      terminology: "Self-Upgrade",
      actionLocation: "Beside the release status",
      feedbackPrimitive: "Notice",
      disclosurePattern: "details",
      returnBehavior: "Remain in Platform operations",
    },
  },
  stateScenarios: {
    "update-available": {
      statePredicate: "A newer target is available.",
      stateSource: {
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      essentialEvidenceKeys: ["current-state", "impact-on-work", "next-action", "recovery-status"],
      primaryExperience: { kind: "command", actionKey: "start-upgrade" },
      prohibitedActionKeys: ["restore-previous-version"],
      completionSignalKey: "upgrade-queue-acknowledgement",
      completionSignal: "The update request is acknowledged.",
      correctionSignalKey: "upgrade-request-error",
      errorCorrection: "The trigger reports a recoverable error.",
      recovery: {
        actionKey: "open-recovery-guidance",
        routePath: "/docs/operations/self-upgrade",
      },
    },
  },
  taskProtocol: {
    startRoute: "/workspace",
    taskPrompt: "Bring the platform up to date.",
    completionOracle: "The requested version is healthy.",
    falseSuccessConditions: ["The update was only queued."],
    acceptanceThresholds: ["The primary action is visible without opening diagnostics."],
  },
  ratifiedBy: { role: "design-owner", ref: "BI-D27323A0" },
  reviewRef: "docs/superpowers/plans/2026-07-29-page-purpose-contract.md",
  intentEvidenceRefs: [
    {
      kind: "operator-request",
      ref: "BI-D27323A0",
      summary: "The operator requested a purpose-led Self-Upgrade flow.",
    },
  ],
  consequentialAction: {
    actionKey: "start-upgrade",
    noActionConsequence: "The update waits for the next governed window.",
    reversibility: "A recovery point is created first.",
    confirmation: "The action is explicit.",
    authority: "Only a platform operator may start it.",
    recovery: "Open the governed recovery guidance.",
  },
};

const evidence: PurposeDomEvidence = {
  routePath: "/ops/self-upgrade",
  stateKey: "update-available",
  h1Count: 1,
  purposeKeys: ["current-state", "impact-on-work", "next-action", "recovery-status"],
  actions: [
    {
      key: "start-upgrade",
      primary: true,
      visible: true,
      accessibleName: "Upgrade now",
      semanticRole: "button",
      enabled: true,
      focusable: true,
      unobstructed: true,
      geometry: { top: 420, bottom: 464, left: 32, right: 180 },
    },
    {
      key: "open-recovery-guidance",
      primary: false,
      visible: true,
      accessibleName: "Recovery guidance",
      semanticRole: "link",
      enabled: true,
      focusable: true,
      unobstructed: true,
      geometry: { top: 470, bottom: 514, left: 32, right: 260 },
      href: "/docs/operations/self-upgrade",
    },
  ],
  messages: [],
  prohibitedActionKeysPresent: [],
  completionSignalKeys: ["upgrade-queue-acknowledgement"],
  correctionSignalKeys: ["upgrade-request-error"],
  recoverySignal: {
    present: true,
    actionKey: "open-recovery-guidance",
    routePath: "/docs/operations/self-upgrade",
  },
  disclosures: [
    {
      key: "deploy-controls-history",
      triggerPresent: true,
      controlledRegionPresent: true,
      relationshipValid: true,
      expanded: false,
    },
  ],
  consequentialAction: {
    consequenceVisible: true,
    reversibilityVisible: true,
    confirmationAvailable: true,
    authorityVisible: true,
    recoveryVisible: true,
  },
  viewport: { width: 1280, height: 900 },
};

const context: PurposeEvaluationContext = {
  contractHash: "contract-hash",
  fixtureVersion: "self-upgrade-v1",
  interactionFingerprint: "interaction-v1",
  relevantDependencyFingerprint: "dependencies-v1",
  resolvedArtifactIds: new Set(["artifact-1"]),
};

function functionalReceipt(
  overrides: Partial<TaskValidationReceipt> = {},
): TaskValidationReceipt {
  return {
    schemaVersion: 1,
    evidenceClass: "automated-functional",
    routePath: "/ops/self-upgrade",
    contractHash: "contract-hash",
    sourceSha: "provenance-sha",
    fixtureVersion: "self-upgrade-v1",
    viewport: "1280x900",
    inputMode: "pointer",
    interactionFingerprint: "interaction-v1",
    relevantDependencyFingerprint: "dependencies-v1",
    metrics: {
      "state.update-available.completionSignalKey":
        "upgrade-queue-acknowledgement",
      "state.update-available.completionObserved": true,
      "state.update-available.correctionSignalKey": "upgrade-request-error",
      "state.update-available.correctionObserved": true,
    },
    thresholds: { completion: true },
    reviewerRef: "VR-BI-D27323A0",
    observedAt: "2026-07-30T00:00:00.000Z",
    artifactIds: ["artifact-1"],
    runnerRef: "playwright",
    completionOracleResult: "passed",
    ...overrides,
  } as TaskValidationReceipt;
}

describe("evaluateRoutePurpose", () => {
  it("keeps intent, structural conformance, and task validation independent", () => {
    const result = evaluateRoutePurpose({
      contract,
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: "update-available",
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      evidence,
      context,
    });

    expect(result.intentStatus).toBe("intent-ratified");
    expect(result.structuralStatus).toBe("conformant");
    expect(result.validation.overall).toBe("not-validated");
    expect(result.findings).toEqual([]);
    expect(result.blocking).toBe(false);
  });

  it("rejects an oracle whose identity does not match the state contract", () => {
    const result = evaluateRoutePurpose({
      contract,
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: "update-available",
        oracleKey: "route-owned-read-model",
        sourceRef: "wrong-source",
      },
      evidence,
      context,
    });

    expect(result.structuralStatus).toBe("nonconformant");
    expect(result.findings.map((finding) => finding.checkId)).toContain(
      "state-oracle",
    );
  });

  const structuralDefects: Array<{
    checkId: string;
    mutate: (candidate: PurposeDomEvidence) => void;
  }> = [
    {
      checkId: "route-marker",
      mutate: (candidate) => {
        candidate.routePath = "/wrong";
      },
    },
    {
      checkId: "state-oracle",
      mutate: (candidate) => {
        candidate.stateKey = "current";
      },
    },
    {
      checkId: "single-h1",
      mutate: (candidate) => {
        candidate.h1Count = 2;
      },
    },
    {
      checkId: "essential-evidence",
      mutate: (candidate) => {
        candidate.purposeKeys = candidate.purposeKeys.filter((key) => key !== "impact-on-work");
      },
    },
    {
      checkId: "primary-experience",
      mutate: (candidate) => {
        candidate.actions = candidate.actions.filter((action) => action.key !== "start-upgrade");
      },
    },
    {
      checkId: "first-viewport-action",
      mutate: (candidate) => {
        candidate.actions[0].geometry.top = 940;
        candidate.actions[0].geometry.bottom = 984;
      },
    },
    {
      checkId: "prohibited-action",
      mutate: (candidate) => {
        candidate.prohibitedActionKeysPresent = ["restore-previous-version"];
      },
    },
    {
      checkId: "completion-signal",
      mutate: (candidate) => {
        candidate.completionSignalKeys = ["wrong-completion"];
      },
    },
    {
      checkId: "correction-signal",
      mutate: (candidate) => {
        candidate.correctionSignalKeys = ["wrong-correction"];
      },
    },
    {
      checkId: "recovery-signal",
      mutate: (candidate) => {
        candidate.recoverySignal.present = false;
      },
    },
    {
      checkId: "disclosure-contract",
      mutate: (candidate) => {
        candidate.disclosures[0].relationshipValid = false;
      },
    },
    {
      checkId: "consequential-action",
      mutate: (candidate) => {
        candidate.consequentialAction!.authorityVisible = false;
      },
    },
  ];

  for (const defect of structuralDefects) {
    it(`detects the known-bad ${defect.checkId} fixture`, () => {
      const candidate = structuredClone(evidence);
      defect.mutate(candidate);

      const result = evaluateRoutePurpose({
        contract,
        oracle: {
          routePath: "/ops/self-upgrade",
          stateKey: "update-available",
          oracleKey: "self-upgrade-status",
          sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
        },
        evidence: candidate,
        context,
      });

      const outcomeCheck =
        defect.checkId === "completion-signal" ||
        defect.checkId === "correction-signal";
      expect(result.structuralStatus).toBe(
        outcomeCheck ? "conformant" : "nonconformant",
      );
      expect(result.findings.map((finding) => finding.checkId)).toContain(defect.checkId);
      if (outcomeCheck) {
        expect(
          result.findings.find((finding) => finding.checkId === defect.checkId)
            ?.severity,
        ).toBe("advisory");
      }
      expect(result.blocking).toBe(false);
    });
  }

  it.each([
    ["accessible name", { accessibleName: "" }],
    ["semantic role", { semanticRole: null }],
    ["enabled state", { enabled: false }],
    ["focusability", { focusable: false }],
    ["obstruction", { unobstructed: false }],
  ])("rejects a primary marker without valid %s evidence", (_name, defect) => {
    const candidate = structuredClone(evidence);
    Object.assign(candidate.actions[0], defect);

    const result = evaluateRoutePurpose({
      contract,
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: "update-available",
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      evidence: candidate,
      context,
    });

    expect(result.structuralStatus).toBe("nonconformant");
    expect(result.findings.map((finding) => finding.checkId)).toContain(
      "primary-experience",
    );
  });

  it("enforces consequence evidence for a contract-declared non-pilot action", () => {
    const genericContract = structuredClone(contract);
    genericContract.stateScenarios["update-available"].primaryExperience = {
      kind: "command",
      actionKey: "execute-change",
    };
    genericContract.consequentialAction = {
      ...genericContract.consequentialAction!,
      actionKey: "execute-change",
    };
    const candidate = structuredClone(evidence);
    candidate.actions[0].key = "execute-change";
    candidate.consequentialAction!.confirmationAvailable = false;

    const result = evaluateRoutePurpose({
      contract: genericContract,
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: "update-available",
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      evidence: candidate,
      context,
    });

    expect(result.structuralStatus).toBe("nonconformant");
    expect(result.findings.map((finding) => finding.checkId)).toContain(
      "consequential-action",
    );
  });

  it("keeps a superficial functional receipt stale when it omits state outcomes", () => {
    const result = evaluateRoutePurpose({
      contract: {
        ...contract,
        validationReceipts: [
          functionalReceipt({ metrics: { completion: true } }),
        ],
      },
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: "update-available",
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      evidence,
      context,
    });

    expect(result.validation.overall).toBe("stale");
    expect(result.validation.receipts[0].reasons).toEqual(
      expect.arrayContaining([
        "Completion outcome was not proven for state update-available.",
        "Correction outcome was not proven for state update-available.",
      ]),
    );
  });

  it("marks a matching, resolvable functional receipt current without requiring source SHA equality", () => {
    const result = evaluateRoutePurpose({
      contract: {
        ...contract,
        validationReceipts: [
          {
            schemaVersion: 1,
            evidenceClass: "automated-functional",
            routePath: "/ops/self-upgrade",
            contractHash: "contract-hash",
            sourceSha: "older-provenance-sha",
            fixtureVersion: "self-upgrade-v1",
            viewport: "1280x900",
            inputMode: "pointer",
            interactionFingerprint: "interaction-v1",
            relevantDependencyFingerprint: "dependencies-v1",
            metrics: {
              "state.update-available.completionSignalKey":
                "upgrade-queue-acknowledgement",
              "state.update-available.completionObserved": true,
              "state.update-available.correctionSignalKey":
                "upgrade-request-error",
              "state.update-available.correctionObserved": true,
            },
            thresholds: { completion: true },
            reviewerRef: "VR-BI-D27323A0",
            observedAt: "2026-07-30T00:00:00.000Z",
            artifactIds: ["artifact-1"],
            runnerRef: "playwright",
            completionOracleResult: "passed",
          },
        ],
      },
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: "update-available",
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      evidence,
      context,
    });

    expect(result.validation.overall).toBe("current");
    expect(result.validation.classes["automated-functional"]).toBe("current");
  });

  it("marks an unresolved or materially changed receipt stale", () => {
    const result = evaluateRoutePurpose({
      contract: {
        ...contract,
        validationReceipts: [
          {
            schemaVersion: 1,
            evidenceClass: "automated-functional",
            routePath: "/ops/self-upgrade",
            contractHash: "old-contract",
            sourceSha: "older-sha",
            fixtureVersion: "self-upgrade-v1",
            viewport: "1280x900",
            inputMode: "pointer",
            interactionFingerprint: "old-interaction",
            relevantDependencyFingerprint: "dependencies-v1",
            metrics: { completion: true },
            thresholds: { completion: true },
            reviewerRef: "VR-OLD",
            observedAt: "2026-07-30T00:00:00.000Z",
            artifactIds: ["missing-artifact"],
            runnerRef: "playwright",
            completionOracleResult: "passed",
          },
        ],
      },
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: "update-available",
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      evidence,
      context,
    });

    expect(result.validation.overall).toBe("stale");
  });

  it("uses the latest receipt per evidence class so a later pass supersedes a failure", () => {
    const result = evaluateRoutePurpose({
      contract: {
        ...contract,
        validationReceipts: [
          functionalReceipt({
            reviewerRef: "VR-FAILED",
            observedAt: "2026-07-29T00:00:00.000Z",
            completionOracleResult: "failed",
          }),
          functionalReceipt({
            reviewerRef: "VR-PASSED",
            observedAt: "2026-07-30T00:00:00.000Z",
          }),
        ],
      },
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: "update-available",
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      evidence,
      context,
    });

    expect(result.validation.overall).toBe("current");
    expect(result.validation.receipts).toHaveLength(1);
    expect(result.validation.receipts[0].reviewerRef).toBe("VR-PASSED");
  });

  it("orders valid receipt timestamps by instant, not fractional string shape", () => {
    const result = evaluateRoutePurpose({
      contract: {
        ...contract,
        validationReceipts: [
          functionalReceipt({
            reviewerRef: "VR-LATER",
            observedAt: "2026-07-30T00:00:00.12Z",
          }),
          functionalReceipt({
            reviewerRef: "VR-EARLIER",
            observedAt: "2026-07-30T00:00:00.099Z",
            completionOracleResult: "failed",
          }),
        ],
      },
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: "update-available",
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      evidence,
      context,
    });

    expect(result.validation.overall).toBe("current");
    expect(result.validation.receipts[0].reviewerRef).toBe("VR-LATER");
  });

  it("does not let another current class mask a newer stale class", () => {
    const result = evaluateRoutePurpose({
      contract: {
        ...contract,
        validationReceipts: [
          functionalReceipt(),
          {
            schemaVersion: 1,
            evidenceClass: "representative-user",
            routePath: "/ops/self-upgrade",
            contractHash: "old-contract",
            sourceSha: "provenance-sha",
            fixtureVersion: "self-upgrade-v1",
            viewport: "390x844",
            inputMode: "touch",
            interactionFingerprint: "interaction-v1",
            relevantDependencyFingerprint: "dependencies-v1",
            metrics: { completion: true },
            thresholds: { completion: true },
            reviewerRef: "UR-STALE",
            observedAt: "2026-07-30T01:00:00.000Z",
            artifactIds: ["artifact-1"],
            participantCohort: {
              cohortId: "platform-operators",
              recruitmentCriteria: ["Administers a DPF install"],
              relevantExperience: "Maintains platform updates",
              participantCount: 1,
            },
            participantAttestationRef: "attestation-1",
          },
        ],
      },
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: "update-available",
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      evidence,
      context,
    });

    expect(result.validation.overall).toBe("stale");
  });
});

describe("summarisePurposeCoverage", () => {
  it("reports contract and structural coverage without collapsing the statuses", () => {
    const evaluated = evaluateRoutePurpose({
      contract,
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: "update-available",
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      evidence,
      context,
    });

    expect(
      summarisePurposeCoverage([
        evaluated,
        {
          routePath: "/workspace",
          intentStatus: "draft",
          structuralStatus: "not-evaluated",
          validation: {
            overall: "not-validated",
            classes: {},
            receipts: [],
          },
          enforcement: "advisory",
          findings: [],
          blocking: false,
        },
      ]),
    ).toMatchObject({
      routeCount: 2,
      intentRatifiedCount: 1,
      draftCount: 1,
      structurallyConformantCount: 1,
      taskValidatedCount: 0,
    });
  });
});

describe("routeMatchesPurposeTemplate", () => {
  it("matches a concrete docs route to the canonical optional catch-all", () => {
    expect(
      routeMatchesPurposeTemplate(
        "/docs/[[...slug]]",
        "/docs/operations/self-upgrade",
      ),
    ).toBe(true);
  });

  it("does not match a different canonical family", () => {
    expect(
      routeMatchesPurposeTemplate(
        "/docs/[[...slug]]",
        "/ops/self-upgrade",
      ),
    ).toBe(false);
  });
});
