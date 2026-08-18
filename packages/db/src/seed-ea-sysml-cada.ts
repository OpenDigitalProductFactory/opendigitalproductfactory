// packages/db/src/seed-ea-sysml-cada.ts
// Seeds the CADA & Cloud Sovereignty SysML v2 model as EA graph content
// (EaElement/EaRelationship + an EaView), materializing the companion
// architecture note into queryable platform data.
//
// Companion human-readable model + traceability:
//   docs/architecture/2026-06-19-cada-cloud-sovereignty-architecture-note.md
//
// Requires the sysml2 notation + viewpoints. Idempotent (elements upsert by
// infraCiKey; relationships/view-elements de-dupe on natural keys).

import type { Prisma } from "../generated/client/client";
import { applySysmlModel, type SysmlDesiredElement, type SysmlDesiredModel, type SysmlDesiredRel } from "./sysml-model-seed.js";

const KEY = (suffix: string) => `sysml:cada:${suffix}`;

type ElementSeed = {
  key: string;
  typeSlug: string;
  name: string;
  description: string;
  properties?: Prisma.InputJsonValue;
};

const det = (sourceKey: string, extra: Record<string, unknown> = {}) => ({ provenance: "deterministic", sourceKey, ...extra });
const arch = (extra: Record<string, unknown> = {}) => ({ provenance: "architect", ...extra });

const REQUIREMENTS: ElementSeed[] = [
  { key: "req:REQ-CADA-1", typeSlug: "requirement", name: "REQ-CADA-1 Level 1 residency", description: "A platform deployment can keep infrastructure, assets, and customer data in the EU.", properties: det("docs/architecture/2026-06-19-cada-cloud-sovereignty-architecture-note.md#REQ-CADA-1", { status: "green" }) },
  { key: "req:REQ-CADA-2", typeSlug: "requirement", name: "REQ-CADA-2 No AI-inference-data egress", description: "AI processing for a sovereign workload stays local and never silently falls back to a foreign cloud.", properties: det("apps/web/lib/inference/local-only.ts; apps/web/lib/routing/pipeline-v2.ts", { status: "green" }) },
  { key: "req:REQ-CADA-3", typeSlug: "requirement", name: "REQ-CADA-3 Supply-chain transparency", description: "The platform's software supply chain is auditable, with a signed SBOM.", properties: arch({ status: "partial", planned: "signed SBOM generation + verification" }) },
  { key: "req:REQ-CADA-4", typeSlug: "requirement", name: "REQ-CADA-4 Ownership and control", description: "The achievable tier follows the operating entity's ownership; no foreign entity holds effective control over software evolution.", properties: arch({ status: "partial", planned: "EU steward posture" }) },
  { key: "req:REQ-CADA-5", typeSlug: "requirement", name: "REQ-CADA-5 Assurance evidence", description: "The platform produces auditable evidence that local-only routing held and which model/provider served each request.", properties: det("RouteDecisionLog; ToolExecution; ChangeRequest", { status: "green" }) },
  { key: "req:REQ-CADA-6", typeSlug: "requirement", name: "REQ-CADA-6 Jurisdiction capture", description: "The install captures where it operates, sells, employs, and stores data, plus a forward target assurance level.", properties: det("BusinessContext.operatesIn/sellsTo/employsIn/dataResidency", { status: "partial", planned: "BusinessContext.targetAssuranceLevel" }) },
  { key: "req:REQ-CADA-7", typeSlug: "requirement", name: "REQ-CADA-7 Affected countries reference", description: "The CADA-affected country set is available for planning, marketing, and assessment.", properties: det("packages/db/src/eu-jurisdictions.ts; packages/db/src/eu-jurisdictions.test.ts", { status: "green" }) },
  { key: "req:REQ-CADA-8", typeSlug: "requirement", name: "REQ-CADA-8 Estate-wide assessment", description: "The governance area can assess, plan, and manage CADA compliance across discovered infrastructure, edge nodes, and external digital products.", properties: arch({ status: "planned", trackedBy: "EP-ESTATE-SOVEREIGNTY" }) },
];

const CONSTRAINTS: ElementSeed[] = [
  { key: "con:CON-CADA-1", typeSlug: "constraint", name: "CON-CADA-1 Sovereignty assurance constraint", description: "Achievable assurance level is a function of ownership, infrastructure location, inference locality, software control, and key control, bounded by the weakest foreign-controlled dependency.", properties: det("docs/founder-kernel/wiki/principles/data-sovereignty-follows-control.md", { kind: "parametric" }) },
];

const PARTS: Array<ElementSeed & { satisfies: string[] }> = [
  { key: "part:residency", typeSlug: "part_definition", name: "Local-only inference gate", description: "Filters sovereign workloads to local-only inference and fails loudly instead of silently falling back to cloud.", properties: det("apps/web/lib/inference/local-only.ts; apps/web/lib/routing/pipeline-v2.ts"), satisfies: ["req:REQ-CADA-2"] },
  { key: "part:deploy", typeSlug: "part_definition", name: "Self-hosted deployment", description: "Deployment substrate that can run on EU-controlled infrastructure.", properties: det("docker-compose.yml; docs/superpowers/specs/2026-05-09-deployment-contracts.md"), satisfies: ["req:REQ-CADA-1"] },
  { key: "part:jurisdiction", typeSlug: "part_definition", name: "Jurisdiction model", description: "Business-context fields for operating, selling, employing, and data-residency footprint.", properties: det("packages/db/prisma/schema/core-identity.prisma#BusinessContext"), satisfies: ["req:REQ-CADA-6"] },
  { key: "part:countries", typeSlug: "part_definition", name: "Affected-countries reference", description: "EU + EEA-EFTA country reference used by planning, corpus, and applicability logic.", properties: det("packages/db/src/eu-jurisdictions.ts"), satisfies: ["req:REQ-CADA-7"] },
  { key: "part:evidence", typeSlug: "part_definition", name: "Assurance evidence ledger", description: "Route, tool, and change evidence proving what happened for sovereign workloads.", properties: det("RouteDecisionLog; ToolExecution; ChangeRequest"), satisfies: ["req:REQ-CADA-5"] },
  { key: "part:openness", typeSlug: "part_definition", name: "Open supply chain", description: "Public open-source repo and DCO posture; signed SBOM is the planned Level 2/4 hardening.", properties: arch({ allocatedTo: "public repository + DCO; signed SBOM planned" }), satisfies: ["req:REQ-CADA-3", "req:REQ-CADA-4"] },
  { key: "part:knowledge", typeSlug: "part_definition", name: "Regulatory knowledge", description: "CADA corpus page and regulation seed used by coworkers, planning, and governance assessment.", properties: det("docs/professions/legal-compliance/wiki/eu-cada-cloud-sovereignty.md; packages/db/scripts/seed-cada-regulation.ts"), satisfies: ["req:REQ-CADA-6", "req:REQ-CADA-8"] },
  { key: "part:estate", typeSlug: "part_definition", name: "Estate sovereignty assessment", description: "Forward estate-wide assessment across discovered infrastructure, edge nodes, and external digital products.", properties: arch({ planned: "AssuranceFinding + CapabilityMaturityAssessment scoring" }), satisfies: ["req:REQ-CADA-8"] },
];

const VERIFICATIONS: Array<ElementSeed & { verifies: string[] }> = [
  { key: "vc:VC-CADA-LOCAL", typeSlug: "verification_case", name: "VC-CADA-LOCAL local-only routing", description: "Asserts local-only routing holds and does not silently fall back to foreign cloud inference.", properties: det("apps/web/lib/routing/pipeline-v2.test.ts; apps/web/lib/routing/fallback.test.ts", { status: "green" }), verifies: ["req:REQ-CADA-2"] },
  { key: "vc:VC-CADA-COUNTRIES", typeSlug: "verification_case", name: "VC-CADA-COUNTRIES affected countries", description: "Asserts the CADA affected-country reference is available and stable.", properties: det("packages/db/src/eu-jurisdictions.test.ts", { status: "green" }), verifies: ["req:REQ-CADA-7"] },
  { key: "vc:VC-CADA-EVIDENCE", typeSlug: "verification_case", name: "VC-CADA-EVIDENCE assurance evidence", description: "RouteDecisionLog rows assert served endpoint/provider per request.", properties: det("RouteDecisionLog; ToolExecution", { status: "green" }), verifies: ["req:REQ-CADA-5"] },
  { key: "vc:VC-CADA-SBOM", typeSlug: "verification_case", name: "VC-CADA-SBOM signed SBOM", description: "Verifies signed SBOM generation and validation.", properties: arch({ status: "planned" }), verifies: ["req:REQ-CADA-3"] },
  { key: "vc:VC-CADA-TARGET", typeSlug: "verification_case", name: "VC-CADA-TARGET target assurance level", description: "Verifies target assurance-level capture and enforcement.", properties: arch({ status: "planned" }), verifies: ["req:REQ-CADA-6"] },
  { key: "vc:VC-CADA-ESTATE", typeSlug: "verification_case", name: "VC-CADA-ESTATE estate assessment", description: "Verifies estate sovereignty assessment adapter and scoring.", properties: arch({ status: "planned" }), verifies: ["req:REQ-CADA-8"] },
];

const CONSTRAINT_REFINES: Array<{ from: string; to: string }> = [
  { from: "con:CON-CADA-1", to: "req:REQ-CADA-1" },
  { from: "con:CON-CADA-1", to: "req:REQ-CADA-2" },
  { from: "con:CON-CADA-1", to: "req:REQ-CADA-4" },
];

const PACKAGE: ElementSeed = {
  key: "pkg",
  typeSlug: "package",
  name: "CADA & Cloud Sovereignty",
  description: "SysML v2 model package for the EU Cloud and AI Development Act sovereignty requirements, DPF substrate allocations, and verification cases.",
  properties: arch({
    sysmlPackage: "PKG-CADA",
    design: "docs/architecture/2026-06-19-cada-cloud-sovereignty-architecture-note.md",
    status: "current-state catch-up + forward requirements",
  }),
};

const VIEW_NAME = "CADA & Cloud Sovereignty — Requirements & Verification";

function buildCadaModel(): SysmlDesiredModel {
  const all: ElementSeed[] = [PACKAGE, ...REQUIREMENTS, ...CONSTRAINTS, ...PARTS, ...VERIFICATIONS];
  const elements: SysmlDesiredElement[] = all.map((seed) => ({
    sysmlKey: KEY(seed.key),
    typeSlug: seed.typeSlug,
    name: seed.name,
    description: seed.description,
    properties: (seed.properties ?? {}) as Record<string, unknown>,
  }));

  const relationships: SysmlDesiredRel[] = [];
  for (const seed of all) {
    if (seed.key !== PACKAGE.key) relationships.push({ fromKey: KEY(PACKAGE.key), toKey: KEY(seed.key), relSlug: "contains" });
  }
  for (const p of PARTS) for (const reqKey of p.satisfies) relationships.push({ fromKey: KEY(p.key), toKey: KEY(reqKey), relSlug: "satisfies" });
  for (const v of VERIFICATIONS) for (const reqKey of v.verifies) relationships.push({ fromKey: KEY(v.key), toKey: KEY(reqKey), relSlug: "verifies" });
  for (const ref of CONSTRAINT_REFINES) relationships.push({ fromKey: KEY(ref.from), toKey: KEY(ref.to), relSlug: "refines" });

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "requirement", "constraint", "part_definition", "verification_case"],
    relTypeSlugs: ["contains", "satisfies", "verifies", "refines"],
    view: {
      name: VIEW_NAME,
      description: "CADA requirements, the DPF substrate parts allocated to them, and the verification cases that prove or track them.",
      viewpointName: "Systems Requirements & Verification",
      scopeRef: "cada-cloud-sovereignty",
    },
    lifecycleStage: "design",
  };
}

export async function seedEaSysmlCada(): Promise<void> {
  const model = buildCadaModel();
  const r = await applySysmlModel(model);
  if (r.status !== "skipped") {
    console.log(`Seeded CADA SysML model: ${model.elements.length} elements + view "${VIEW_NAME}"`);
  }
}
