import type { SysmlDesiredModel } from "./sysml-model-seed";

export const GAP_PACKAGE_KEY = "gap:pkg";

export type WorkPatternArchitectureObservedPattern = {
  patternKey: string;
  name: string;
  sourceKey?: string;
  codeAllocationKey?: string;
};

const REQUIREMENTS = [
  {
    key: "gap:req:no-self-activation",
    name: "No Self Activation",
    description:
      "Observed adaptive playbook patterns may propose capability changes, but this foundation cannot mutate prompts, skills, grants, model routes, or Work Case state.",
  },
  {
    key: "gap:req:evidence-backed-proposal",
    name: "Evidence Backed Proposal",
    description:
      "Every proposed work pattern must carry durable evidence from TaskRun metadata, tool execution telemetry, turn metrics, or decision receipts.",
  },
  {
    key: "gap:req:case-bound-governed-action",
    name: "Case Bound Governed Action",
    description:
      "Case-bound patterns remain proposals until the Work Case substrate supplies governed action keys, receipt policy, and attention routing.",
  },
] as const;

const PARTS = [
  {
    key: "gap:part:metadata",
    name: "Work Pattern Metadata",
    description:
      "Typed TaskRun metadata envelope carrying observed pattern keys, review status, decision scope, and evidence references.",
  },
  {
    key: "gap:part:observer",
    name: "Pattern Observer",
    description:
      "Post-run classifier that observes repeated coworker friction and emits capability needs through governed self-assessment paths.",
  },
  {
    key: "gap:part:profile-review",
    name: "Profile Review Runner",
    description:
      "Attributable scheduled review that summarizes recent work pattern evidence for each active coworker route.",
  },
  {
    key: "gap:part:promotion-ladder",
    name: "Promotion Ladder",
    description:
      "Observed -> candidate -> approved -> active -> retired lifecycle for governed adaptive playbook patterns.",
  },
] as const;

const STATES = ["observed", "candidate", "approved", "active", "retired"] as const;

const VERIFICATION_CASES = [
  {
    key: "gap:vc:metadata",
    name: "Verify Work Pattern Metadata",
    verifies: "gap:req:evidence-backed-proposal",
  },
  {
    key: "gap:vc:observer",
    name: "Verify Observer Does Not Activate",
    verifies: "gap:req:no-self-activation",
  },
  {
    key: "gap:vc:profile-review",
    name: "Verify Attributable Profile Review",
    verifies: "gap:req:evidence-backed-proposal",
  },
] as const;

export function safePatternKey(patternKey: string): string {
  return patternKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "pattern";
}

function stableId(prefix: string, safeKey: string): string {
  return `${prefix}-${safeKey}`;
}

export function buildWorkPatternArchitectureModel(input: {
  observedPatterns?: WorkPatternArchitectureObservedPattern[];
} = {}): SysmlDesiredModel {
  const elements: SysmlDesiredModel["elements"] = [
    {
      sysmlKey: GAP_PACKAGE_KEY,
      typeSlug: "package",
      name: "Governed Adaptive Playbooks",
      description:
        "SysML2 projection of the governed adaptive playbooks foundation: typed observations, evidence-backed proposals, periodic review, and promotion controls.",
      properties: {
        sourceKey: "docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md",
      },
    },
  ];
  const relationships: SysmlDesiredModel["relationships"] = [];
  const crossLayerRelationships: SysmlDesiredModel["relationships"] = [];

  for (const requirement of REQUIREMENTS) {
    elements.push({
      sysmlKey: requirement.key,
      typeSlug: "requirement",
      name: requirement.name,
      description: requirement.description,
      properties: { stableId: requirement.key.toUpperCase() },
    });
    relationships.push({ fromKey: GAP_PACKAGE_KEY, toKey: requirement.key, relSlug: "contains" });
  }

  for (const part of PARTS) {
    elements.push({
      sysmlKey: part.key,
      typeSlug: "part_definition",
      name: part.name,
      description: part.description,
      properties: { stableId: part.key.toUpperCase() },
    });
    relationships.push({ fromKey: GAP_PACKAGE_KEY, toKey: part.key, relSlug: "contains" });
  }

  relationships.push({ fromKey: "gap:part:metadata", toKey: "gap:req:evidence-backed-proposal", relSlug: "satisfies" });
  relationships.push({ fromKey: "gap:part:observer", toKey: "gap:req:no-self-activation", relSlug: "satisfies" });
  relationships.push({ fromKey: "gap:part:observer", toKey: "gap:req:evidence-backed-proposal", relSlug: "satisfies" });
  relationships.push({ fromKey: "gap:part:profile-review", toKey: "gap:req:evidence-backed-proposal", relSlug: "satisfies" });

  for (const state of STATES) {
    const key = `gap:state:${state}`;
    elements.push({
      sysmlKey: key,
      typeSlug: "state",
      name: state,
      description: `Promotion ladder state "${state}" for governed adaptive playbook patterns.`,
      properties: { status: state, stableId: `SM-GAP-PROMOTION-${state.toUpperCase()}` },
    });
    relationships.push({ fromKey: "gap:part:promotion-ladder", toKey: key, relSlug: "contains" });
  }

  for (const vc of VERIFICATION_CASES) {
    elements.push({
      sysmlKey: vc.key,
      typeSlug: "verification_case",
      name: vc.name,
      description: `${vc.name} for the governed adaptive playbooks foundation.`,
      properties: { stableId: vc.key.toUpperCase() },
    });
    relationships.push({ fromKey: GAP_PACKAGE_KEY, toKey: vc.key, relSlug: "contains" });
    relationships.push({ fromKey: vc.key, toKey: vc.verifies, relSlug: "verifies" });
  }

  for (const pattern of input.observedPatterns ?? []) {
    const safeKey = safePatternKey(pattern.patternKey);
    const actionKey = `gap:act:${safeKey}`;
    const verificationKey = `gap:vc:${safeKey}`;
    elements.push({
      sysmlKey: actionKey,
      typeSlug: "action",
      name: pattern.name,
      description: `Observed adaptive playbook pattern "${pattern.name}".`,
      properties: {
        sourceKey: pattern.sourceKey ?? null,
        patternKey: pattern.patternKey,
        stableId: stableId("ACT-GAP", safeKey),
      },
    });
    elements.push({
      sysmlKey: verificationKey,
      typeSlug: "verification_case",
      name: `Verify ${pattern.name}`,
      description: `Verification case for observed adaptive playbook pattern "${pattern.name}".`,
      properties: {
        sourceKey: pattern.sourceKey ?? null,
        patternKey: pattern.patternKey,
        stableId: stableId("VC-GAP", safeKey),
      },
    });
    relationships.push({ fromKey: GAP_PACKAGE_KEY, toKey: actionKey, relSlug: "contains" });
    relationships.push({ fromKey: GAP_PACKAGE_KEY, toKey: verificationKey, relSlug: "contains" });
    relationships.push({ fromKey: actionKey, toKey: "gap:req:evidence-backed-proposal", relSlug: "satisfies" });
    relationships.push({ fromKey: verificationKey, toKey: "gap:req:evidence-backed-proposal", relSlug: "verifies" });
    if (pattern.codeAllocationKey) {
      relationships.push({ fromKey: actionKey, toKey: pattern.codeAllocationKey, relSlug: "allocates" });
    }
    if (pattern.sourceKey) {
      crossLayerRelationships.push({ fromKey: actionKey, toKey: `source:${safeKey}`, relSlug: "traces" });
    }
  }

  return {
    elements,
    relationships,
    crossLayerRelationships,
    elementTypeSlugs: [
      "package",
      "requirement",
      "part_definition",
      "state",
      "verification_case",
      "action",
    ],
    relTypeSlugs: ["contains", "satisfies", "verifies", "allocates", "traces"],
    view: {
      name: "Governed Adaptive Playbooks - SysML Projection",
      description:
        "SysML2 projection of the adaptive playbooks foundation and its no-activation governance controls.",
      viewpointName: "Governance Architecture",
      scopeRef: "governed-adaptive-playbooks",
    },
    softRemovePrefix: "gap:",
  };
}
