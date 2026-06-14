// packages/db/src/seed-ea-sysml-ai-cockpit.ts
// Seeds the "AI Cockpit & Model Routing" SysML v2 model as EA graph content
// (EaElement/EaRelationship + an EaView), making the architecture design queryable
// platform data rather than only a markdown doc.
//
// Companion human-readable model + traceability:
//   docs/architecture/2026-06-14-ai-cockpit-sysml-architecture-note.md
// Source design:
//   docs/architecture/2026-06-14-odysseus-review-depth-pass.md
//
// Requires the sysml2 notation (seed-ea-sysml2.ts) + its viewpoints
// (seed-ea-viewpoints.ts) to be seeded first; wired after eaViews in seed.ts.
//
// Idempotent: elements upsert by stable `infraCiKey`; relationships and view
// elements de-dupe on their natural keys. Substrate allocations are stored as
// element properties (allocatedTo) so the seed does not depend on specific
// ArchiMate instances existing.
//
// NOTE: per the SysML substrate spec, runtime/DB validation of this EA seed is the
// deferred follow-up thread. This module is unit-tested for idempotency with a
// mocked client; it is not asserted to have run against a live database here.

import { prisma } from "./client.js";
import type { Prisma } from "../generated/client/client";

const NOTATION_SLUG = "sysml2";
const KEY = (suffix: string) => `sysml:aic:${suffix}`;

type ElementSeed = {
  key: string;          // infraCiKey suffix (unique within this model)
  typeSlug: string;     // sysml2 element type slug
  name: string;
  description: string;
  properties?: Prisma.InputJsonValue;
};

// ── Requirements ────────────────────────────────────────────────────────────
const REQUIREMENTS: ElementSeed[] = [
  { key: "req:REQ-AIC-1", typeSlug: "requirement", name: "REQ-AIC-1 Use-case model routing", description: "Every LLM call is routed by use case (taskType) through a governed policy matrix, not a single global model setting.", properties: { status: "realized" } },
  { key: "req:REQ-AIC-2", typeSlug: "requirement", name: "REQ-AIC-2 Visible model receipt", description: "Each coworker turn exposes requested policy, actual responding model, and any fallback/escalation.", properties: { status: "planned" } },
  { key: "req:REQ-AIC-3", typeSlug: "requirement", name: "REQ-AIC-3 No silent frontier escalation for sensitive work", description: "Privacy-sensitive use cases must not silently escalate to a frontier/cloud model; escalation carries a reason code.", properties: { status: "planned" } },
  { key: "req:REQ-AIC-4", typeSlug: "requirement", name: "REQ-AIC-4 Fallback/escalation auditability", description: "Fallback and escalation are recorded as reason-coded evidence.", properties: { status: "partial" } },
  { key: "req:REQ-AIC-5", typeSlug: "requirement", name: "REQ-AIC-5 Email triage on the utility tier", description: "Inbound business-email triage routes to the utility tier (cheap/local-preferred, never frontier) and minimize-cost.", properties: { status: "realized" } },
  { key: "req:REQ-AIC-6", typeSlug: "requirement", name: "REQ-AIC-6 Inbound email to coworker routing", description: "A triaged email can be handed to the right coworker via the inbound→coworker contract (tasks/submit).", properties: { status: "planned" } },
  { key: "req:REQ-AIC-7", typeSlug: "requirement", name: "REQ-AIC-7 Draft-never-send", description: "Email replies are drafted and require human approval; never auto-sent.", properties: { status: "partial" } },
  { key: "req:REQ-AIC-8", typeSlug: "requirement", name: "REQ-AIC-8 Business-mailbox transport via OAuth", description: "Inbound business email is ingested via OAuth/provider-push (Graph/Gmail/Postmark), not stored passwords.", properties: { status: "planned" } },
  { key: "req:REQ-AIC-9", typeSlug: "requirement", name: "REQ-AIC-9 Durable thread governance metadata", description: "Coworker threads carry memoryMode, durable attachedSources, compactionState, and a decision link.", properties: { status: "planned" } },
];

// ── Constraint (parametric) ──────────────────────────────────────────────────
const CONSTRAINTS: ElementSeed[] = [
  { key: "con:CON-AIC-1", typeSlug: "constraint", name: "CON-AIC-1 Routing policy constraint", description: "Selected tier/residency/budget are a function of (sensitivity x residencyPolicy x budgetClass x minimumTier). email-* ⇒ tier=adequate (no frontier) + minimize_cost; confidential/restricted ⇒ no silent frontier escalation.", properties: { kind: "parametric" } },
];

// ── Part definitions (blocks) with substrate allocation ──────────────────────
const PARTS: Array<ElementSeed & { satisfies: string[] }> = [
  { key: "part:router",         typeSlug: "part_definition", name: "Routing Policy Engine",     description: "Capability-filters and cost-ranks endpoints; emits a route decision + fallback chain.", properties: { allocatedTo: "apps/web/lib/routing/pipeline-v2.ts" }, satisfies: ["req:REQ-AIC-1"] },
  { key: "part:contract",       typeSlug: "part_definition", name: "Request Contract Builder",  description: "Builds a RequestContract from taskType + the TaskRequirement posture defaults.", properties: { allocatedTo: "apps/web/lib/routing/request-contract.ts" }, satisfies: ["req:REQ-AIC-1", "req:REQ-AIC-5"] },
  { key: "part:matrix",         typeSlug: "part_definition", name: "Use-Case Policy Matrix",    description: "Per-task-type tier/budget/residency/reasoning defaults — the demand side of routing.", properties: { allocatedTo: "apps/web/lib/routing/task-requirements.ts" }, satisfies: ["req:REQ-AIC-1", "req:REQ-AIC-5"] },
  { key: "part:receipt",        typeSlug: "part_definition", name: "Turn Receipt View",         description: "Read-side join of RouteDecisionLog + RouteOutcome + AdapterRunTelemetry per turn.", properties: { allocatedTo: "RouteDecisionLog + RouteOutcome + AdapterRunTelemetry (view unbuilt)" }, satisfies: ["req:REQ-AIC-2", "req:REQ-AIC-4"] },
  { key: "part:reasoncodes",    typeSlug: "part_definition", name: "Reason Code Registry",      description: "Single registry of fallback + escalation reason codes (consolidation planned).", properties: { allocatedTo: "apps/web/lib/routing/reason-codes.ts (planned)" }, satisfies: ["req:REQ-AIC-3", "req:REQ-AIC-4"] },
  { key: "part:emailpipe",      typeSlug: "part_definition", name: "Inbound Email Pipeline",    description: "Pre-filter → classify → route/draft → human approval (generalized from marketing loop).", properties: { allocatedTo: "apps/web/lib/marketing/channels/email-postmark/responder.ts" }, satisfies: ["req:REQ-AIC-5", "req:REQ-AIC-6", "req:REQ-AIC-7"] },
  { key: "part:emailtransport", typeSlug: "part_definition", name: "Email Transport",           description: "Inbound business-email ingestion via OAuth/provider-push.", properties: { allocatedTo: "Postmark inbound webhook (built) + Graph/Gmail OAuth poller (planned)" }, satisfies: ["req:REQ-AIC-8"] },
  { key: "part:thread",         typeSlug: "part_definition", name: "Coworker Thread",           description: "Durable coworker work context; gains memoryMode/attachedSources/compactionState/decision link.", properties: { allocatedTo: "AgentThread (packages/db/prisma/schema.prisma)" }, satisfies: ["req:REQ-AIC-9"] },
  { key: "part:fabric",         typeSlug: "part_definition", name: "Communication Fabric",      description: "Multi-channel inbound→coworker routing (tasks/submit).", properties: { allocatedTo: "apps/web/lib/communications/* + fabric spec §14.4" }, satisfies: ["req:REQ-AIC-6"] },
];

// ── Interfaces ───────────────────────────────────────────────────────────────
const INTERFACES: ElementSeed[] = [
  { key: "if:routeandcall", typeSlug: "interface_definition", name: "routeAndCall()",        description: "Sole inference entry point: (messages, system, sensitivity, options{taskType,...}).", properties: { allocatedTo: "apps/web/lib/inference/routed-inference.ts", status: "realized" } },
  { key: "if:receipt",      typeSlug: "interface_definition", name: "ThreadTurnReceipt",      description: "Read contract joining the three routing telemetry tables for one turn.", properties: { status: "planned" } },
  { key: "if:tasksubmit",   typeSlug: "interface_definition", name: "tasks/submit",           description: "Inbound→coworker contract (Communication Fabric §14.4).", properties: { status: "planned" } },
  { key: "if:webhook",      typeSlug: "interface_definition", name: "inbound email webhook",  description: "/api/communications/<provider>/webhook ingestion endpoint.", properties: { status: "planned" } },
];

// ── Verification cases ───────────────────────────────────────────────────────
const VERIFICATIONS: Array<ElementSeed & { verifies: string[] }> = [
  { key: "vc:VC-AIC-E1",     typeSlug: "verification_case", name: "VC-AIC-E1 email triage pins to utility tier", description: "Asserts email-* requirements pin to adequate tier + minimize_cost.", properties: { evidence: "apps/web/lib/routing/task-requirements.email.test.ts", status: "green" }, verifies: ["req:REQ-AIC-5"] },
  { key: "vc:VC-AIC-MATRIX", typeSlug: "verification_case", name: "VC-AIC-MATRIX inferContract honours requirement posture", description: "Asserts inferContract applies budget/reasoning/residency defaults from the TaskRequirement.", properties: { evidence: "apps/web/lib/routing/request-contract.email.test.ts", status: "green" }, verifies: ["req:REQ-AIC-1"] },
  { key: "vc:VC-AIC-DRAFT",  typeSlug: "verification_case", name: "VC-AIC-DRAFT email replies require approval", description: "Asserts inbound replies are drafted with status pending-review (never auto-sent).", properties: { status: "planned" }, verifies: ["req:REQ-AIC-7"] },
  { key: "vc:VC-AIC-RECEIPT", typeSlug: "verification_case", name: "VC-AIC-RECEIPT turn receipt view", description: "Asserts the receipt join surfaces requested vs actual model + fallback.", properties: { status: "planned" }, verifies: ["req:REQ-AIC-2"] },
  { key: "vc:VC-AIC-THREAD", typeSlug: "verification_case", name: "VC-AIC-THREAD thread governance fields", description: "Asserts the four net-new thread fields/joins exist and are enforced.", properties: { status: "planned" }, verifies: ["req:REQ-AIC-9"] },
  { key: "vc:VC-AIC-TRANSPORT", typeSlug: "verification_case", name: "VC-AIC-TRANSPORT OAuth inbound transport", description: "Asserts OAuth/Graph/Gmail inbound ingestion works without stored passwords.", properties: { status: "planned" }, verifies: ["req:REQ-AIC-8"] },
];

// CON-AIC-1 refines these requirements.
const CONSTRAINT_REFINES: Array<{ from: string; to: string }> = [
  { from: "con:CON-AIC-1", to: "req:REQ-AIC-1" },
  { from: "con:CON-AIC-1", to: "req:REQ-AIC-3" },
  { from: "con:CON-AIC-1", to: "req:REQ-AIC-5" },
];

const PACKAGE: ElementSeed = {
  key: "pkg",
  typeSlug: "package",
  name: "AI Cockpit & Model Routing",
  description: "SysML v2 model package for the Odysseus-derived AI cockpit, use-case model routing, coworker thread receipts, and inbound business-email processing.",
  properties: { sysmlPackage: "PKG-AIC", design: "docs/architecture/2026-06-14-ai-cockpit-sysml-architecture-note.md" },
};

const VIEW_NAME = "AI Cockpit — Requirements & Verification";

export async function seedEaSysmlAiCockpit(): Promise<void> {
  const notation = await prisma.eaNotation.findUnique({ where: { slug: NOTATION_SLUG }, select: { id: true } });
  if (!notation) {
    console.warn(`Skipping AI-cockpit SysML model: notation "${NOTATION_SLUG}" not seeded`);
    return;
  }
  const notationId = notation.id;

  // Resolve element + relationship type ids for the slugs this model uses.
  const typeSlugs = ["package", "requirement", "constraint", "part_definition", "interface_definition", "verification_case"];
  const etId = new Map<string, string>();
  for (const slug of typeSlugs) {
    const et = await prisma.eaElementType.findUniqueOrThrow({
      where: { notationId_slug: { notationId, slug } },
      select: { id: true },
    });
    etId.set(slug, et.id);
  }
  const relSlugs = ["contains", "satisfies", "verifies", "refines"];
  const rtId = new Map<string, string>();
  for (const slug of relSlugs) {
    const rt = await prisma.eaRelationshipType.findUniqueOrThrow({
      where: { notationId_slug: { notationId, slug } },
      select: { id: true },
    });
    rtId.set(slug, rt.id);
  }

  // Upsert an element by infraCiKey (no natural unique key on EaElement).
  const elementId = new Map<string, string>(); // model key → EaElement.id
  async function upsertElement(seed: ElementSeed): Promise<string> {
    const infraCiKey = KEY(seed.key);
    const elementTypeId = etId.get(seed.typeSlug);
    if (!elementTypeId) throw new Error(`AI-cockpit seed: unknown sysml2 element type "${seed.typeSlug}"`);
    const data = {
      elementTypeId,
      name: seed.name,
      description: seed.description,
      properties: seed.properties ?? {},
      lifecycleStage: "design",
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

  // Upsert a relationship (no natural unique key on EaRelationship).
  async function upsertRel(fromKey: string, toKey: string, relSlug: string): Promise<void> {
    const fromElementId = elementId.get(fromKey);
    const toElementId = elementId.get(toKey);
    const relationshipTypeId = rtId.get(relSlug);
    if (!fromElementId || !toElementId || !relationshipTypeId) {
      console.warn(`AI-cockpit seed: skipping rel ${fromKey} -[${relSlug}]-> ${toKey} (unresolved)`);
      return;
    }
    const existing = await prisma.eaRelationship.findFirst({
      where: { fromElementId, toElementId, relationshipTypeId },
      select: { id: true },
    });
    if (!existing) {
      await prisma.eaRelationship.create({
        data: { fromElementId, toElementId, relationshipTypeId, notationSlug: NOTATION_SLUG, properties: {} },
      });
    }
  }

  // 1. Elements.
  await upsertElement(PACKAGE);
  for (const r of REQUIREMENTS) await upsertElement(r);
  for (const c of CONSTRAINTS) await upsertElement(c);
  for (const p of PARTS) await upsertElement(p);
  for (const i of INTERFACES) await upsertElement(i);
  for (const v of VERIFICATIONS) await upsertElement(v);
  const elementCount = elementId.size;

  // 2. Relationships.
  // package contains every other element.
  for (const key of elementId.keys()) {
    if (key !== PACKAGE.key) await upsertRel(PACKAGE.key, key, "contains");
  }
  // parts satisfy requirements.
  for (const p of PARTS) for (const reqKey of p.satisfies) await upsertRel(p.key, reqKey, "satisfies");
  // verification cases verify requirements.
  for (const v of VERIFICATIONS) for (const reqKey of v.verifies) await upsertRel(v.key, reqKey, "verifies");
  // constraint refines requirements.
  for (const ref of CONSTRAINT_REFINES) await upsertRel(ref.from, ref.to, "refines");

  // 3. View: place the model under the "Systems Requirements & Verification" viewpoint.
  const viewpoint = await prisma.viewpointDefinition.findUnique({
    where: { name: "Systems Requirements & Verification" },
    select: { id: true },
  });
  let view = await prisma.eaView.findFirst({
    where: { notationId, name: VIEW_NAME },
    select: { id: true },
  });
  if (!view) {
    view = await prisma.eaView.create({
      data: {
        notationId,
        name: VIEW_NAME,
        description: "Requirements, the parts that satisfy them, and the verification cases that prove them, for the AI Cockpit model.",
        layoutType: "graph",
        scopeType: "custom",
        scopeRef: "ai-cockpit",
        viewpointId: viewpoint?.id ?? null,
        status: "draft",
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

  console.log(`Seeded AI Cockpit SysML model: ${elementCount} elements + view "${VIEW_NAME}"`);
}
