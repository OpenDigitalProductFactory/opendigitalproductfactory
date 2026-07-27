// Deterministic AI-routing architecture projection.
//
// One versioned registry drives three model kinds over the existing EA graph:
// BPMN describes the end-to-end route, SysML carries obligations and proof, and
// ArchiMate names the realizing platform structure. The registry contains only
// architecture-safe labels and source identities; it never contains prompt or
// customer data.

import type {
  SysmlDesiredConformanceIssue,
  SysmlDesiredElement,
  SysmlDesiredModel,
  SysmlDesiredRel,
} from "./sysml-model-seed";

import {
  AI_ROUTING_ARCHITECTURE_VERSION,
  AI_ROUTING_FLOWS,
  AI_ROUTING_STAGES,
  ARCH_KEY,
  BPMN_KEY,
  IMPLEMENTED,
  LANE_LABELS,
  PARTIAL,
  PROPOSED_SENSITIVE_ROUTING,
  SYSML_KEY,
  sourceKey,
  type AiRoutingStage,
} from "./ai-routing-architecture-registry";

export {
  AI_ROUTING_ARCHITECTURE_VERSION,
  AI_ROUTING_STAGES,
} from "./ai-routing-architecture-registry";

function buildBpmnModel(stages: readonly AiRoutingStage[]): SysmlDesiredModel {
  const elements: SysmlDesiredElement[] = [
    {
      sysmlKey: BPMN_KEY("process"),
      typeSlug: "bpmn_process",
      name: "Governed AI Inference Routing",
      description:
        "Designed end-to-end route from AI work request through data screening, eligibility, limits, fallback, dispatch, safe evidence, and authorized response handling.",
      properties: {
        sourceKey: "apps/web/lib/ea/ai-routing-architecture-registry.ts#AI_ROUTING_STAGES",
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        projectionKind: "designed",
      },
    },
    ...LANE_LABELS.map(
      (lane): SysmlDesiredElement => ({
        sysmlKey: BPMN_KEY(`lane:${lane.key}`),
        typeSlug: "bpmn_lane",
        name: lane.label,
        description: `${lane.label} responsibility lane for the governed AI-routing process.`,
        properties: {
          sourceKey: "apps/web/lib/ea/ai-routing-architecture-registry.ts#LANE_LABELS",
          sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
          lane: lane.key,
        },
      }),
    ),
    ...stages.map(
      (stage): SysmlDesiredElement => ({
        sysmlKey: BPMN_KEY(stage.id),
        typeSlug: stage.bpmnTypeSlug,
        name: stage.ownerLabel,
        description: stage.technicalName,
        properties: {
          sourceKey: sourceKey(stage.source),
          sourceVersion: stage.source.version,
          implementationStatus: stage.source.status,
          registryKey: stage.id,
          ownerLabel: stage.ownerLabel,
          technicalName: stage.technicalName,
          lane: stage.lane,
          laneKey: BPMN_KEY(`lane:${stage.lane}`),
        },
      }),
    ),
  ];

  const relationships: SysmlDesiredRel[] = AI_ROUTING_FLOWS.map((flow) => ({
    fromKey: BPMN_KEY(flow.from),
    toKey: BPMN_KEY(flow.to),
    relSlug: flow.relSlug,
    properties: {
      sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
      ...(flow.conditionCode ? { conditionCode: flow.conditionCode } : {}),
      ...(flow.ownerLabel ? { ownerLabel: flow.ownerLabel } : {}),
    },
  }));

  return {
    elements,
    relationships,
    elementTypeSlugs: [
      "bpmn_process",
      "bpmn_lane",
      "bpmn_start_event",
      "bpmn_end_event",
      "bpmn_user_task",
      "bpmn_service_task",
      "bpmn_business_rule_task",
      "bpmn_exclusive_gateway",
    ],
    relTypeSlugs: ["sequence_flow", "conditional_flow", "default_flow"],
    view: {
      name: "AI Routing — Designed Process (Live Projection)",
      description:
        "Versioned BPMN projection of the designed governed-AI route. Owner labels are primary; technical source and implementation status are inspector metadata.",
      viewpointName: "Process Architecture",
      scopeRef: "ai-routing-designed",
    },
    lifecycleStage: "design",
    softRemovePrefix: BPMN_KEY(""),
  };
}

type RequirementSeed = {
  key: string;
  name: string;
  description: string;
};

const REQUIREMENTS: readonly RequirementSeed[] = [
  {
    key: "req:REQ-AIC-1",
    name: "REQ-AIC-1 Eligible-set routing",
    description:
      "Every inference call is selected only from routes that satisfy the compiled task, capability, residency, sensitivity, provider, and contract-family constraints.",
  },
  {
    key: "req:REQ-AIC-10",
    name: "REQ-AIC-10 Screen before external egress",
    description:
      "Governed prompt, system, tool-schema, tool-argument, and tool-result content is screened before any external dispatch.",
  },
  {
    key: "req:REQ-AIC-11",
    name: "REQ-AIC-11 Obligation-preserving fallback",
    description:
      "Fallback keeps the transformed payload and every hard constraint from the original policy decision.",
  },
  {
    key: "req:REQ-AIC-12",
    name: "REQ-AIC-12 Privacy-safe routing evidence",
    description:
      "Routing evidence records bounded identifiers, versions, classes, outcomes, timing, and counts without raw protected payload content or token maps.",
  },
  {
    key: "req:REQ-AIC-13",
    name: "REQ-AIC-13 Authorized response rehydration",
    description:
      "Protected values are restored only after a fresh authorization for the same actor, surface, action, and readable field.",
  },
  {
    key: "req:REQ-AIC-14",
    name: "REQ-AIC-14 Versioned architecture projection",
    description:
      "Designed routing stations and relationships carry stable architecture identities and a source revision so design/runtime comparison is reproducible.",
  },
];

const PARTS = [
  {
    key: "part:data-governance-pep",
    name: "Inference Data Governance PEP",
    source: PROPOSED_SENSITIVE_ROUTING("Architecture"),
    satisfies: ["req:REQ-AIC-10", "req:REQ-AIC-12"],
  },
  {
    key: "part:contract",
    name: "Request Contract Builder",
    source: PARTIAL("apps/web/lib/routing/request-contract.ts", "inferContract"),
    satisfies: ["req:REQ-AIC-1"],
  },
  {
    key: "part:router",
    name: "Route Selector",
    source: PARTIAL("apps/web/lib/routing/pipeline-v2.ts", "routeEndpointV2"),
    satisfies: ["req:REQ-AIC-1", "req:REQ-AIC-11"],
  },
  {
    key: "part:fallback",
    name: "Fallback Planner",
    source: PARTIAL("apps/web/lib/routing/fallback.ts", "buildFallbackPlan"),
    satisfies: ["req:REQ-AIC-11"],
  },
  {
    key: "part:adapter",
    name: "Inference Adapter",
    source: IMPLEMENTED("apps/web/lib/inference/ai-inference.ts", "callProvider"),
    satisfies: ["req:REQ-AIC-1"],
  },
  {
    key: "part:receipt",
    name: "Safe Routing Evidence",
    source: PARTIAL("apps/web/lib/inference/routed-inference.ts", "routeAndCall"),
    satisfies: ["req:REQ-AIC-12", "req:REQ-AIC-14"],
  },
  {
    key: "part:rehydration",
    name: "Response Rehydration Authorizer",
    source: PROPOSED_SENSITIVE_ROUTING("Masking And Rehydration"),
    satisfies: ["req:REQ-AIC-13"],
  },
] as const;

const VERIFICATION_CASES = [
  {
    key: "vc:VC-AIC-SCREEN",
    name: "VC-AIC-SCREEN pre-dispatch enforcement",
    evidence:
      "docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md",
    status: "planned",
    verifies: ["req:REQ-AIC-10"],
  },
  {
    key: "vc:VC-AIC-ELIGIBILITY",
    name: "VC-AIC-ELIGIBILITY hard route exclusions",
    evidence: "apps/web/lib/routing/pipeline-v2.provider-policy.test.ts",
    status: "partial",
    verifies: ["req:REQ-AIC-1"],
  },
  {
    key: "vc:VC-AIC-FALLBACK",
    name: "VC-AIC-FALLBACK obligation-preserving fallback",
    evidence:
      "docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md",
    status: "planned",
    verifies: ["req:REQ-AIC-11"],
  },
  {
    key: "vc:VC-AIC-RECEIPT",
    name: "VC-AIC-RECEIPT privacy-safe route receipt",
    evidence:
      "docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md",
    status: "planned",
    verifies: ["req:REQ-AIC-12"],
  },
  {
    key: "vc:VC-AIC-REHYDRATION",
    name: "VC-AIC-REHYDRATION actor and surface authorization",
    evidence:
      "docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md",
    status: "planned",
    verifies: ["req:REQ-AIC-13"],
  },
  {
    key: "vc:VC-AIC-PARITY",
    name: "VC-AIC-PARITY source identity and idempotency",
    evidence: "apps/web/lib/ea/ai-routing-architecture-extract.test.ts",
    status: "implemented",
    verifies: ["req:REQ-AIC-14"],
  },
] as const;

function buildSysmlModel(
  stages: readonly AiRoutingStage[],
  conformanceIssues: SysmlDesiredConformanceIssue[],
): SysmlDesiredModel {
  const elements: SysmlDesiredElement[] = [
    {
      sysmlKey: SYSML_KEY("pkg"),
      typeSlug: "package",
      name: "AI Cockpit & Governed Model Routing",
      description:
        "Live requirements-and-verification projection for governed AI inference routing.",
      properties: {
        sourceKey:
          "docs/superpowers/specs/2026-07-26-ai-routing-architecture-explainability-design.md",
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
      },
    },
    ...REQUIREMENTS.map(
      (requirement): SysmlDesiredElement => ({
        sysmlKey: SYSML_KEY(requirement.key),
        typeSlug: "requirement",
        name: requirement.name,
        description: requirement.description,
        properties: {
          sourceKey:
            "docs/superpowers/specs/2026-07-26-ai-routing-architecture-explainability-design.md",
          sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
          status: "designed",
        },
      }),
    ),
    {
      sysmlKey: SYSML_KEY("constraint:CON-AIC-2"),
      typeSlug: "constraint",
      name: "CON-AIC-2 Provider suitability cannot loosen data policy",
      description:
        "Provider suitability and quality/time/cost ranking may narrow or order the PDP-approved set; they may never expand it.",
      properties: {
        sourceKey:
          "docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md",
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        status: "designed",
      },
    },
    ...PARTS.map(
      (part): SysmlDesiredElement => ({
        sysmlKey: SYSML_KEY(part.key),
        typeSlug: "part_definition",
        name: part.name,
        description: `${part.name} allocation in the governed routing architecture.`,
        properties: {
          sourceKey: sourceKey(part.source),
          sourceVersion: part.source.version,
          implementationStatus: part.source.status,
        },
      }),
    ),
    ...VERIFICATION_CASES.map(
      (verification): SysmlDesiredElement => ({
        sysmlKey: SYSML_KEY(verification.key),
        typeSlug: "verification_case",
        name: verification.name,
        description: `Verification case for ${verification.verifies.join(", ")}.`,
        properties: {
          sourceKey: verification.evidence,
          sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
          status: verification.status,
        },
      }),
    ),
  ];

  const relationships: SysmlDesiredRel[] = [];
  for (const element of elements) {
    if (element.sysmlKey === SYSML_KEY("pkg")) continue;
    relationships.push({
      fromKey: SYSML_KEY("pkg"),
      toKey: element.sysmlKey,
      relSlug: "contains",
      properties: { sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION },
    });
  }
  for (const part of PARTS) {
    for (const requirement of part.satisfies) {
      relationships.push({
        fromKey: SYSML_KEY(part.key),
        toKey: SYSML_KEY(requirement),
        relSlug: "satisfies",
        properties: { sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION },
      });
    }
  }
  for (const verification of VERIFICATION_CASES) {
    for (const requirement of verification.verifies) {
      relationships.push({
        fromKey: SYSML_KEY(verification.key),
        toKey: SYSML_KEY(requirement),
        relSlug: "verifies",
        properties: { sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION },
      });
    }
  }
  relationships.push({
    fromKey: SYSML_KEY("constraint:CON-AIC-2"),
    toKey: SYSML_KEY("req:REQ-AIC-10"),
    relSlug: "refines",
    properties: { sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION },
  });

  const crossLayerRelationships: SysmlDesiredRel[] = [
    {
      fromKey: BPMN_KEY("process"),
      toKey: ARCH_KEY("process"),
      relSlug: "details",
      relationshipNotationSlug: "dpf-cross-notation",
      properties: {
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        explanationCode: "bpmn-details-routing-process",
      },
    },
    {
      fromKey: ARCH_KEY("component:data-governance-pep"),
      toKey: BPMN_KEY("sensitive-screen"),
      relSlug: "realizes_process",
      relationshipNotationSlug: "dpf-cross-notation",
      properties: {
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        explanationCode: "component-realizes-screen",
      },
    },
    {
      fromKey: ARCH_KEY("component:route-selector"),
      toKey: BPMN_KEY("rank-quality-time-cost"),
      relSlug: "realizes_process",
      relationshipNotationSlug: "dpf-cross-notation",
      properties: {
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        explanationCode: "component-realizes-route-selection",
      },
    },
    {
      fromKey: ARCH_KEY("component:inference-adapter"),
      toKey: BPMN_KEY("dispatch"),
      relSlug: "realizes_process",
      relationshipNotationSlug: "dpf-cross-notation",
      properties: {
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        explanationCode: "component-realizes-dispatch",
      },
    },
    {
      fromKey: SYSML_KEY("req:REQ-AIC-10"),
      toKey: ARCH_KEY("capability:governed-ai-routing"),
      relSlug: "sysml_traces",
      relationshipNotationSlug: "dpf-cross-notation",
      properties: {
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        explanationCode: "screen-requirement-traces-capability",
      },
    },
    {
      fromKey: SYSML_KEY("part:data-governance-pep"),
      toKey: ARCH_KEY("component:data-governance-pep"),
      relSlug: "sysml_allocates",
      relationshipNotationSlug: "dpf-cross-notation",
      properties: {
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        explanationCode: "pep-allocated-to-component",
      },
    },
    {
      fromKey: SYSML_KEY("part:router"),
      toKey: ARCH_KEY("component:route-selector"),
      relSlug: "sysml_allocates",
      relationshipNotationSlug: "dpf-cross-notation",
      properties: {
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        explanationCode: "route-selector-allocated-to-component",
      },
    },
    {
      fromKey: SYSML_KEY("part:adapter"),
      toKey: ARCH_KEY("component:inference-adapter"),
      relSlug: "sysml_allocates",
      relationshipNotationSlug: "dpf-cross-notation",
      properties: {
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        explanationCode: "adapter-allocated-to-component",
      },
    },
    {
      fromKey: SYSML_KEY("vc:VC-AIC-RECEIPT"),
      toKey: ARCH_KEY("evidence:safe-routing-receipt"),
      relSlug: "sysml_verifies",
      relationshipNotationSlug: "dpf-cross-notation",
      properties: {
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        explanationCode: "receipt-verification-traces-evidence",
      },
    },
  ];

  return {
    elements,
    relationships,
    crossLayerRelationships,
    elementTypeSlugs: [
      "package",
      "requirement",
      "constraint",
      "part_definition",
      "verification_case",
    ],
    relTypeSlugs: ["contains", "satisfies", "verifies", "refines"],
    view: {
      name: "AI Cockpit — Requirements & Verification",
      description:
        "Live SysML projection of the requirements, constraints, realizing parts, and verification cases for governed AI routing.",
      viewpointName: "Systems Requirements & Verification",
      scopeRef: "ai-cockpit-routing",
    },
    lifecycleStage: "design",
    softRemovePrefix: SYSML_KEY(""),
    conformanceIssues,
  };
}

function buildArchimateModel(): SysmlDesiredModel {
  const components = [
    {
      key: "component:data-governance-pep",
      name: "Inference Data Governance PEP",
      source: PROPOSED_SENSITIVE_ROUTING("Architecture"),
    },
    {
      key: "component:request-contract",
      name: "Request Contract Builder",
      source: PARTIAL("apps/web/lib/routing/request-contract.ts", "inferContract"),
    },
    {
      key: "component:route-selector",
      name: "Route Selector and Fallback",
      source: PARTIAL("apps/web/lib/routing/pipeline-v2.ts", "routeEndpointV2"),
    },
    {
      key: "component:inference-adapter",
      name: "Inference Adapter Registry",
      source: IMPLEMENTED("apps/web/lib/inference/ai-inference.ts", "callProvider"),
    },
    {
      key: "component:response-authorization",
      name: "Response Rehydration Authorizer",
      source: PROPOSED_SENSITIVE_ROUTING("Masking And Rehydration"),
    },
  ] as const;
  const elements: SysmlDesiredElement[] = [
    {
      sysmlKey: ARCH_KEY("capability:governed-ai-routing"),
      typeSlug: "business_capability",
      name: "Governed AI Routing",
      description:
        "Select and execute the right AI route without weakening task, data-boundary, provider, availability, or authorization obligations.",
      properties: {
        sourceKey:
          "docs/superpowers/specs/2026-07-26-ai-routing-architecture-explainability-design.md",
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
      },
    },
    {
      sysmlKey: ARCH_KEY("process"),
      typeSlug: "business_process",
      name: "Governed AI Inference Routing",
      description:
        "Enterprise-architecture realization of the designed end-to-end AI-routing process.",
      properties: {
        sourceKey: "apps/web/lib/ea/ai-routing-architecture-registry.ts#AI_ROUTING_STAGES",
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
      },
    },
    ...components.map(
      (component): SysmlDesiredElement => ({
        sysmlKey: ARCH_KEY(component.key),
        typeSlug: "application_component",
        name: component.name,
        description: `${component.name} realizing component for governed AI routing.`,
        properties: {
          sourceKey: sourceKey(component.source),
          sourceVersion: component.source.version,
          implementationStatus: component.source.status,
        },
      }),
    ),
    {
      sysmlKey: ARCH_KEY("evidence:safe-routing-receipt"),
      typeSlug: "event_evidence",
      name: "Privacy-safe Routing Evidence",
      description:
        "Bounded route, adapter, outcome, timing, usage, and policy-receipt evidence with no raw protected payload content.",
      properties: {
        sourceKey: "apps/web/lib/inference/routed-inference.ts#routeAndCall",
        sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION,
        refinementLevel: "actual",
      },
    },
  ];
  const relationships: SysmlDesiredRel[] = [
    {
      fromKey: ARCH_KEY("process"),
      toKey: ARCH_KEY("capability:governed-ai-routing"),
      relSlug: "realizes",
      properties: { sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION },
    },
    ...components.map(
      (component): SysmlDesiredRel => ({
        fromKey: ARCH_KEY(component.key),
        toKey: ARCH_KEY("capability:governed-ai-routing"),
        relSlug: "realizes",
        properties: { sourceVersion: AI_ROUTING_ARCHITECTURE_VERSION },
      }),
    ),
  ];

  return {
    elements,
    relationships,
    elementTypeSlugs: [
      "business_capability",
      "business_process",
      "application_component",
      "event_evidence",
    ],
    relTypeSlugs: ["realizes"],
    view: {
      name: "AI Routing — Realizing Architecture (Live Projection)",
      description:
        "ArchiMate realization view linking the governed routing capability and process to their implementing components and safe evidence.",
      viewpointName: "AI Routing Realization",
      scopeRef: "ai-routing-realization",
    },
    lifecycleStage: "production",
    softRemovePrefix: ARCH_KEY(""),
  };
}

function sourceVersionIssues(
  stages: readonly AiRoutingStage[],
): SysmlDesiredConformanceIssue[] {
  const missing = stages.filter((stage) => stage.source.version.trim().length === 0);
  if (missing.length === 0) return [];
  return [
    {
      onKey: SYSML_KEY("pkg"),
      issueType: "ai-routing-source-version-missing",
      severity: "error",
      message: `AI-routing projection sources are missing a version: ${missing.map((stage) => stage.id).join(", ")}.`,
    },
  ];
}

export type AiRoutingArchitectureModels = {
  bpmn: SysmlDesiredModel;
  sysml: SysmlDesiredModel;
  archimate: SysmlDesiredModel;
};

export function buildAiRoutingArchitectureModels(
  opts: { stages?: readonly AiRoutingStage[] } = {},
): AiRoutingArchitectureModels {
  const stages = opts.stages ?? AI_ROUTING_STAGES;
  return {
    bpmn: buildBpmnModel(stages),
    archimate: buildArchimateModel(),
    sysml: buildSysmlModel(stages, sourceVersionIssues(stages)),
  };
}
