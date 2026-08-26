// Ratified page-purpose contract for /ops/installation (BI-7626A660).
//
// The route is not net-new capability. It is where the installation identity
// panel moved to when it stopped opening the workspace home, so the contract
// describes a relocation: the arrival-time signal is now the header badge, and
// this page is the detail behind it.

import type { PurposeContractModule } from ".";

export const INSTALLATION_IDENTITY_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/ops/installation",
    intent: {
      primaryUser:
        "The HR-000 platform owner who runs more than one DPF installation and needs to know which one they are on.",
      triggeringNeed:
        "Identity used to occupy the top of the workspace home for every platform manager, and an operator still has to be able to read and correct it somewhere.",
      prerequisites: [
        "Signed in with the manage_platform capability.",
        "The installation has resolved an environment class, even the cautious default.",
      ],
      job: "Read what this installation is, see what its AI coworkers may and may not do here, and correct the declaration after reviewing the impact.",
      successOutcome:
        "The operator can state the installation's estate, role and purpose, knows which brakes apply to agents, and can change the declaration only after seeing what the change loosens.",
      findability: {
        parentArea: "Operations",
        entryPoints: [
          "/ops",
          "The installation badge in the header on any non-production installation",
        ],
        navigationLayer: "Ops secondary nav, Runtime & Releases group",
        discoveryCue:
          "A few-word badge beside the logo naming the estate and role, linking here for the detail.",
        expectedPath: ["/ops", "/ops/installation"],
      },
      contentRoles: {
        defaultVisibleKeys: [
          "installation-identity-statement",
          "confirmation-status",
          "agent-stance-rows",
        ],
        deferredRegions: [
          {
            key: "identity-change-form",
            role: "The purpose, environment and pairing fields that redeclare what the installation is.",
            trigger: "Opened when the operator asks to change the declaration.",
          },
          {
            key: "identity-change-impact",
            role: "What the change alters, which agent brakes loosen or tighten, and which recorded evidence goes stale.",
            trigger: "Rendered after the operator previews a material change and before it can be saved.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Use installation, estate, environment class, purpose, stance and brake language shared with Teardown and Self-upgrade; never describe a stance as a permission.",
        actionLocation:
          "The identity statement and stance rows read together at the top; every mutating control stays inside the change disclosure.",
        feedbackPrimitive:
          "Inline status badges, an explicit impact preview and a confirm step; a material change cannot be saved from an unpreviewed form.",
        disclosurePattern:
          "The identity statement and the brakes are visible on arrival; the change form and its impact appear progressively.",
        returnBehavior:
          "Saving refreshes in place so the operator reads the identity now in force; the header badge updates on the next render.",
      },
    },
    stateScenarios: {
      "identity-confirmed": {
        statePredicate:
          "A readable operating intent exists and an operator has confirmed it.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef:
            "apps/web/lib/installation-journey/installation-identity-view.ts#loadInstallationIdentityView",
        },
        essentialEvidenceKeys: [
          "environment-class-in-force",
          "primary-purpose",
          "five-agent-stances",
        ],
        primaryExperience: {
          kind: "informational",
          messageKey: "installation-identity.identity-confirmed",
        },
        prohibitedActionKeys: ["stance-as-permission", "silent-identity-change"],
        completionSignal:
          "The operator can state the environment class, the purpose and every stance with the reason given for it.",
        errorCorrection:
          "The operator opens the change disclosure and previews a correction without mutating anything.",
        recovery: {
          actionKey: "return-to-operations",
          routePath: "/ops",
        },
      },
      "environment-shadowed": {
        statePredicate:
          "A portal declaration exists but a higher precedence tier supplies the environment class in force.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/install/environment-class-contract.ts#resolveEnvironmentClassPrecedence",
        },
        essentialEvidenceKeys: [
          "declared-value",
          "value-in-force",
          "winning-authority",
        ],
        primaryExperience: {
          kind: "informational",
          messageKey: "installation-identity.environment-shadowed",
        },
        prohibitedActionKeys: ["portal-overrides-installer", "discard-declaration-silently"],
        completionSignal:
          "The operator is told their saved choice is not the one in force and which authority supplied the winner.",
        errorCorrection:
          "The operator reruns the installer with an explicit environment flag rather than editing the portal record again.",
        recovery: {
          actionKey: "return-to-operations",
          routePath: "/ops",
        },
      },
      "identity-unreadable": {
        statePredicate:
          "The stored operating intent is missing or cannot be parsed.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef:
            "apps/web/lib/installation-journey/installation-identity-view.ts#loadInstallationIdentityView",
        },
        essentialEvidenceKeys: [
          "record-unreadable",
          "cautious-default-applied",
          "redeclare-path",
        ],
        primaryExperience: {
          kind: "informational",
          messageKey: "installation-identity.identity-unreadable",
        },
        prohibitedActionKeys: ["guess-identity", "assume-development"],
        completionSignal:
          "The page says the record could not be read, applies the cautious default, and offers to replace it.",
        errorCorrection:
          "The operator redeclares the identity, replacing the unreadable record.",
        recovery: {
          actionKey: "return-to-operations",
          routePath: "/ops",
        },
      },
    },
    taskProtocol: {
      startRoute: "/ops/installation",
      taskPrompt:
        "Find out what this installation is, what your AI coworkers may do on it, and correct its declared purpose.",
      completionOracle:
        "The operator states the environment class and purpose in force, names at least one agent brake and its reason, and reaches a saved change only after seeing its impact.",
      falseSuccessConditions: [
        "The identity is presented as a permission granted to agents rather than as a brake applied to them.",
        "A material change saves without the operator seeing what it loosens.",
        "A production installation is described using a development installation's stances.",
      ],
      acceptanceThresholds: [
        "The page is reachable from Operations and from the header badge on a non-production installation.",
        "Every stance row carries the resolver's own reason, not copy invented by the page.",
        "The environment class shown is the one the precedence chain resolved, matching the header badge exactly.",
        "No mutating control exists outside the change disclosure.",
      ],
    },
    ratifiedBy: {
      role: "owner",
      ref: "BI-7626A660",
    },
    reviewRef: "BI-7626A660",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-7626A660",
        summary:
          "Owner reported the identity panel taking the top of the workspace home and asked for a few-word non-production indicator beside the logo instead.",
      },
      {
        kind: "design-review",
        ref: "docs/superpowers/specs/2026-08-25-installation-estate-identity-design.md",
        summary:
          "The design fixes the estate/role split, the badge-only-on-non-production rule, and the single-resolver requirement that keeps this page and the header from disagreeing.",
      },
    ],
  },
];
