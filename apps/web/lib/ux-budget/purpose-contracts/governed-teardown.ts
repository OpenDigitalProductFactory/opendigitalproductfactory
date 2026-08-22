// Ratified page-purpose contract for /ops/teardown (BI-2E9887D2).

import type { PurposeContractModule } from ".";

export const GOVERNED_TEARDOWN_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/ops/teardown",
    intent: {
      primaryUser:
        "The HR-000 platform owner replacing, resetting, or retiring a DPF installation.",
      triggeringNeed:
        "The installation can be created and upgraded through the platform, but teardown otherwise requires risky hand-run Docker, filesystem, and database commands.",
      prerequisites: [
        "Signed in with the manage_platform capability.",
        "The installation is running from a supported Docker Compose project with an external evidence directory.",
      ],
      job: "Choose an explicit teardown boundary, review the platform's salvage and recovery gates, then authorize only the selected boundary with a human press-and-hold gesture.",
      successOutcome:
        "The selected install-owned resources are stopped or removed while recoverable Git work, a restore-tested database backup, and terminal evidence survive outside every deletion root.",
      findability: {
        parentArea: "Operations",
        entryPoints: ["/ops", "Operations > Runtime & Releases > Teardown"],
        navigationLayer: "Ops secondary nav, Runtime & Releases group",
        discoveryCue:
          "A Teardown tab beside Self-upgrade, keeping installation lifecycle controls in one governed family.",
        expectedPath: ["/ops", "/ops/teardown"],
      },
      contentRoles: {
        defaultVisibleKeys: [
          "teardown-scope-selector",
          "selected-boundary-map",
          "safety-sequence",
          "external-evidence-history",
        ],
        deferredRegions: [
          {
            key: "safety-gate-preview",
            role: "A preflight report covering local Git risk, deletion roots, and the external evidence destination.",
            trigger: "Rendered after the operator asks to review safety gates.",
          },
          {
            key: "destructive-hold-control",
            role: "A pointer-duration challenge that cannot be satisfied by typing a confirmation phrase.",
            trigger: "Enabled only after every hard safety gate passes for a destructive scope.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Use installation lifecycle, recovery, evidence, scope, and boundary language shared with Self-upgrade; name removed and retained resources explicitly.",
        actionLocation:
          "Scope selection and the primary safety-gate action stay together in the selected-outcome panel; terminal evidence remains in the page history.",
        feedbackPrimitive:
          "Inline gate rows, durable status evidence, and explicit retained/removed labels communicate progress and failure; destructive authorization is never a text input.",
        disclosurePattern:
          "Consequences and recovery guarantees are visible before preflight; detailed gates and the hold control appear progressively after review.",
        returnBehavior:
          "A containers-only stop can return to the same page after restart; destructive runs return through surviving external evidence or a fresh installation flow.",
      },
    },
    stateScenarios: {
      "boundary-selection": {
        statePredicate:
          "The authorized operator has opened the page but has not requested a safety preview.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/teardown/contract.ts#TEARDOWN_SCOPES",
        },
        essentialEvidenceKeys: [
          "four-explicit-scopes",
          "removed-resource-map",
          "recovery-always-retained",
        ],
        primaryExperience: {
          kind: "informational",
          messageKey: "governed-teardown.boundary-selection",
        },
        prohibitedActionKeys: ["typed-confirmation", "unscoped-compose-down"],
        completionSignal:
          "Exactly one scope is selected and every affected resource is labelled Stopped, Removed, Retained, or Always retained.",
        errorCorrection:
          "The operator changes scope without mutating the installation; the consequence map updates immediately.",
        recovery: {
          actionKey: "return-to-backlog",
          routePath: "/ops",
        },
      },
      "preflight-blocked": {
        statePredicate:
          "Salvage risk, deletion-root validation, recovery configuration, or promoter availability fails closed.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/actions/teardown.ts#previewInstallationTeardown",
        },
        essentialEvidenceKeys: [
          "failed-gate-name",
          "corrective-guidance",
          "mutation-not-started",
        ],
        primaryExperience: {
          kind: "informational",
          messageKey: "governed-teardown.preflight-blocked",
        },
        prohibitedActionKeys: ["force-teardown", "bypass-salvage"],
        completionSignal:
          "The blocking condition is named and destructive authorization remains unavailable.",
        errorCorrection:
          "The operator resolves the reported host or recovery condition, then requests a new short-lived preview.",
        recovery: {
          actionKey: "review-safety-gates",
          routePath: "/ops/teardown",
        },
      },
      "external-evidence-available": {
        statePredicate:
          "A governed teardown runner has written planned, failed, or completed evidence outside the database and source deletion roots.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/actions/teardown.ts#listInstallationTeardownEvidence",
        },
        essentialEvidenceKeys: [
          "run-id",
          "scope",
          "terminal-status",
          "recovery-receipt",
        ],
        primaryExperience: {
          kind: "informational",
          messageKey: "governed-teardown.external-evidence-available",
        },
        prohibitedActionKeys: ["evidence-inside-source", "database-only-receipt"],
        completionSignal:
          "The surviving journal identifies the selected scope, exact recovery point, salvage result, and terminal host-runner outcome.",
        errorCorrection:
          "A failed journal preserves its last successful stage and corrective detail so recovery does not depend on the deleted database.",
        recovery: {
          actionKey: "review-teardown-evidence",
          routePath: "/ops/teardown",
        },
      },
    },
    taskProtocol: {
      startRoute: "/ops/teardown",
      taskPrompt:
        "Reset this installation for fresh onboarding without deleting source, and identify what recovery evidence will remain.",
      completionOracle:
        "Reset data is selected, data volumes are marked Removed, source is marked Retained, and the recovery archive is marked Always retained before authorization.",
      falseSuccessConditions: [
        "The page offers only an all-or-nothing uninstall rather than four explicit boundaries.",
        "A destructive action can proceed by typing a phrase or before salvage and restore-test gates pass.",
        "Completion evidence exists only in PostgreSQL or under the source tree selected for deletion.",
      ],
      acceptanceThresholds: [
        "The Teardown surface is discoverable from Ops Runtime & Releases.",
        "The selected consequence map distinguishes containers, volumes, source, and recovery evidence.",
        "The destructive control requires a server-verified human hold and release cancels it.",
        "The host runner remains project-scoped and never follows a reparse point outside the deletion root.",
      ],
    },
    ratifiedBy: {
      role: "owner",
      ref: "goal-objective:00933ae3-df99-43ca-8a47-ba93c44022cf",
    },
    reviewRef: "BI-2E9887D2",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-2E9887D2",
        summary:
          "Owner required a governed teardown surface that closes the lifecycle gap left by platform-managed install and upgrade.",
      },
      {
        kind: "design-review",
        ref: "docs/superpowers/specs/2026-08-22-governed-installation-teardown-design.md",
        summary:
          "The binding design fixes the four scopes, salvage-first ordering, restore-tested recovery, no-follow deletion, human hold, and external evidence boundary.",
      },
    ],
  },
];
