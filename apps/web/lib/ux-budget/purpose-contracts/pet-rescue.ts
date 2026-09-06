import type { PurposeContractSource } from "../page-purpose";
import type { PurposeContractModule } from ".";

type RescueRouteDefinition = {
  routePath: `/workspace/rescue${string}`;
  label: string;
  job: string;
  evidenceKeys: string[];
};

const ROUTES: RescueRouteDefinition[] = [
  {
    routePath: "/workspace/rescue",
    label: "Rescue operations",
    job: "See which animal-welfare commitment needs attention and open its operating area.",
    evidenceKeys: ["animal-count", "housing-capacity", "care-due", "active-applications", "posted-animal-cost"],
  },
  {
    routePath: "/workspace/rescue/animals",
    label: "Animals",
    job: "See the current custody population, placement readiness, and legal holds.",
    evidenceKeys: ["in-care", "placement-ready", "legal-hold"],
  },
  {
    routePath: "/workspace/rescue/intake",
    label: "Intake",
    job: "See animals still in intake, legal holds, and the housing capacity available to receive them.",
    evidenceKeys: ["intake-review", "legal-hold", "housing-free"],
  },
  {
    routePath: "/workspace/rescue/care",
    label: "Daily care",
    job: "See care due today, missed work, and animal records needing attention.",
    evidenceKeys: ["care-due", "missed-care", "care-exceptions"],
  },
  {
    routePath: "/workspace/rescue/adoptions",
    label: "Adoptions",
    job: "See active applications and placement-ready animals with no current interest.",
    evidenceKeys: ["active-applications", "ready-without-interest"],
  },
  {
    routePath: "/workspace/rescue/stewardship",
    label: "Stewardship",
    job: "See restricted fund records and posted animal-attributed cost when finance access allows it.",
    evidenceKeys: ["restricted-funds", "posted-animal-cost"],
  },
];

function rescuePurposeContract(definition: RescueRouteDefinition): PurposeContractSource {
  return {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: definition.routePath,
    intent: {
      primaryUser: "A shelter operator deciding what needs attention across intake, welfare, housing, placement, and stewardship.",
      triggeringNeed: `The ${definition.label} view is needed to replace generic commercial measures with animal-welfare operating facts.`,
      prerequisites: [
        "The user is signed in with animal-welfare access.",
        "The installation is configured for the Pet Rescue archetype.",
      ],
      job: definition.job,
      successOutcome: "The operator can distinguish current facts, an unrecorded state, and an unavailable source without treating any of them as the same zero.",
      findability: {
        parentArea: "Workspace",
        entryPoints: ["/workspace", "/workspace/rescue"],
        navigationLayer: "Pet Rescue operating-area navigation",
        discoveryCue: "The Pet Rescue workspace entry and the Rescue operations area tabs.",
        expectedPath: ["/workspace", "/workspace/rescue", definition.routePath],
      },
      contentRoles: {
        defaultVisibleKeys: definition.evidenceKeys,
        deferredRegions: [
          {
            key: "data-source-status",
            role: "Technical source-failure detail without exposing it as the primary operating experience.",
            trigger: "One or more operating sources are unavailable.",
          },
        ],
      },
      familyConsistency: {
        terminology: "Use intake, animals, housing, daily care, adoptions, and stewardship; do not describe rescue work as commercial demand capture or manufacturing.",
        actionLocation: "Area navigation stays immediately below the page purpose; overview signals link to the operating area they summarize.",
        feedbackPrimitive: "Shared status badges, notices, empty states, and stat cards distinguish Current, No records yet, and Unavailable.",
        disclosurePattern: "The operating summary is visible first. Source diagnostics appear only in technical details.",
        returnBehavior: "Every rescue area preserves the same navigation and returns to the rescue overview or workspace normally.",
      },
    },
    stateScenarios: {
      "facts-available": {
        statePredicate: "The area's source can be read and contains one or more records.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: "apps/web/lib/animal-welfare/cockpit-loader.ts" },
        essentialEvidenceKeys: definition.evidenceKeys,
        primaryExperience: { kind: "informational", messageKey: "pet-rescue.facts-available" },
        prohibitedActionKeys: ["invent-operational-fact"],
        completionSignal: "The page shows the bounded current measures for its operating area.",
        errorCorrection: "Correct the owning operational record; the cockpit remains a read-only projection.",
        recovery: { actionKey: "open-rescue-overview", routePath: "/workspace/rescue" },
      },
      "no-records": {
        statePredicate: "The area's source can be read but has no records.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: "apps/web/lib/animal-welfare/cockpit-loader.ts" },
        essentialEvidenceKeys: ["no-records-state"],
        primaryExperience: { kind: "informational", messageKey: "pet-rescue.no-records" },
        prohibitedActionKeys: ["show-unavailable-as-zero"],
        completionSignal: "The page says that no records exist instead of presenting an all-clear claim.",
        errorCorrection: "The operator records the work in its owning area; the summary does not fabricate it.",
        recovery: { actionKey: "open-rescue-overview", routePath: "/workspace/rescue" },
      },
      unavailable: {
        statePredicate: "The area's source cannot be read or the user lacks the narrower finance permission.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: "apps/web/lib/animal-welfare/cockpit-loader.ts" },
        essentialEvidenceKeys: ["unavailable-state", "data-source-status"],
        primaryExperience: { kind: "informational", messageKey: "pet-rescue.source-unavailable" },
        prohibitedActionKeys: ["show-unavailable-as-zero"],
        completionSignal: "The page names the source as unavailable and withholds a numeric claim.",
        errorCorrection: "Restore the source or required permission, then reload the same route.",
        recovery: { actionKey: "open-rescue-overview", routePath: "/workspace/rescue" },
      },
    },
    taskProtocol: {
      startRoute: definition.routePath,
      taskPrompt: definition.job,
      completionOracle: "The operator reads the area's current state or a truthful empty/unavailable state without inferring missing facts.",
      falseSuccessConditions: [
        "A failed or unauthorized source renders as zero.",
        "The page substitutes generic commercial value-chain language for animal-welfare work.",
        "The operator must return to Build Studio to find another rescue operating area.",
      ],
      acceptanceThresholds: [
        "The page uses the shared rescue navigation.",
        "Every summary state is Current, No records yet, or Unavailable.",
        "The route uses shared shell and report primitives with token-based styling.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "operator-request:pet-rescue-workroom-review-2026-08-25" },
    reviewRef: "BI-7A38F667",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-7A38F667",
        summary: "The operator asked for Pet Rescue work to follow intake, ongoing health and welfare, and placement rather than a generic commercial value chain.",
      },
      {
        kind: "design-review",
        ref: "docs/superpowers/specs/2026-08-25-pet-rescue-operating-system-and-help-recovery-design.md",
        summary: "The approved design keeps custody, Resource capacity, care, work, adoption, finance, and storefront ownership separate while composing bounded workspace read models.",
      },
    ],
  };
}

export const PET_RESCUE_PURPOSE_CONTRACTS: PurposeContractModule = ROUTES.map(rescuePurposeContract);
