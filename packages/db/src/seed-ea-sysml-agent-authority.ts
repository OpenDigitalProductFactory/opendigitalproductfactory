// packages/db/src/seed-ea-sysml-agent-authority.ts
// SysML v2 current-state view: "AI Agent Authority" — Phase 2 catch-up view
// (docs/superpowers/specs/2026-06-14-sysml-architecture-substrate-design.md §8 view #3).
//
// Models DPF's REAL authority architecture as EA graph content: how an AI coworker
// gets authority (identity → delegation → tool grants → runtime-scoped token), the
// single enforcement choke point, the HITL approval gate, and the dual-principal
// audit ledger. Grounded in code/schema, not invented. Each element records
// `provenance` ("deterministic" = grounded in code/schema with a `sourceKey`, vs
// "architect" = architect-authored judgment) per the spec's Phase 2 guidance, and
// a conformance issue is filed for the one verification gap found during research.
//
// Requires the sysml2 notation + viewpoints (seed-ea-sysml2.ts / seed-ea-viewpoints.ts).
// Idempotent: elements upsert by stable `infraCiKey`; relationships/view elements
// de-dupe on natural keys. Runtime EA validation deferred per the substrate spec.
//
// (Mirrors the seeding pattern in seed-ea-sysml-ai-cockpit.ts; a shared seeding
// helper is a tracked convergence follow-up.)

import { prisma } from "./client.js";
import type { Prisma } from "../generated/client/client";

const NOTATION_SLUG = "sysml2";
const KEY = (suffix: string) => `sysml:aauth:${suffix}`;

type ElementSeed = {
  key: string;
  typeSlug: string;
  name: string;
  description: string;
  properties?: Prisma.InputJsonValue;
};

const det = (sourceKey: string, extra: Record<string, unknown> = {}) => ({ provenance: "deterministic", sourceKey, ...extra });
const arch = (extra: Record<string, unknown> = {}) => ({ provenance: "architect", ...extra });

// ── Parts (entities) → realizing substrate ──────────────────────────────────
const PARTS: Array<ElementSeed & { satisfies: string[] }> = [
  { key: "part:agent",        typeSlug: "part_definition", name: "Agent (coworker identity)",        description: "The coworker identity bearing tier, humanSupervisorId, hitlTierDefault, escalatesTo/delegatesTo.", properties: det("packages/db/prisma/schema.prisma#Agent"), satisfies: [] },
  { key: "part:govprofile",   typeSlug: "part_definition", name: "AgentGovernanceProfile",            description: "Per-agent autonomyLevel, hitlPolicy, allowDelegation, maxDelegationRiskBand; capability + directive policy classes.", properties: det("packages/db/prisma/schema.prisma#AgentGovernanceProfile"), satisfies: [] },
  { key: "part:delegation",   typeSlug: "part_definition", name: "DelegationGrant",                   description: "Scoped, time-boxed human→agent delegation (scopeJson, riskBand, validFrom/expiresAt, maxUses).", properties: det("packages/db/prisma/schema.prisma#DelegationGrant"), satisfies: ["req:REQ-AAUTH-4"] },
  { key: "part:authbinding",  typeSlug: "part_definition", name: "AuthorityBinding",                  description: "Resource-scoped authority policy (scopeType, resourceRef, approvalMode, sensitivityCeiling, authorityScope).", properties: det("packages/db/prisma/schema.prisma#AuthorityBinding"), satisfies: ["req:REQ-AAUTH-4"] },
  { key: "part:toolgrant",    typeSlug: "part_definition", name: "AgentToolGrant + TOOL_TO_GRANTS",   description: "The held grants and the tool→required-grants map; a tool absent from the map is denied by default.", properties: det("apps/web/lib/tak/agent-grants.ts"), satisfies: ["req:REQ-AAUTH-1", "req:REQ-AAUTH-7"] },
  { key: "part:token",        typeSlug: "part_definition", name: "McpApiToken / mcpSession",          description: "Runtime-scoped authority: PAT (scopes ⊆ user grants, optional agent binding) and 5-min audience-pinned session JWT.", properties: det("apps/web/lib/mcp/session-token.ts; apps/web/lib/auth/mcp-api-token.ts"), satisfies: ["req:REQ-AAUTH-4"] },
  { key: "part:govexec",      typeSlug: "part_definition", name: "governedExecuteTool (enforcement choke point)", description: "Single gate: checks the human capability AND (when an agentId is present) the agent grants; runs HITL/hooks; always audits.", properties: det("apps/web/lib/mcp-governed-execute.ts"), satisfies: ["req:REQ-AAUTH-1", "req:REQ-AAUTH-2", "req:REQ-AAUTH-5"] },
  { key: "part:envelope",     typeSlug: "part_definition", name: "CoworkerActionEnvelope (HITL gate)", description: "Propose→approve→resolve record for effectful/destructive coworker actions; resolvable only by the delegating user.", properties: det("apps/web/lib/coworker/envelope-state-machine.ts; packages/db/prisma/schema.prisma#CoworkerActionEnvelope"), satisfies: ["req:REQ-AAUTH-3"] },
  { key: "part:toolexec",     typeSlug: "part_definition", name: "ToolExecution (authority ledger)",  description: "Every governed call, recording dual principal (userId + delegatingUserId), agentId, apiTokenId, capabilityId/auditClass, envelopeId.", properties: det("packages/db/prisma/schema.prisma#ToolExecution"), satisfies: ["req:REQ-AAUTH-6"] },
];

// ── Requirements (invariants) ───────────────────────────────────────────────
const REQUIREMENTS: ElementSeed[] = [
  { key: "req:REQ-AAUTH-1", typeSlug: "requirement", name: "REQ-AAUTH-1 Default-deny tool authority", description: "A tool with no TOOL_TO_GRANTS entry is denied; a coworker may invoke a tool only if its (implication-expanded) grants intersect the tool's required grants.", properties: det("apps/web/lib/tak/agent-grants.ts#isToolAllowedByGrants") },
  { key: "req:REQ-AAUTH-2", typeSlug: "requirement", name: "REQ-AAUTH-2 Dual gate: capability AND grant", description: "An agent-context call must pass BOTH the human's requiredCapability check and the agent-grant check; failing either is rejected and audited.", properties: det("apps/web/lib/mcp-governed-execute.ts") },
  { key: "req:REQ-AAUTH-3", typeSlug: "requirement", name: "REQ-AAUTH-3 Effectful actions require an approved envelope", description: "Every effectful/destructive coworker action requires an approved CoworkerActionEnvelope, resolvable only by the delegating user.", properties: det("apps/web/lib/coworker/envelope-actions.ts") },
  { key: "req:REQ-AAUTH-4", typeSlug: "requirement", name: "REQ-AAUTH-4 Authority bound to principals + tokens/grants", description: "Token scope ⊆ user grants; agent binding narrows never widens; the 5-min audience-pinned session JWT overrides any PAT in the same shell. Authority is not chat-UI state.", properties: det("apps/web/app/api/mcp/v1/route.ts; apps/web/lib/mcp/session-token.ts") },
  { key: "req:REQ-AAUTH-5", typeSlug: "requirement", name: "REQ-AAUTH-5 Every governed call is audited (incl. denials)", description: "governedExecuteTool writes a ToolExecution row on forbidden_capability, forbidden_grant, hook_denied, and success alike; audit failure never masks the result.", properties: det("apps/web/lib/mcp-governed-execute.ts") },
  { key: "req:REQ-AAUTH-6", typeSlug: "requirement", name: "REQ-AAUTH-6 Dual-principal accountability", description: "A coworker action records both the executing identity (userId) and the human it acted for (delegatingUserId) as distinct fields; coworker identity is the semantic agentId.", properties: det("packages/db/prisma/schema.prisma#ToolExecution") },
  { key: "req:REQ-AAUTH-7", typeSlug: "requirement", name: "REQ-AAUTH-7 Grant narrowing is one-way", description: "GRANT_IMPLICATIONS only lets a coarse grant satisfy a finer requirement; holding the fine grant never implies the coarse one.", properties: det("apps/web/lib/tak/agent-grants.ts#GRANT_IMPLICATIONS") },
];

// ── Constraint ───────────────────────────────────────────────────────────────
const CONSTRAINTS: ElementSeed[] = [
  { key: "con:CON-AAUTH-1", typeSlug: "constraint", name: "CON-AAUTH-1 Token-scope subset invariant", description: "tokenScope ⊆ userGrants ∧ (agentBinding ⇒ scope narrows) ∧ (sessionJWT present ⇒ sessionJWT wins over PAT). Enforced before execution.", properties: det("apps/web/app/api/mcp/v1/route.ts", { kind: "parametric" }) },
];

// ── Verification cases (evidence records) ────────────────────────────────────
const VERIFICATIONS: Array<ElementSeed & { verifies: string[]; gap?: string }> = [
  { key: "vc:VC-AAUTH-TOOLEXEC", typeSlug: "verification_case", name: "VC-AAUTH-TOOLEXEC ToolExecution ledger", description: "Proves every governed action ran under agentId+userId+delegatingUserId with capability/audit classification (and envelopeId when gated).", properties: det("packages/db/prisma/schema.prisma#ToolExecution", { status: "active" }), verifies: ["req:REQ-AAUTH-5", "req:REQ-AAUTH-6"] },
  { key: "vc:VC-AAUTH-ENVELOPE", typeSlug: "verification_case", name: "VC-AAUTH-ENVELOPE CoworkerActionEnvelope", description: "Proves the human approved a destructive action before it ran (status reaches executed only via approved).", properties: det("apps/web/lib/coworker/envelope-state-machine.ts", { status: "active" }), verifies: ["req:REQ-AAUTH-3"] },
  { key: "vc:VC-AAUTH-RECEIPT", typeSlug: "verification_case", name: "VC-AAUTH-RECEIPT ToolExecutionReceipt", description: "Content-addressed (input fingerprint + output digest) proof for sandbox/test/ux executions.", properties: det("packages/db/prisma/schema.prisma#ToolExecutionReceipt", { status: "active" }), verifies: ["req:REQ-AAUTH-5"] },
  { key: "vc:VC-AAUTH-AUTHZLOG", typeSlug: "verification_case", name: "VC-AAUTH-AUTHZLOG AuthorizationDecisionLog", description: "Intended 'why-authorized' ledger linking the DelegationGrant/AuthorityBinding consulted + rationale. Table + FKs exist; runtime write-site UNCONFIRMED.", properties: arch({ status: "substrate-ahead-of-wiring", sourceKey: "packages/db/prisma/schema.prisma#AuthorizationDecisionLog" }), verifies: ["req:REQ-AAUTH-4"], gap: "No write-site for AuthorizationDecisionLog found in the governed-execute path during research; verify the runtime populates it before treating it as an active verification case." },
  { key: "vc:VC-AAUTH-TELEMETRY", typeSlug: "verification_case", name: "VC-AAUTH-TELEMETRY AdapterRunTelemetry", description: "Per-LLM-call telemetry proving the model stayed in bounds: policy-block/refusal status, invalid (fabricated) tool calls, capabilities used.", properties: det("packages/db/prisma/schema.prisma#AdapterRunTelemetry", { status: "active" }), verifies: ["req:REQ-AAUTH-5"] },
];

const CONSTRAINT_REFINES: Array<{ from: string; to: string }> = [
  { from: "con:CON-AAUTH-1", to: "req:REQ-AAUTH-4" },
];

const PACKAGE: ElementSeed = {
  key: "pkg",
  typeSlug: "package",
  name: "AI Agent Authority",
  description: "SysML v2 current-state view of how DPF AI coworkers acquire and exercise authority: identity → delegation → tool grants → runtime-scoped token → single enforcement gate → HITL approval → dual-principal audit.",
  properties: arch({ sysmlPackage: "PKG-AAUTH", catchUpView: "AI Agent Authority Model (spec §8 #3)" }),
};

const VIEW_NAME = "AI Agent Authority — Current State";

export async function seedEaSysmlAgentAuthority(): Promise<void> {
  const notation = await prisma.eaNotation.findUnique({ where: { slug: NOTATION_SLUG }, select: { id: true } });
  if (!notation) {
    console.warn(`Skipping AI Agent Authority view: notation "${NOTATION_SLUG}" not seeded`);
    return;
  }
  const notationId = notation.id;

  const typeSlugs = ["package", "requirement", "constraint", "part_definition", "verification_case"];
  const etId = new Map<string, string>();
  for (const slug of typeSlugs) {
    const et = await prisma.eaElementType.findUniqueOrThrow({ where: { notationId_slug: { notationId, slug } }, select: { id: true } });
    etId.set(slug, et.id);
  }
  const relSlugs = ["contains", "satisfies", "verifies", "refines"];
  const rtId = new Map<string, string>();
  for (const slug of relSlugs) {
    const rt = await prisma.eaRelationshipType.findUniqueOrThrow({ where: { notationId_slug: { notationId, slug } }, select: { id: true } });
    rtId.set(slug, rt.id);
  }

  const elementId = new Map<string, string>();
  async function upsertElement(seed: ElementSeed): Promise<string> {
    const infraCiKey = KEY(seed.key);
    const elementTypeId = etId.get(seed.typeSlug);
    if (!elementTypeId) throw new Error(`agent-authority seed: unknown sysml2 element type "${seed.typeSlug}"`);
    const data = {
      elementTypeId,
      name: seed.name,
      description: seed.description,
      properties: seed.properties ?? {},
      lifecycleStage: "production",
      lifecycleStatus: "active",
      infraCiKey,
    };
    const existing = await prisma.eaElement.findFirst({ where: { infraCiKey }, select: { id: true } });
    const row = existing
      ? await prisma.eaElement.update({ where: { id: existing.id }, data, select: { id: true } })
      : await prisma.eaElement.create({ data, select: { id: true } });
    elementId.set(seed.key, row.id);
    return row.id;
  }

  async function upsertRel(fromKey: string, toKey: string, relSlug: string): Promise<void> {
    const fromElementId = elementId.get(fromKey);
    const toElementId = elementId.get(toKey);
    const relationshipTypeId = rtId.get(relSlug);
    if (!fromElementId || !toElementId || !relationshipTypeId) {
      console.warn(`agent-authority seed: skipping rel ${fromKey} -[${relSlug}]-> ${toKey} (unresolved)`);
      return;
    }
    const existing = await prisma.eaRelationship.findFirst({ where: { fromElementId, toElementId, relationshipTypeId }, select: { id: true } });
    if (!existing) {
      await prisma.eaRelationship.create({ data: { fromElementId, toElementId, relationshipTypeId, notationSlug: NOTATION_SLUG, properties: {} } });
    }
  }

  // 1. Elements.
  await upsertElement(PACKAGE);
  for (const r of REQUIREMENTS) await upsertElement(r);
  for (const c of CONSTRAINTS) await upsertElement(c);
  for (const p of PARTS) await upsertElement(p);
  for (const v of VERIFICATIONS) await upsertElement(v);

  // 2. Relationships.
  for (const key of elementId.keys()) {
    if (key !== PACKAGE.key) await upsertRel(PACKAGE.key, key, "contains");
  }
  for (const p of PARTS) for (const reqKey of p.satisfies) await upsertRel(p.key, reqKey, "satisfies");
  for (const v of VERIFICATIONS) for (const reqKey of v.verifies) await upsertRel(v.key, reqKey, "verifies");
  for (const ref of CONSTRAINT_REFINES) await upsertRel(ref.from, ref.to, "refines");

  // 3. Conformance issue for the verification gap found during research.
  for (const v of VERIFICATIONS) {
    if (!v.gap) continue;
    const elId = elementId.get(v.key);
    if (!elId) continue;
    const existing = await prisma.eaConformanceIssue.findFirst({ where: { elementId: elId, issueType: "missing-verification-evidence" }, select: { id: true } });
    if (!existing) {
      await prisma.eaConformanceIssue.create({
        data: { elementId: elId, issueType: "missing-verification-evidence", severity: "warn", message: v.gap, status: "open" },
      });
    }
  }

  // 4. View under the "Systems Requirements & Verification" viewpoint.
  const viewpoint = await prisma.viewpointDefinition.findUnique({ where: { name: "Systems Requirements & Verification" }, select: { id: true } });
  let view = await prisma.eaView.findFirst({ where: { notationId, name: VIEW_NAME }, select: { id: true } });
  if (!view) {
    view = await prisma.eaView.create({
      data: {
        notationId, name: VIEW_NAME,
        description: "Current-state authority model: parts (identity→token), the invariants they satisfy, and the audit records that verify them.",
        layoutType: "graph", scopeType: "custom", scopeRef: "agent-authority",
        viewpointId: viewpoint?.id ?? null, status: "draft",
      },
      select: { id: true },
    });
  }
  for (const id of elementId.values()) {
    await prisma.eaViewElement.upsert({
      where: { viewId_elementId: { viewId: view.id, elementId: id } },
      update: {},
      create: { viewId: view.id, elementId: id, mode: "existing" },
    });
  }

  console.log(`Seeded AI Agent Authority SysML view: ${elementId.size} elements + view "${VIEW_NAME}"`);
}
