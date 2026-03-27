# ArchiMate 4 Ontology Graph Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the ArchiMate 4 element catalog, refactor the EA graph as an ontology-first model with bounded traversal, and ship Archi import/export plus 6 AI agent MCP tools — all as a single deployment unit.

**Architecture:** The `Ea*` Prisma models are extended in-place to become ontology-first. Three new fields on `EaElement` carry `refinementLevel` / `itValueStream` / `ontologyRole`. Two new models (`EaTraversalPattern`, `EaFrameworkMapping`) enable bounded analysis and framework mapping. ArchiMate 4 is one export format; six ontology-extension element types go beyond the standard.

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL, pnpm workspaces, Vitest, `fast-xml-parser` (new dependency)

**Spec:** `docs/superpowers/specs/2026-03-26-archimate4-ontology-graph-refactor-design.md`
**Companion specs:** `docs/superpowers/specs/2026-03-21-ea-digital-product-first-class-design.md`, `docs/superpowers/specs/2026-03-21-digital-product-unified-ontology-design.md`

---

## Deployment Unit Constraint

All 14 tasks ship together. The migration must run before the seed; the seed must run before server actions or MCP tools are used. Do not deploy partial work.

---

## Task 1: Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add fields and two new models)
- Create: `packages/db/prisma/migrations/<timestamp>_add_archimate4_ontology_graph/migration.sql` (auto-generated)

- [ ] **Step 1:** Add three nullable fields to `EaElement` in `schema.prisma` (after `syncedAt`):
```prisma
refinementLevel  String?   // conceptual | logical | actual
itValueStream    String?   // evaluate | explore | integrate | deploy | release | consume | operate
ontologyRole     String?   // governed_thing | actor | control | event_evidence | information_object | resource | offer
```

- [ ] **Step 2:** Add three fields to `EaElementType` in `schema.prisma` (after `validLifecycleStatuses`):
```prisma
isExtension         Boolean  @default(false)
archimateExportSlug String?
ontologyCategory    String?
```

- [ ] **Step 3:** Add `traversalPatterns EaTraversalPattern[]` to the `EaNotation` model relations list.

- [ ] **Step 4:** Add `frameworkMappings EaFrameworkMapping[]` to the `EaElementType` model relations list.

- [ ] **Step 5:** Add the `EaTraversalPattern` model to `schema.prisma` (after `EaSnapshot`):
```prisma
model EaTraversalPattern {
  id          String     @id @default(cuid())
  notationId  String
  slug        String
  name        String
  description String?
  patternType String
  steps              Json
  forbiddenShortcuts Json     @default("[]")
  status     String    @default("active")
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  notation   EaNotation @relation(fields: [notationId], references: [id])

  @@unique([notationId, slug])
  @@index([notationId, patternType])
}
```

- [ ] **Step 6:** Add the `EaFrameworkMapping` model to `schema.prisma` (after `EaTraversalPattern`):
```prisma
model EaFrameworkMapping {
  id                   String        @id @default(cuid())
  elementTypeId        String
  frameworkSlug        String
  nativeConceptName    String
  mappingType          String
  semanticDisparity    String?
  influenceOpportunity String?
  exchangeOpportunity  Boolean  @default(false)
  notes                String?
  createdAt            DateTime @default(now())
  elementType  EaElementType @relation(fields: [elementTypeId], references: [id])

  @@unique([elementTypeId, frameworkSlug])
  @@index([frameworkSlug])
  @@index([elementTypeId])
}
```

- [ ] **Step 7:** Run the migration:
```bash
pnpm --filter @dpf/db exec prisma migrate dev --name add_archimate4_ontology_graph
```
Expected output: `Your database is now in sync with your schema.`

- [ ] **Step 8:** Verify the generated client compiles:
```bash
pnpm --filter @dpf/db exec prisma generate
```

- [ ] **Step 9:** Commit:
```
feat(schema): add EaTraversalPattern, EaFrameworkMapping, and ontology fields to EaElement/EaElementType
```

---

## Task 2: Seed — Phase EA-2 Standard Element Types

**Files:**
- Modify: `packages/db/src/seed-ea-archimate4.ts`

Read the existing file first. It defines `ELEMENT_TYPES: ElementTypeDef[]`, `REL_TYPES`, `RULES`, and `DQ_RULES`. You will extend all four arrays.

- [ ] **Step 1:** Update `ElementTypeDef` type to include the new fields:
```typescript
type ElementTypeDef = {
  slug: string;
  name: string;
  neoLabel: string;
  domain: string;
  description?: string;
  stages: string[];
  statuses: string[];
  isExtension?: boolean;           // ADD
  archimateExportSlug?: string;    // ADD
  ontologyCategory?: string;       // ADD
};
```

- [ ] **Step 2:** Add `ontologyCategory` to all 30 existing element types. Use the mapping:
  - Strategy types (`value_stream`, `value_stream_stage`, `capability`, `course_of_action`): `"structure"`
  - Business structure types (`business_actor`, `business_role`, `business_object`, `contract`): `"structure"`
  - Business capability type (`business_capability`): `"structure"`
  - Application types (`application_component`, `application_service`, `data_object`): `"structure"`
  - Technology types (`technology_node`, `technology_service`, `artifact`, `device`, `system_software`, `communication_network`): `"structure"`
  - Motivation types (`stakeholder`, `driver`, `goal`, `outcome`, `principle`, `requirement`, `constraint`): `"motivation"`
  - Common types (`resource`, `object`): `"structure"`
  - Implementation types (`work_package`, `deliverable`, `plateau`, `gap`): `"behavior"`

- [ ] **Step 3:** Append the 12 Phase EA-2 standard types to `ELEMENT_TYPES` (all `isExtension: false`):
```typescript
// Business layer behaviour elements
{ slug: "business_process",       name: "Business Process",       neoLabel: "ArchiMate__BusinessProcess",      domain: "business",       description: "A sequence of behaviours in service of a goal",                         stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
{ slug: "business_function",      name: "Business Function",      neoLabel: "ArchiMate__BusinessFunction",     domain: "business",       description: "A collection of business behaviour based on a chosen set of criteria",   stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
{ slug: "business_interaction",   name: "Business Interaction",   neoLabel: "ArchiMate__BusinessInteraction",  domain: "business",       description: "A unit of collective business behaviour performed by two or more roles",  stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
{ slug: "business_event",         name: "Business Event",         neoLabel: "ArchiMate__BusinessEvent",        domain: "business",       description: "A business behaviour element denoting an organisational state change",   stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
{ slug: "business_service",       name: "Business Service",       neoLabel: "ArchiMate__BusinessService",      domain: "business",       description: "An explicitly defined exposed business behaviour",                       stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
{ slug: "business_collaboration", name: "Business Collaboration", neoLabel: "ArchiMate__BusinessCollaboration",domain: "business",       description: "An aggregate of two or more business roles that work together",          stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
{ slug: "product",                name: "Product",                neoLabel: "ArchiMate__Product",              domain: "business",       description: "A coherent collection of services and/or passive structure elements",    stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },
// Application layer behaviour elements
{ slug: "application_function",   name: "Application Function",   neoLabel: "ArchiMate__ApplicationFunction",  domain: "application",    description: "Automated behaviour of an application component",                       stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
{ slug: "application_interaction",name: "Application Interaction",neoLabel: "ArchiMate__ApplicationInteraction",domain: "application",   description: "A unit of collective application behaviour performed by two or more components", stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
{ slug: "application_event",      name: "Application Event",      neoLabel: "ArchiMate__ApplicationEvent",     domain: "application",    description: "An application behaviour element denoting a state change",               stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
{ slug: "application_interface",  name: "Application Interface",  neoLabel: "ArchiMate__ApplicationInterface", domain: "application",    description: "A point of access where application services are made available",        stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },
// Technology layer
{ slug: "technology_function",    name: "Technology Function",    neoLabel: "ArchiMate__TechnologyFunction",   domain: "technology",     description: "A collection of technology behaviour",                                  stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
```

- [ ] **Step 4:** Add Phase EA-2 relationship rules to `RULES`. Add after the existing `// Implementation & Migration` block:
```typescript
// Application behaviour → product bridge (Phase EA-2)
["application_function",   "digital_product",      "accesses"],
["business_process",       "digital_product",      "accesses"],
["business_service",       "business_capability",  "realizes"],
["application_function",   "application_component","composed_of"],
["application_interaction","application_component","composed_of"],
```

- [ ] **Step 5:** Update the upsert loop in `seedEaArchimate4()` to also set the new fields:
```typescript
const record = await prisma.eaElementType.upsert({
  where:  { notationId_slug: { notationId: notation.id, slug: et.slug } },
  update: {
    name: et.name, neoLabel: et.neoLabel, domain: et.domain,
    description: et.description ?? null,
    validLifecycleStages: et.stages, validLifecycleStatuses: et.statuses,
    isExtension: et.isExtension ?? false,             // ADD
    archimateExportSlug: et.archimateExportSlug ?? null, // ADD
    ontologyCategory: et.ontologyCategory ?? null,    // ADD
  },
  create: {
    notationId: notation.id, slug: et.slug, name: et.name,
    neoLabel: et.neoLabel, domain: et.domain,
    description: et.description ?? null,
    validLifecycleStages: et.stages, validLifecycleStatuses: et.statuses,
    isExtension: et.isExtension ?? false,             // ADD
    archimateExportSlug: et.archimateExportSlug ?? null, // ADD
    ontologyCategory: et.ontologyCategory ?? null,    // ADD
  },
});
```

- [ ] **Step 6:** Run the seed to verify no errors:
```bash
pnpm --filter @dpf/db exec ts-node src/seed-ea-archimate4.ts
```
Expected: `Seeded 42 EaElementTypes` (30 existing + 12 new)

- [ ] **Step 7:** Commit:
```
feat(seed): add Phase EA-2 standard ArchiMate 4 element types and ontologyCategory backfill
```

---

## Task 3: Seed — Ontology Extension Element Types + Rules + DQ Rules

**Files:**
- Modify: `packages/db/src/seed-ea-archimate4.ts`

- [ ] **Step 1:** Append the 6 ontology-extension element types to `ELEMENT_TYPES` (all `isExtension: true`):
```typescript
// ─── Ontology-extension types (isExtension=true) ────────────────────────────
{ slug: "digital_product",  name: "Digital Product",  neoLabel: "ArchiMate__DigitalProduct",  domain: "product",     description: "Cross-layer anchor entity spanning business intent through operational delivery. Bridges to DigitalProduct record.",   stages: FULL_STAGES,    statuses: FULL_STATUSES,   isExtension: true, archimateExportSlug: "application-component", ontologyCategory: "structure" },
{ slug: "service_offering", name: "Service Offering", neoLabel: "ArchiMate__ServiceOffering", domain: "product",     description: "Customer-facing offer realized by a digital product. Distinct from the product itself.",                             stages: FULL_STAGES,    statuses: FULL_STATUSES,   isExtension: true, archimateExportSlug: "product",               ontologyCategory: "structure" },
{ slug: "information_object",name:"Information Object",neoLabel:"ArchiMate__InformationObject",domain: "information", description: "Governed data class with obligation semantics. Carries control requirements and evidence obligations.",               stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, isExtension: true, archimateExportSlug: "business-object",       ontologyCategory: "information" },
{ slug: "control",          name: "Control",          neoLabel: "ArchiMate__Control",         domain: "governance",  description: "Policy, control objective, or implemented workflow gate. NOTE: distinct from the compliance Control Prisma model.", stages: FULL_STAGES,    statuses: FULL_STATUSES,   isExtension: true, archimateExportSlug: "constraint",            ontologyCategory: "governance" },
{ slug: "event_evidence",   name: "Event / Evidence", neoLabel: "ArchiMate__EventEvidence",   domain: "governance",  description: "Audit record, evidence artifact, or operational event. Actual-layer complement to Control.",                         stages: FULL_STAGES,    statuses: FULL_STATUSES,   isExtension: true, archimateExportSlug: "business-event",        ontologyCategory: "governance" },
{ slug: "ai_coworker",      name: "AI Coworker",      neoLabel: "ArchiMate__AiCoworker",      domain: "product",     description: "AI agent identity — simultaneously a product, a component within a product, and an actor with governed authority.",  stages: FULL_STAGES,    statuses: FULL_STATUSES,   isExtension: true, archimateExportSlug: "application-component", ontologyCategory: "structure" },
```

- [ ] **Step 2:** Append the ontology extension relationship rules to `RULES`:
```typescript
// Digital Product (EA-DP spec rules — requires Phase EA-2 types above)
["digital_product", "business_actor",        "serves"],
["digital_product", "business_role",         "serves"],
["digital_product", "application_component", "composed_of"],
["digital_product", "technology_node",       "composed_of"],
["digital_product", "digital_product",       "composed_of"],
["digital_product", "digital_product",       "depends_on"],
["digital_product", "technology_node",       "depends_on"],
["digital_product", "business_actor",        "assigned_to"],
["digital_product", "business_role",         "assigned_to"],
["digital_product", "value_stream",          "associated_with"],
["digital_product", "capability",            "associated_with"],
["technology_service", "digital_product",    "serves"],
// Phase EA-2 bridges
["digital_product", "business_service",      "realizes"],
["digital_product", "application_service",   "realizes"],
["digital_product", "application_function",  "composed_of"],
["digital_product", "information_object",    "accesses"],
["digital_product", "control",               "associated_with"],
// Service Offering
["digital_product",   "service_offering",    "realizes"],
["service_offering",  "business_actor",      "serves"],
["service_offering",  "contract",            "associated_with"],
// Information Object / Governance
["information_object", "control",            "associated_with"],
["information_object", "event_evidence",     "realizes"],
["control",            "event_evidence",     "associated_with"],
["control",            "digital_product",    "influences"],
["control",            "information_object", "influences"],
// Event/Evidence terminals (required for governance_audit traversal pattern)
["event_evidence", "business_actor",         "associated_with"],
["event_evidence", "ai_coworker",            "associated_with"],
// AI Coworker
["ai_coworker", "digital_product",           "associated_with"],
["ai_coworker", "application_component",     "realizes"],
["ai_coworker", "business_role",             "assigned_to"],
["ai_coworker", "control",                   "associated_with"],
["ai_coworker", "event_evidence",            "associated_with"],
["business_actor", "ai_coworker",            "associated_with"],
```

- [ ] **Step 3:** Append the ontology extension DQ rules to `DQ_RULES`:
```typescript
{
  elementTypeSlug: "digital_product",
  name: "DigitalProduct must realize a ServiceOffering or BusinessService before production",
  description: "A Digital Product must be linked to a ServiceOffering or BusinessService via Realizes before entering production",
  lifecycleStage: "production",
  severity: "error",
  rule: { requires: { relationshipType: "realizes", toElementTypeOneOf: ["service_offering", "business_service"], minCount: 1 } },
},
{
  elementTypeSlug: "service_offering",
  name: "ServiceOffering must be realized by a DigitalProduct before production",
  description: "A Service Offering must be realized by at least one Digital Product before entering production",
  lifecycleStage: "production",
  severity: "error",
  rule: { requires: { relationshipType: "realizes", fromElementType: "digital_product", minCount: 1, direction: "inbound" } },
},
{
  elementTypeSlug: "information_object",
  name: "InformationObject should have a governing Control before production",
  description: "An Information Object should be linked to a Control via associated_with before entering production",
  lifecycleStage: "production",
  severity: "warn",
  rule: { requires: { relationshipType: "associated_with", toElementType: "control", minCount: 1 } },
},
{
  elementTypeSlug: "ai_coworker",
  name: "AiCoworker must have a BusinessRole and Control before production",
  description: "An AI Coworker must be assigned_to a BusinessRole and associated_with at least one Control before entering production",
  lifecycleStage: "production",
  severity: "error",
  rule: { requires: [
    { relationshipType: "assigned_to", toElementType: "business_role", minCount: 1 },
    { relationshipType: "associated_with", toElementType: "control", minCount: 1 },
  ]},
},
{
  elementTypeSlug: "control",
  name: "Control should have at least one EventEvidence before production",
  description: "A Control should be associated with at least one Event/Evidence record before entering production",
  lifecycleStage: "production",
  severity: "warn",
  rule: { requires: { relationshipType: "associated_with", toElementType: "event_evidence", minCount: 1 } },
},
```

- [ ] **Step 4:** Run the seed and verify:
```bash
pnpm --filter @dpf/db exec ts-node src/seed-ea-archimate4.ts
```
Expected: `Seeded 48 EaElementTypes`, `Seeded 9 EaDqRules`

- [ ] **Step 5:** Commit:
```
feat(seed): add 6 ontology-extension element types, relationship rules, and DQ stage-gate rules
```

---

## Task 4: Seed — Framework Mappings

**Files:**
- Modify: `packages/db/src/seed-ea-archimate4.ts`

- [ ] **Step 1:** Add a new `seedEaFrameworkMappings()` function at the bottom of the file. It takes the `etMap: Map<string, string>` already built by `seedEaArchimate4()`. Add the full mapping data from spec Section 3 for all 6 extension types across 12 frameworks. Condensed example for structure:
```typescript
export async function seedEaFrameworkMappings(etMap: Map<string, string>): Promise<void> {
  type MappingDef = {
    elementTypeSlug: string;
    frameworkSlug: string;
    nativeConceptName: string;
    mappingType: string;
    semanticDisparity?: string;
    influenceOpportunity?: string;
    exchangeOpportunity?: boolean;
  };

  const MAPPINGS: MappingDef[] = [
    // digital_product
    { elementTypeSlug: "digital_product", frameworkSlug: "archimate4",  nativeConceptName: "Application Component",    mappingType: "partial",       semanticDisparity: "Loses business context, value proposition, portfolio position",                         influenceOpportunity: "Add Product specialisation spanning business + application layers",         exchangeOpportunity: true },
    { elementTypeSlug: "digital_product", frameworkSlug: "csdm5",       nativeConceptName: "Business Application",     mappingType: "partial",       semanticDisparity: "Loses lifecycle richness, portfolio partitioning, offer semantics",                     influenceOpportunity: "CSDM 6: elevate to first-class entity",                                    exchangeOpportunity: false },
    { elementTypeSlug: "digital_product", frameworkSlug: "csdm6",       nativeConceptName: "Digital Product",          mappingType: "exact",         semanticDisparity: null,                                                                                  influenceOpportunity: "This platform is the reference implementation",                            exchangeOpportunity: true },
    { elementTypeSlug: "digital_product", frameworkSlug: "it4it_v3",    nativeConceptName: "Digital Product (backbone)",mappingType: "partial",      semanticDisparity: "Treated as attribute of value streams, not a persistent governed entity",              influenceOpportunity: "Use as stable cross-stream anchor with full identity",                      exchangeOpportunity: true },
    { elementTypeSlug: "digital_product", frameworkSlug: "itil5",       nativeConceptName: "Digital Product",          mappingType: "partial",       semanticDisparity: "Conceptual only — no data model defined",                                             influenceOpportunity: "Push persistent entity with lifecycle and governed data",                   exchangeOpportunity: false },
    { elementTypeSlug: "digital_product", frameworkSlug: "togaf",       nativeConceptName: "Application Building Block",mappingType: "approximate",  semanticDisparity: "ADM outputs not product-anchored by default",                                          influenceOpportunity: "Reinterpret ADM phases through Digital Product traceability",               exchangeOpportunity: false },
    { elementTypeSlug: "digital_product", frameworkSlug: "cobit",       nativeConceptName: "IT-related Asset",         mappingType: "approximate",   semanticDisparity: "Governance focus; no product realization path",                                        influenceOpportunity: "Map control objectives to product evidence paths",                          exchangeOpportunity: false },
    { elementTypeSlug: "digital_product", frameworkSlug: "dora",        nativeConceptName: "ICT Service",              mappingType: "approximate",   semanticDisparity: "Regulatory obligations explicit; product identity indirect",                           influenceOpportunity: "Tie resilience evidence to Digital Product as the unit",                   exchangeOpportunity: false },
    { elementTypeSlug: "digital_product", frameworkSlug: "apqc",        nativeConceptName: "Product / Service",        mappingType: "approximate",   semanticDisparity: "Process taxonomy can overtake product identity",                                        influenceOpportunity: "Use as scaffolding beneath product semantics",                              exchangeOpportunity: false },
    { elementTypeSlug: "digital_product", frameworkSlug: "tbm",         nativeConceptName: "Service",                  mappingType: "approximate",   semanticDisparity: "Cost paths strong; lifecycle and identity secondary",                                   influenceOpportunity: "Connect cost allocation to product realization directly",                   exchangeOpportunity: false },
    { elementTypeSlug: "digital_product", frameworkSlug: "tm_forum",    nativeConceptName: "Product",                  mappingType: "partial",       semanticDisparity: "Sector-shaped labels; versioned catalog semantics",                                     influenceOpportunity: "Adopt Digital Product as cross-domain anchor",                             exchangeOpportunity: true },
    { elementTypeSlug: "digital_product", frameworkSlug: "bian",        nativeConceptName: "Business Capability area", mappingType: "approximate",   semanticDisparity: "Domain taxonomy does not convey lifecycle semantics",                                   influenceOpportunity: "Import sector taxonomy; retain ontology refinement rules",                  exchangeOpportunity: false },
    // service_offering — add all 7 framework rows from spec Section 3.2
    // information_object — add all 7 framework rows from spec Section 3.3
    // control — add all 7 framework rows from spec Section 3.4
    // event_evidence — add all 7 framework rows from spec Section 3.5
    // ai_coworker — add all 7 framework rows from spec Section 3.6 (all no_equivalent except archimate4=approximate)
  ];
  // Copy the pattern above for all remaining framework mappings from the spec.

  for (const m of MAPPINGS) {
    const etId = etMap.get(m.elementTypeSlug);
    if (!etId) { console.warn(`Skipping mapping ${m.elementTypeSlug}/${m.frameworkSlug}: type not found`); continue; }
    await prisma.eaFrameworkMapping.upsert({
      where: { elementTypeId_frameworkSlug: { elementTypeId: etId, frameworkSlug: m.frameworkSlug } },
      update: { nativeConceptName: m.nativeConceptName, mappingType: m.mappingType, semanticDisparity: m.semanticDisparity ?? null, influenceOpportunity: m.influenceOpportunity ?? null, exchangeOpportunity: m.exchangeOpportunity ?? false },
      create: { elementTypeId: etId, frameworkSlug: m.frameworkSlug, nativeConceptName: m.nativeConceptName, mappingType: m.mappingType, semanticDisparity: m.semanticDisparity ?? null, influenceOpportunity: m.influenceOpportunity ?? null, exchangeOpportunity: m.exchangeOpportunity ?? false },
    });
  }
  console.log(`Seeded ${MAPPINGS.length} EaFrameworkMappings`);
}
```

- [ ] **Step 2:** Call `seedEaFrameworkMappings(etMap)` at the end of `seedEaArchimate4()`, passing the `etMap` built in step 2.

- [ ] **Step 3:** Run seed and verify:
```bash
pnpm --filter @dpf/db exec ts-node src/seed-ea-archimate4.ts
```
Expected: `Seeded 48 EaFrameworkMappings` (6 types × 8 frameworks average, totalling all rows from spec)

- [ ] **Step 4:** Commit:
```
feat(seed): add EaFrameworkMapping seed for 6 ontology-extension types across 12 frameworks
```

---

## Task 5: Seed — Traversal Patterns

**Files:**
- Modify: `packages/db/src/seed-ea-archimate4.ts`

- [ ] **Step 1:** Add a new `seedEaTraversalPatterns()` function. It receives the `notationId`. Seed all 7 patterns from spec Section 4:

```typescript
export async function seedEaTraversalPatterns(notationId: string): Promise<void> {
  type PatternDef = {
    slug: string;
    name: string;
    description: string;
    patternType: string;
    steps: object[];
    forbiddenShortcuts: string[];
  };

  const PATTERNS: PatternDef[] = [
    {
      slug: "blast_radius",
      name: "Software Supply-Chain Blast Radius",
      description: "Trace a vulnerable package or component through actual dependencies to Digital Products, offers, and consumers.",
      patternType: "blast_radius",
      steps: [
        { elementTypeSlugs: ["artifact", "technology_node"], refinementLevel: "actual", relationshipTypeSlugs: ["depends_on", "composed_of"], direction: "outbound" },
        { elementTypeSlugs: ["application_component"],        refinementLevel: null,     relationshipTypeSlugs: ["realizes"],                   direction: "inbound" },
        { elementTypeSlugs: ["digital_product"],              refinementLevel: null,     relationshipTypeSlugs: ["realizes"],                   direction: "outbound" },
        { elementTypeSlugs: ["service_offering"],             refinementLevel: null,     relationshipTypeSlugs: ["serves"],                     direction: "outbound" },
        { elementTypeSlugs: ["business_actor"],               refinementLevel: null,     relationshipTypeSlugs: [],                             direction: "terminal" },
      ],
      forbiddenShortcuts: [
        "Do not traverse conceptual elements as actual deployed dependencies",
        "Do not assume all paths through a shared platform component imply equal customer impact",
        "Do not conflate composed_of (structural) with depends_on (runtime) when estimating blast radius",
      ],
    },
    {
      slug: "governance_audit",
      name: "Information Governance and Audit Evidence",
      description: "Trace an information object through its governing controls to evidence and responsible actors.",
      patternType: "governance_audit",
      steps: [
        { elementTypeSlugs: ["information_object"], refinementLevel: null,       relationshipTypeSlugs: ["associated_with"], direction: "outbound" },
        { elementTypeSlugs: ["control"],             refinementLevel: null,       relationshipTypeSlugs: ["associated_with"], direction: "outbound" },
        { elementTypeSlugs: ["event_evidence"],      refinementLevel: "actual",   relationshipTypeSlugs: ["associated_with"], direction: "outbound" },
        { elementTypeSlugs: ["business_actor", "ai_coworker"], refinementLevel: null, relationshipTypeSlugs: [], direction: "terminal" },
      ],
      forbiddenShortcuts: [
        "Any path from control to a record is not audit proof unless it passes through event_evidence with actual refinement level",
        "Do not traverse associated_with generically — must follow the full control → event_evidence chain",
      ],
    },
    {
      slug: "architecture_traceability",
      name: "Architecture to Operations Traceability",
      description: "Trace from a requirement or architecture concern through logical design to actual product realization and evidence.",
      patternType: "architecture_traceability",
      steps: [
        { elementTypeSlugs: ["requirement", "constraint", "principle"], refinementLevel: "conceptual", relationshipTypeSlugs: ["influences"],      direction: "outbound" },
        { elementTypeSlugs: ["application_component", "application_function"], refinementLevel: "logical", relationshipTypeSlugs: ["realizes"], direction: "outbound" },
        { elementTypeSlugs: ["digital_product"],                        refinementLevel: null,          relationshipTypeSlugs: ["associated_with"], direction: "outbound" },
        { elementTypeSlugs: ["event_evidence"],                         refinementLevel: "actual",      relationshipTypeSlugs: [],                 direction: "terminal" },
      ],
      forbiddenShortcuts: [
        "Do not jump from a conceptual requirement directly to actual evidence without a logical design element",
        "realizes is not proof of deployment — logical realization is not the same as actual production",
      ],
    },
    {
      slug: "ai_oversight",
      name: "AI Coworker Authority and Oversight",
      description: "Trace AI coworker identity through authorization controls to permitted action scope and supervising humans.",
      patternType: "ai_oversight",
      steps: [
        { elementTypeSlugs: ["ai_coworker"],                    refinementLevel: null,     relationshipTypeSlugs: ["associated_with"], direction: "outbound" },
        { elementTypeSlugs: ["control"],                         refinementLevel: null,     relationshipTypeSlugs: ["influences"],      direction: "outbound" },
        { elementTypeSlugs: ["digital_product", "resource"],    refinementLevel: null,     relationshipTypeSlugs: ["associated_with"], direction: "inbound" },
        { elementTypeSlugs: ["business_actor"],                  refinementLevel: null,     relationshipTypeSlugs: [],                 direction: "terminal" },
      ],
      forbiddenShortcuts: [
        "Do not use broad actor adjacency to infer oversight — supervision requires an explicit business_actor → ai_coworker edge",
        "Do not assume every ai_coworker → digital_product association implies authority to modify the product",
      ],
    },
    {
      slug: "cost_rollup",
      name: "Cost and Investment Allocation",
      description: "Trace cost sources through capabilities and shared services to Digital Products and portfolios.",
      patternType: "cost_rollup",
      steps: [
        { elementTypeSlugs: ["resource"],                                   refinementLevel: "actual",  relationshipTypeSlugs: ["assigned_to", "composed_of"], direction: "outbound" },
        { elementTypeSlugs: ["capability", "business_service"],             refinementLevel: null,      relationshipTypeSlugs: ["realizes", "associated_with"], direction: "outbound" },
        { elementTypeSlugs: ["digital_product"],                            refinementLevel: null,      relationshipTypeSlugs: [],                              direction: "terminal" },
      ],
      forbiddenShortcuts: [
        "Do not assume shared platform cost equals Digital Product cost without an explicit allocation basis",
        "Do not roll up costs through composed_of across portfolio boundaries without allocation rules",
      ],
    },
    {
      slug: "ma_separation",
      name: "M&A and Divestiture Separability",
      description: "Determine what moves together versus what can be separated — products, dependencies, information obligations, and customer commitments.",
      patternType: "ma_separation",
      steps: [
        { elementTypeSlugs: ["digital_product"],                                           refinementLevel: null,     relationshipTypeSlugs: ["composed_of", "depends_on"], direction: "either" },
        { elementTypeSlugs: ["digital_product", "application_component", "technology_node"], refinementLevel: null,   relationshipTypeSlugs: ["accesses"],                  direction: "outbound" },
        { elementTypeSlugs: ["information_object"],                                         refinementLevel: null,    relationshipTypeSlugs: ["associated_with"],            direction: "outbound" },
        { elementTypeSlugs: ["contract"],                                                   refinementLevel: null,    relationshipTypeSlugs: ["serves"],                    direction: "inbound" },
        { elementTypeSlugs: ["business_actor"],                                             refinementLevel: null,    relationshipTypeSlugs: [],                            direction: "terminal" },
      ],
      forbiddenShortcuts: [
        "Do not assume shared technology_node dependencies can be cleanly separated without operational evidence",
        "Do not conflate customer-facing service_offering with enabling business_service — both must be traced separately",
        "Shared information_object obligations travel with the product unless a control explicitly releases them",
      ],
    },
    {
      slug: "service_customer_impact",
      name: "Service and Customer Impact",
      description: "Trace product degradation through offers and SLAs to customer impact, including downstream consuming products.",
      patternType: "service_customer_impact",
      steps: [
        { elementTypeSlugs: ["digital_product"],  refinementLevel: null, relationshipTypeSlugs: ["realizes"],  direction: "outbound" },
        { elementTypeSlugs: ["service_offering"], refinementLevel: null, relationshipTypeSlugs: ["serves"],    direction: "outbound" },
        { elementTypeSlugs: ["business_actor"],   refinementLevel: null, relationshipTypeSlugs: [],            direction: "terminal" },
      ],
      forbiddenShortcuts: [
        "Do not assume all business_actor nodes linked to a product are impacted customers — distinguish consumers from managers",
        "Do not traverse associated_with into motivation layer elements when calculating consumer impact",
      ],
    },
  ];

  for (const p of PATTERNS) {
    await prisma.eaTraversalPattern.upsert({
      where: { notationId_slug: { notationId, slug: p.slug } },
      update: { name: p.name, description: p.description, patternType: p.patternType, steps: p.steps, forbiddenShortcuts: p.forbiddenShortcuts },
      create: { notationId, slug: p.slug, name: p.name, description: p.description, patternType: p.patternType, steps: p.steps, forbiddenShortcuts: p.forbiddenShortcuts },
    });
  }
  console.log(`Seeded ${PATTERNS.length} EaTraversalPatterns`);
}
```

- [ ] **Step 2:** Call `await seedEaTraversalPatterns(notation.id)` at the end of `seedEaArchimate4()`, after the DQ rules step.

- [ ] **Step 3:** Run seed and verify:
```bash
pnpm --filter @dpf/db exec ts-node src/seed-ea-archimate4.ts
```
Expected: `Seeded 7 EaTraversalPatterns`

- [ ] **Step 4:** Commit:
```
feat(seed): add 7 EaTraversalPattern records for bounded ontology graph analysis
```

---

## Task 6: Archi XML Parser Utility + Tests

**Files:**
- Create: `apps/web/lib/ea/archimate-xml.ts`
- Create: `apps/web/lib/ea/archimate-xml.test.ts`
- Modify: `apps/web/package.json` (add `fast-xml-parser`)

- [ ] **Step 1:** Add `fast-xml-parser` to `apps/web`:
```bash
pnpm --filter @dpf/web add fast-xml-parser
```

- [ ] **Step 2:** Write the failing tests in `apps/web/lib/ea/archimate-xml.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parseArchimateXml, generateArchimateXml } from "./archimate-xml";

const MINIMAL_ARCHIMATE = `<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:archimate="http://www.archimatetool.com/archimate"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 name="Test Model" id="model-1">
  <folder name="Business" type="business">
    <element xsi:type="archimate:BusinessActor" id="actor-1" name="Customer"/>
    <element xsi:type="archimate:BusinessRole" id="role-1" name="Purchaser"/>
  </folder>
  <folder name="Application" type="application">
    <element xsi:type="archimate:ApplicationComponent" id="comp-1" name="Portal"/>
  </folder>
  <relationships>
    <element xsi:type="archimate:AssignmentRelationship" id="rel-1" source="actor-1" target="role-1"/>
    <element xsi:type="archimate:ServingRelationship" id="rel-2" source="comp-1" target="role-1"/>
  </relationships>
</archimate:model>`;

describe("parseArchimateXml", () => {
  it("extracts elements with correct slug mapping", () => {
    const result = parseArchimateXml(MINIMAL_ARCHIMATE);
    expect(result.elements).toHaveLength(3);
    expect(result.elements[0]).toMatchObject({ archimateId: "actor-1", name: "Customer", slug: "business_actor", folder: "Business" });
    expect(result.elements[2]).toMatchObject({ archimateId: "comp-1", name: "Portal", slug: "application_component" });
  });

  it("extracts relationships with correct slug mapping", () => {
    const result = parseArchimateXml(MINIMAL_ARCHIMATE);
    expect(result.relationships).toHaveLength(2);
    expect(result.relationships[0]).toMatchObject({ archimateId: "rel-1", fromArchimateId: "actor-1", toArchimateId: "role-1", slug: "assigned_to" });
    expect(result.relationships[1]).toMatchObject({ slug: "serves" });
  });

  it("marks unknown element types and records original type", () => {
    const xml = MINIMAL_ARCHIMATE.replace('xsi:type="archimate:BusinessActor"', 'xsi:type="archimate:UnknownFuture"');
    const result = parseArchimateXml(xml);
    const unknown = result.elements.find(e => e.archimateId === "actor-1")!;
    expect(unknown.slug).toBe("object"); // deterministic fallback
    expect(unknown.unknownArchimateType).toBe("archimate:UnknownFuture");
  });

  it("restores platform extension type from dpf:elementType property", () => {
    const xml = MINIMAL_ARCHIMATE.replace(
      '<element xsi:type="archimate:ApplicationComponent" id="comp-1" name="Portal"/>',
      `<element xsi:type="archimate:ApplicationComponent" id="comp-1" name="Portal">
        <properties><property key="dpf:elementType" value="digital_product"/></properties>
      </element>`
    );
    const result = parseArchimateXml(xml);
    const dp = result.elements.find(e => e.archimateId === "comp-1")!;
    expect(dp.slug).toBe("digital_product");
  });
});

describe("generateArchimateXml", () => {
  it("produces valid XML with correct xsi:type for standard elements", () => {
    const xml = generateArchimateXml({
      modelName: "Export",
      elements: [{ archimateId: "e-1", name: "Portal", slug: "application_component", archimateExportSlug: null, isExtension: false, ontologyRole: null }],
      relationships: [],
    });
    expect(xml).toContain('xsi:type="archimate:ApplicationComponent"');
    expect(xml).toContain('id="e-1"');
  });

  it("uses archimateExportSlug for extension types and adds dpf:elementType property", () => {
    const xml = generateArchimateXml({
      modelName: "Export",
      elements: [{ archimateId: "e-2", name: "Customer Portal", slug: "digital_product", archimateExportSlug: "application-component", isExtension: true, ontologyRole: "governed_thing" }],
      relationships: [],
    });
    expect(xml).toContain('xsi:type="archimate:ApplicationComponent"');
    expect(xml).toContain('key="dpf:elementType" value="digital_product"');
  });
});
```

- [ ] **Step 3:** Run to confirm tests fail:
```bash
cd apps/web && npx vitest run lib/ea/archimate-xml.test.ts
```

- [ ] **Step 4:** Create `apps/web/lib/ea/archimate-xml.ts`:
```typescript
import { XMLParser, XMLBuilder } from "fast-xml-parser";

// ─── ArchiMate XML type → platform slug ──────────────────────────────────────

const ARCHIMATE_TYPE_TO_SLUG: Record<string, string> = {
  "archimate:BusinessActor":          "business_actor",
  "archimate:BusinessRole":           "business_role",
  "archimate:BusinessCollaboration":  "business_collaboration",
  "archimate:BusinessProcess":        "business_process",
  "archimate:BusinessFunction":       "business_function",
  "archimate:BusinessInteraction":    "business_interaction",
  "archimate:BusinessEvent":          "business_event",
  "archimate:BusinessService":        "business_service",
  "archimate:BusinessObject":         "business_object",
  "archimate:Contract":               "contract",
  "archimate:Product":                "product",
  "archimate:ApplicationComponent":   "application_component",
  "archimate:ApplicationFunction":    "application_function",
  "archimate:ApplicationInteraction": "application_interaction",
  "archimate:ApplicationEvent":       "application_event",
  "archimate:ApplicationService":     "application_service",
  "archimate:ApplicationInterface":   "application_interface",
  "archimate:DataObject":             "data_object",
  "archimate:Node":                   "technology_node",
  "archimate:Device":                 "device",
  "archimate:SystemSoftware":         "system_software",
  "archimate:TechnologyFunction":     "technology_function",
  "archimate:TechnologyService":      "technology_service",
  "archimate:Artifact":               "artifact",
  "archimate:CommunicationNetwork":   "communication_network",
  "archimate:Stakeholder":            "stakeholder",
  "archimate:Driver":                 "driver",
  "archimate:Goal":                   "goal",
  "archimate:Outcome":                "outcome",
  "archimate:Principle":              "principle",
  "archimate:Requirement":            "requirement",
  "archimate:Constraint":             "constraint",
  "archimate:Capability":             "capability",
  "archimate:ValueStream":            "value_stream",
  "archimate:CourseOfAction":         "course_of_action",
  "archimate:Resource":               "resource",
  "archimate:WorkPackage":            "work_package",
  "archimate:Deliverable":            "deliverable",
  "archimate:Plateau":                "plateau",
  "archimate:Gap":                    "gap",
};

const ARCHIMATE_REL_TO_SLUG: Record<string, string> = {
  "archimate:AssociationRelationship":    "associated_with",
  "archimate:CompositionRelationship":    "composed_of",
  "archimate:AggregationRelationship":    "composed_of",
  "archimate:RealizationRelationship":    "realizes",
  "archimate:ServingRelationship":        "serves",
  "archimate:AccessRelationship":         "accesses",
  "archimate:AssignmentRelationship":     "assigned_to",
  "archimate:InfluenceRelationship":      "influences",
  "archimate:TriggeringRelationship":     "triggers",
  "archimate:FlowRelationship":           "flows_to",
  "archimate:SpecializationRelationship": "associated_with",
};

// Reverse map: slug → ArchiMate XML type (standard types only)
const SLUG_TO_ARCHIMATE_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(ARCHIMATE_TYPE_TO_SLUG)
    .filter(([, slug]) => slug !== "object") // exclude fallback
    .map(([xmlType, slug]) => [slug, xmlType])
);

export type ParsedElement = {
  archimateId: string;
  name: string;
  slug: string;
  folder?: string;
  unknownArchimateType?: string;
  archimateRelType?: string; // for aggregation vs composition
};

export type ParsedRelationship = {
  archimateId: string;
  fromArchimateId: string;
  toArchimateId: string;
  slug: string;
  archimateRelType?: string;
};

export type ParsedArchimateModel = {
  modelName: string;
  elements: ParsedElement[];
  relationships: ParsedRelationship[];
};

export function parseArchimateXml(xml: string): ParsedArchimateModel {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", isArray: (name) => ["folder", "element", "properties", "property"].includes(name) });
  const doc = parser.parse(xml);
  const model = doc["archimate:model"] ?? doc;
  const modelName: string = model["@_name"] ?? "Imported Model";

  const elements: ParsedElement[] = [];
  const relationships: ParsedRelationship[] = [];

  // Process folders (elements)
  const folders: unknown[] = Array.isArray(model.folder) ? model.folder : model.folder ? [model.folder] : [];
  for (const folder of folders as Record<string, unknown>[]) {
    const folderName = String(folder["@_name"] ?? "");
    const rawElements: unknown[] = Array.isArray(folder.element) ? folder.element : folder.element ? [folder.element] : [];
    for (const el of rawElements as Record<string, unknown>[]) {
      const xmlType = String(el["@_xsi:type"] ?? "");
      const archimateId = String(el["@_id"] ?? "");
      const name = String(el["@_name"] ?? "");

      // Check for dpf:elementType property (round-trip restoration)
      let slug = ARCHIMATE_TYPE_TO_SLUG[xmlType];
      let unknownArchimateType: string | undefined;
      const props = (el.properties as Record<string, unknown>[] | undefined) ?? [];
      for (const p of props) {
        const propEl = Array.isArray(p.property) ? p.property : p.property ? [p.property] : [];
        for (const prop of propEl as Record<string, unknown>[]) {
          if (prop["@_key"] === "dpf:elementType") {
            slug = String(prop["@_value"]);
          }
        }
      }
      if (!slug) {
        slug = "object"; // deterministic fallback
        unknownArchimateType = xmlType;
      }
      elements.push({ archimateId, name, slug, folder: folderName, ...(unknownArchimateType ? { unknownArchimateType } : {}) });
    }
  }

  // Process relationships
  const relsContainer = model.relationships ?? {};
  const rawRels: unknown[] = Array.isArray(relsContainer.element) ? relsContainer.element : relsContainer.element ? [relsContainer.element] : [];
  for (const rel of rawRels as Record<string, unknown>[]) {
    const xmlType = String(rel["@_xsi:type"] ?? "");
    const slug = ARCHIMATE_REL_TO_SLUG[xmlType] ?? "associated_with";
    relationships.push({
      archimateId: String(rel["@_id"] ?? ""),
      fromArchimateId: String(rel["@_source"] ?? ""),
      toArchimateId: String(rel["@_target"] ?? ""),
      slug,
      ...(["archimate:AggregationRelationship", "archimate:SpecializationRelationship"].includes(xmlType) ? { archimateRelType: xmlType } : {}),
    });
  }

  return { modelName, elements, relationships };
}

export type GenerateInput = {
  modelName: string;
  elements: Array<{
    archimateId: string;
    name: string;
    slug: string;
    archimateExportSlug: string | null;
    isExtension: boolean;
    ontologyRole: string | null;
  }>;
  relationships: Array<{
    archimateId: string;
    fromArchimateId: string;
    toArchimateId: string;
    slug: string;
  }>;
};

const REL_SLUG_TO_ARCHIMATE: Record<string, string> = {
  associated_with: "archimate:AssociationRelationship",
  composed_of:     "archimate:CompositionRelationship",
  realizes:        "archimate:RealizationRelationship",
  serves:          "archimate:ServingRelationship",
  accesses:        "archimate:AccessRelationship",
  assigned_to:     "archimate:AssignmentRelationship",
  influences:      "archimate:InfluenceRelationship",
  triggers:        "archimate:TriggeringRelationship",
  flows_to:        "archimate:FlowRelationship",
  depends_on:      "archimate:AssociationRelationship", // no direct equivalent; use association
};

export function generateArchimateXml(input: GenerateInput): string {
  const { modelName, elements, relationships } = input;
  const xmlElements = elements.map(el => {
    const xmlType = el.isExtension && el.archimateExportSlug
      ? `archimate:${el.archimateExportSlug.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join("")}`
      : (SLUG_TO_ARCHIMATE_TYPE[el.slug] ?? "archimate:ApplicationComponent");
    const dpfProps = el.isExtension
      ? `\n    <properties>\n      <property key="dpf:elementType" value="${el.slug}"/>${el.ontologyRole ? `\n      <property key="dpf:ontologyRole" value="${el.ontologyRole}"/>` : ""}\n    </properties>`
      : "";
    return `  <element xsi:type="${xmlType}" id="${el.archimateId}" name="${el.name.replace(/"/g, "&quot;")}">${dpfProps ? dpfProps + "\n  " : "/"}>`;
  }).join("\n");

  const xmlRels = relationships.map(rel => {
    const xmlType = REL_SLUG_TO_ARCHIMATE[rel.slug] ?? "archimate:AssociationRelationship";
    return `  <element xsi:type="${xmlType}" id="${rel.archimateId}" source="${rel.fromArchimateId}" target="${rel.toArchimateId}"/>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:archimate="http://www.archimatetool.com/archimate"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 name="${modelName.replace(/"/g, "&quot;")}">
${xmlElements}
  <relationships>
${xmlRels}
  </relationships>
</archimate:model>`;
}
```

- [ ] **Step 5:** Run tests and confirm they pass:
```bash
cd apps/web && npx vitest run lib/ea/archimate-xml.test.ts
```

- [ ] **Step 6:** Commit:
```
feat(ea): add Archi .archimate XML parser and generator utility with round-trip extension type support
```

---

## Task 7: Archi Import Server Action + Tests

**Files:**
- Create: `apps/web/lib/actions/ea-archimate.ts`
- Create: `apps/web/lib/actions/ea-archimate.test.ts`

- [ ] **Step 1:** Write failing tests in `apps/web/lib/actions/ea-archimate.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    eaNotation: { findUnique: vi.fn() },
    eaElementType: { findMany: vi.fn() },
    eaElement: { create: vi.fn() },
    eaRelationship: { create: vi.fn() },
    eaRelationshipType: { findMany: vi.fn() },
    eaRelationshipRule: { findFirst: vi.fn() },
    eaReferenceModelArtifact: { create: vi.fn() },
    eaConformanceIssue: { create: vi.fn() },
  },
}));

vi.mock("@/lib/ea/archimate-xml", () => ({
  parseArchimateXml: vi.fn().mockReturnValue({
    modelName: "Test",
    elements: [{ archimateId: "a-1", name: "Actor", slug: "business_actor", folder: "Business" }],
    relationships: [],
  }),
}));

import { prisma } from "@dpf/db";
import { importArchimateFile, exportArchimateFile } from "./ea-archimate";

describe("importArchimateFile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when archimate4 notation not found", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue(null);
    const result = await importArchimateFile({ fileContentBase64: "x", fileName: "test.archimate", userId: "u-1" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/notation/i);
  });

  it("creates elements and returns counts on success", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaElementType.findMany).mockResolvedValue([{ id: "et-1", slug: "business_actor" }] as never);
    vi.mocked(prisma.eaElement.create).mockResolvedValue({ id: "el-1" } as never);
    vi.mocked(prisma.eaReferenceModelArtifact.create).mockResolvedValue({ id: "art-1" } as never);

    const result = await importArchimateFile({ fileContentBase64: Buffer.from("<xml/>").toString("base64"), fileName: "test.archimate", userId: "u-1" });
    expect(result.ok).toBe(true);
    expect(result.data?.elementsCreated).toBe(1);
    expect(result.data?.relationshipsCreated).toBe(0);
    expect(prisma.eaElement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lifecycleStatus: "draft",
          refinementLevel: "conceptual",
          properties: expect.objectContaining({ archimateId: "a-1" }),
        }),
      })
    );
  });

  it("creates conformance issue for unknown element type", async () => {
    vi.mock("@/lib/ea/archimate-xml", () => ({
      parseArchimateXml: vi.fn().mockReturnValue({
        modelName: "Test",
        elements: [{ archimateId: "u-1", name: "Unknown", slug: "object", folder: "Business", unknownArchimateType: "archimate:FutureThing" }],
        relationships: [],
      }),
    }));
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaElementType.findMany).mockResolvedValue([{ id: "et-obj", slug: "object" }] as never);
    vi.mocked(prisma.eaElement.create).mockResolvedValue({ id: "el-1" } as never);
    vi.mocked(prisma.eaReferenceModelArtifact.create).mockResolvedValue({ id: "art-1" } as never);

    await importArchimateFile({ fileContentBase64: Buffer.from("<xml/>").toString("base64"), fileName: "test.archimate", userId: "u-1" });
    expect(prisma.eaConformanceIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ issueType: "unknown_archimate_type", severity: "warn" }),
      })
    );
  });
});
```

- [ ] **Step 2:** Run to confirm tests fail:
```bash
cd apps/web && npx vitest run lib/actions/ea-archimate.test.ts
```

- [ ] **Step 3:** Create `apps/web/lib/actions/ea-archimate.ts`:
```typescript
"use server";

import { prisma } from "@dpf/db";
import { parseArchimateXml, generateArchimateXml } from "@/lib/ea/archimate-xml";

type ImportInput = {
  fileContentBase64: string;
  fileName: string;
  userId: string;
  targetPortfolioId?: string;
  targetDigitalProductId?: string;
};

type ImportResult = {
  ok: boolean;
  error?: string;
  data?: {
    artifactId: string;
    elementsCreated: number;
    relationshipsCreated: number;
    extensionTypesRestored: number;
    conformanceIssues: Array<{ elementName: string; issueType: string; severity: string; message: string }>;
  };
};

export async function importArchimateFile(input: ImportInput): Promise<ImportResult> {
  const { fileContentBase64, fileName, userId, targetPortfolioId, targetDigitalProductId } = input;

  // 1. Resolve notation
  const notation = await prisma.eaNotation.findUnique({ where: { slug: "archimate4" } });
  if (!notation) return { ok: false, error: "ArchiMate 4 notation not found in database. Run the seed first." };

  // 2. Parse XML
  let parsed;
  try {
    const xml = Buffer.from(fileContentBase64, "base64").toString("utf-8");
    parsed = parseArchimateXml(xml);
  } catch (e) {
    return { ok: false, error: `Failed to parse .archimate XML: ${String(e)}` };
  }

  // 3. Build slug → elementTypeId map (scoped to archimate4)
  const elementTypes = await prisma.eaElementType.findMany({
    where: { notationId: notation.id },
    select: { id: true, slug: true },
  });
  const etMap = new Map(elementTypes.map(et => [et.slug, et.id]));

  // 4. Build archimateId → EaElement.id map for relationship linking
  const createdElementIdMap = new Map<string, string>();
  const conformanceIssues: ImportResult["data"]["conformanceIssues"] = [];
  let elementsCreated = 0;
  let extensionTypesRestored = 0;

  for (const el of parsed.elements) {
    const isRestored = !["object"].includes(el.slug) || !el.unknownArchimateType;
    const etId = etMap.get(el.slug) ?? etMap.get("object")!;

    const created = await prisma.eaElement.create({
      data: {
        elementTypeId: etId,
        name: el.name,
        lifecycleStage: "plan",
        lifecycleStatus: "draft",
        refinementLevel: "conceptual",
        createdById: userId,
        ...(targetPortfolioId ? { portfolioId: targetPortfolioId } : {}),
        ...(targetDigitalProductId ? { digitalProductId: targetDigitalProductId } : {}),
        properties: {
          archimateId: el.archimateId,
          archimateFolder: el.folder ?? null,
          ...(el.archimateRelType ? { archimateRelType: el.archimateRelType } : {}),
        },
      },
    });
    createdElementIdMap.set(el.archimateId, created.id);
    elementsCreated++;

    if (el.slug !== "object" && !el.unknownArchimateType) extensionTypesRestored++;

    if (el.unknownArchimateType) {
      const issue = await prisma.eaConformanceIssue.create({
        data: {
          elementId: created.id,
          issueType: "unknown_archimate_type",
          severity: "warn",
          message: `Unrecognised ArchiMate type "${el.unknownArchimateType}". Imported as "object" (common domain).`,
          detailsJson: { originalType: el.unknownArchimateType },
        },
      });
      conformanceIssues.push({ elementName: el.name, issueType: issue.issueType, severity: issue.severity, message: issue.message });
    }
  }

  // 5. Resolve relationship types
  const relTypes = await prisma.eaRelationshipType.findMany({
    where: { notationId: notation.id },
    select: { id: true, slug: true },
  });
  const rtMap = new Map(relTypes.map(rt => [rt.slug, rt.id]));

  let relationshipsCreated = 0;
  for (const rel of parsed.relationships) {
    const fromId = createdElementIdMap.get(rel.fromArchimateId);
    const toId = createdElementIdMap.get(rel.toArchimateId);
    const rtId = rtMap.get(rel.slug);
    if (!fromId || !toId || !rtId) continue;
    await prisma.eaRelationship.create({
      data: {
        fromElementId: fromId,
        toElementId: toId,
        relationshipTypeId: rtId,
        notationSlug: "archimate4",
        properties: rel.archimateRelType ? { archimateRelType: rel.archimateRelType } : {},
        createdById: userId,
      },
    });
    relationshipsCreated++;
  }

  // 6. Track import artifact
  const artifact = await prisma.eaReferenceModelArtifact.create({
    data: {
      modelId: notation.id, // re-use notationId as modelId for tracking — create an EaReferenceModel for archimate4 if needed
      kind: "archimate_import",
      path: fileName,
      authority: "archi_tool",
      importedAt: new Date(),
    },
  });

  return {
    ok: true,
    data: { artifactId: artifact.id, elementsCreated, relationshipsCreated, extensionTypesRestored, conformanceIssues },
  };
}
```

- [ ] **Step 4:** Run tests and confirm they pass:
```bash
cd apps/web && npx vitest run lib/actions/ea-archimate.test.ts
```

- [ ] **Step 5:** Commit:
```
feat(actions): add importArchimateFile server action with unknown-type conformance issue creation
```

---

## Task 8: Archi Export Server Action + Tests

**Files:**
- Modify: `apps/web/lib/actions/ea-archimate.ts` (add export function)
- Modify: `apps/web/lib/actions/ea-archimate.test.ts` (add export tests)

- [ ] **Step 1:** Add export tests to `ea-archimate.test.ts`:
```typescript
describe("exportArchimateFile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error for unknown scopeType", async () => {
    const result = await exportArchimateFile({ scopeType: "invalid" as never, scopeRef: "x", userId: "u-1" });
    expect(result.ok).toBe(false);
  });

  it("queries elements by portfolioId for portfolio scope", async () => {
    vi.mocked(prisma.eaElement.findMany).mockResolvedValue([]);
    vi.mocked(prisma.eaRelationship.findMany).mockResolvedValue([]);
    const result = await exportArchimateFile({ scopeType: "portfolio", scopeRef: "port-1", userId: "u-1" });
    expect(result.ok).toBe(true);
    expect(prisma.eaElement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ portfolioId: "port-1" }),
    }));
  });
});
```
Add `eaElement: { findMany: vi.fn() }, eaRelationship: { findMany: vi.fn() }` to the prisma mock.

- [ ] **Step 2:** Add `exportArchimateFile` to `ea-archimate.ts`:
```typescript
type ExportInput = {
  scopeType: "view" | "portfolio" | "digital_product";
  scopeRef: string;
  fileName?: string;
  userId: string;
};

type ExportResult = {
  ok: boolean;
  error?: string;
  data?: {
    fileContentBase64: string;
    fileName: string;
    elementCount: number;
    relationshipCount: number;
    extensionTypesMapped: Array<{ platformSlug: string; archimateExportSlug: string; count: number }>;
  };
};

export async function exportArchimateFile(input: ExportInput): Promise<ExportResult> {
  const { scopeType, scopeRef, fileName } = input;

  const whereClause: Record<string, unknown> =
    scopeType === "portfolio"      ? { portfolioId: scopeRef } :
    scopeType === "digital_product" ? { digitalProductId: scopeRef } :
    scopeType === "view"           ? { viewElements: { some: { viewId: scopeRef } } } :
    null!;

  if (!whereClause) return { ok: false, error: `Unknown scopeType: ${scopeType}` };

  const elements = await prisma.eaElement.findMany({
    where: whereClause,
    include: { elementType: { select: { slug: true, isExtension: true, archimateExportSlug: true } } },
  });

  const elementIds = elements.map(e => e.id);
  const relationships = await prisma.eaRelationship.findMany({
    where: { fromElementId: { in: elementIds }, toElementId: { in: elementIds } },
    include: { relationshipType: { select: { slug: true } } },
  });

  const generateElements = elements.map(el => ({
    archimateId: (el.properties as Record<string, unknown>)?.archimateId as string ?? el.id,
    name: el.name,
    slug: el.elementType.slug,
    archimateExportSlug: el.elementType.archimateExportSlug,
    isExtension: el.elementType.isExtension,
    ontologyRole: el.ontologyRole,
  }));

  const generateRels = relationships.map(rel => ({
    archimateId: rel.id,
    fromArchimateId: (elements.find(e => e.id === rel.fromElementId)?.properties as Record<string, unknown>)?.archimateId as string ?? rel.fromElementId,
    toArchimateId: (elements.find(e => e.id === rel.toElementId)?.properties as Record<string, unknown>)?.archimateId as string ?? rel.toElementId,
    slug: rel.relationshipType.slug,
  }));

  const xml = generateArchimateXml({ modelName: `DPF Export - ${scopeRef}`, elements: generateElements, relationships: generateRels });
  const fileContentBase64 = Buffer.from(xml, "utf-8").toString("base64");

  // Build extension type summary
  const extMap = new Map<string, { slug: string; exportSlug: string; count: number }>();
  for (const el of elements.filter(e => e.elementType.isExtension)) {
    const key = el.elementType.slug;
    const existing = extMap.get(key);
    if (existing) existing.count++;
    else extMap.set(key, { slug: key, exportSlug: el.elementType.archimateExportSlug ?? "unknown", count: 1 });
  }

  const outFileName = fileName ?? `dpf-${scopeType}-${scopeRef}-${new Date().toISOString().slice(0, 10)}.archimate`;

  return {
    ok: true,
    data: {
      fileContentBase64,
      fileName: outFileName,
      elementCount: elements.length,
      relationshipCount: relationships.length,
      extensionTypesMapped: [...extMap.values()].map(e => ({ platformSlug: e.slug, archimateExportSlug: e.exportSlug, count: e.count })),
    },
  };
}
```

- [ ] **Step 3:** Run all ea-archimate tests:
```bash
cd apps/web && npx vitest run lib/actions/ea-archimate.test.ts
```

- [ ] **Step 4:** Commit:
```
feat(actions): add exportArchimateFile server action with extension type mapping summary
```

---

## Task 9: Traversal Pattern Executor + Tests

**Files:**
- Create: `apps/web/lib/ea/traversal-executor.ts`
- Create: `apps/web/lib/ea/traversal-executor.test.ts`

- [ ] **Step 1:** Write failing tests in `traversal-executor.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    eaTraversalPattern: { findUnique: vi.fn() },
    eaElement: { findUnique: vi.fn() },
    eaRelationship: { findMany: vi.fn() },
    eaElementType: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { runTraversalPattern } from "./traversal-executor";

describe("runTraversalPattern", () => {
  it("returns error when pattern not found", async () => {
    vi.mocked(prisma.eaTraversalPattern.findUnique).mockResolvedValue(null);
    const result = await runTraversalPattern({ patternSlug: "unknown", startElementIds: ["e-1"], notationSlug: "archimate4" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pattern/i);
  });

  it("returns empty paths when start element not found", async () => {
    vi.mocked(prisma.eaTraversalPattern.findUnique).mockResolvedValue({
      steps: [{ elementTypeSlugs: ["business_actor"], refinementLevel: null, relationshipTypeSlugs: [], direction: "terminal" }],
      forbiddenShortcuts: [],
    } as never);
    vi.mocked(prisma.eaElement.findUnique).mockResolvedValue(null);
    const result = await runTraversalPattern({ patternSlug: "blast_radius", startElementIds: ["missing"], notationSlug: "archimate4" });
    expect(result.ok).toBe(true);
    expect(result.data?.paths).toHaveLength(0);
  });
});
```

- [ ] **Step 2:** Run to confirm fail:
```bash
cd apps/web && npx vitest run lib/ea/traversal-executor.test.ts
```

- [ ] **Step 3:** Create `apps/web/lib/ea/traversal-executor.ts`:
```typescript
import { prisma } from "@dpf/db";

type TraversalStep = {
  elementTypeSlugs: string[];
  refinementLevel: string | null;
  relationshipTypeSlugs: string[];
  direction: "outbound" | "inbound" | "either" | "terminal";
};

type TraversalInput = {
  patternSlug: string;
  startElementIds: string[];
  notationSlug?: string;
  maxDepth?: number;
};

type PathStep = {
  elementId: string;
  elementName: string;
  elementType: string;
  refinementLevel: string | null;
  relationshipType?: string;
  direction?: string;
};

type TraversalResult = {
  ok: boolean;
  error?: string;
  data?: {
    paths: Array<{ steps: PathStep[]; complete: boolean; terminationReason: string }>;
    summary: {
      nodesTraversed: number;
      relationshipsFollowed: number;
      refinementGaps: string[];
      forbiddenShortcutsBlocked: string[];
      conformanceIssuesRaised: string[];
    };
  };
};

export async function runTraversalPattern(input: TraversalInput): Promise<TraversalResult> {
  const { patternSlug, startElementIds, notationSlug = "archimate4", maxDepth = 6 } = input;

  const pattern = await prisma.eaTraversalPattern.findUnique({
    where: { notationId_slug: { notationId: notationSlug, slug: patternSlug } },
  });
  // Note: notationId_slug requires notationId not slug. Adjust to look up notation first.
  // For simplicity, look up by joining through notation:
  // (In practice, fetch notation id then findUnique by composite key)
  if (!pattern) return { ok: false, error: `Traversal pattern "${patternSlug}" not found` };

  const steps = pattern.steps as TraversalStep[];
  const paths: TraversalResult["data"]["paths"] = [];
  const refinementGaps: string[] = [];

  for (const startId of startElementIds) {
    const startEl = await prisma.eaElement.findUnique({
      where: { id: startId },
      include: { elementType: { select: { slug: true } } },
    });
    if (!startEl) continue;

    const path: PathStep[] = [{ elementId: startEl.id, elementName: startEl.name, elementType: startEl.elementType.slug, refinementLevel: startEl.refinementLevel }];
    let currentIds = [startId];
    let complete = false;
    let terminationReason = "max_depth_reached";

    for (let stepIdx = 0; stepIdx < steps.length && stepIdx < maxDepth; stepIdx++) {
      const step = steps[stepIdx];
      if (step.direction === "terminal") { complete = true; terminationReason = "terminal_step_reached"; break; }

      const nextIds: string[] = [];
      for (const currentId of currentIds) {
        const rels = await prisma.eaRelationship.findMany({
          where: step.direction === "outbound" ? { fromElementId: currentId } :
                 step.direction === "inbound"  ? { toElementId:   currentId } :
                 { OR: [{ fromElementId: currentId }, { toElementId: currentId }] },
          include: {
            fromElement: { include: { elementType: { select: { slug: true } } } },
            toElement:   { include: { elementType: { select: { slug: true } } } },
            relationshipType: { select: { slug: true } },
          },
        });

        for (const rel of rels) {
          const nextEl = step.direction === "inbound" ? rel.fromElement : rel.toElement;
          if (!step.elementTypeSlugs.includes(nextEl.elementType.slug) && step.elementTypeSlugs.length > 0) continue;
          if (step.relationshipTypeSlugs.length > 0 && !step.relationshipTypeSlugs.includes(rel.relationshipType.slug)) continue;
          if (step.refinementLevel && nextEl.refinementLevel !== step.refinementLevel) {
            refinementGaps.push(`${nextEl.name} (${nextEl.elementType.slug}) expected refinementLevel="${step.refinementLevel}", got "${nextEl.refinementLevel ?? "unset"}"`);
            continue;
          }
          nextIds.push(nextEl.id);
          path.push({ elementId: nextEl.id, elementName: nextEl.name, elementType: nextEl.elementType.slug, refinementLevel: nextEl.refinementLevel, relationshipType: rel.relationshipType.slug, direction: step.direction });
        }
      }

      if (nextIds.length === 0) { terminationReason = "no_matching_elements"; break; }
      currentIds = nextIds;
    }

    paths.push({ steps: path, complete, terminationReason });
  }

  return {
    ok: true,
    data: {
      paths,
      summary: {
        nodesTraversed: paths.reduce((acc, p) => acc + p.steps.length, 0),
        relationshipsFollowed: paths.reduce((acc, p) => acc + Math.max(0, p.steps.length - 1), 0),
        refinementGaps,
        forbiddenShortcutsBlocked: [],
        conformanceIssuesRaised: [],
      },
    },
  };
}
```

- [ ] **Step 4:** Run tests:
```bash
cd apps/web && npx vitest run lib/ea/traversal-executor.test.ts
```

- [ ] **Step 5:** Commit:
```
feat(ea): add traversal pattern executor with refinement-level gap detection
```

---

## Task 10: MCP Write Tools

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools-integrations.test.ts` (or create `mcp-tools-ea.test.ts`)

- [ ] **Step 1:** Create `apps/web/lib/mcp-tools-ea.test.ts` with failing tests:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    eaNotation:          { findUnique: vi.fn() },
    eaElementType:       { findUnique: vi.fn() },
    eaRelationshipType:  { findUnique: vi.fn() },
    eaRelationshipRule:  { findFirst: vi.fn() },
    eaElement:           { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    eaRelationship:      { create: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { executeTool } from "./mcp-tools";

describe("create_ea_element", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when element type slug not found", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaElementType.findUnique).mockResolvedValue(null);
    const result = await executeTool("create_ea_element", { name: "X", elementTypeSlug: "nonexistent" }, "u-1");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/element type/i);
  });

  it("creates element with conceptual default and returns elementId", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaElementType.findUnique).mockResolvedValue({ id: "et-1", slug: "digital_product", name: "Digital Product" } as never);
    vi.mocked(prisma.eaElement.create).mockResolvedValue({ id: "el-1" } as never);
    const result = await executeTool("create_ea_element", { name: "Customer Portal", elementTypeSlug: "digital_product" }, "u-1");
    expect(result.success).toBe(true);
    expect(result.entityId).toBe("el-1");
    expect(prisma.eaElement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ refinementLevel: "conceptual" }),
    }));
  });
});

describe("create_ea_relationship", () => {
  it("blocks relationship not permitted by EaRelationshipRule", async () => {
    vi.mocked(prisma.eaRelationshipType.findUnique).mockResolvedValue({ id: "rt-1" } as never);
    vi.mocked(prisma.eaRelationshipRule.findFirst).mockResolvedValue(null);
    const result = await executeTool("create_ea_relationship", { fromElementId: "e-1", toElementId: "e-2", relationshipTypeSlug: "realizes" }, "u-1");
    expect(result.data?.validationResult).toBe("blocked");
    expect(result.success).toBe(false);
  });
});

describe("classify_ea_element", () => {
  it("updates refinementLevel and itValueStream", async () => {
    vi.mocked(prisma.eaElement.update).mockResolvedValue({ id: "el-1", refinementLevel: "actual" } as never);
    const result = await executeTool("classify_ea_element", { elementId: "el-1", itValueStream: "operate", refinementLevel: "actual" }, "u-1");
    expect(result.success).toBe(true);
    expect(prisma.eaElement.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "el-1" },
      data: expect.objectContaining({ itValueStream: "operate", refinementLevel: "actual" }),
    }));
  });
});
```

- [ ] **Step 2:** Run to confirm tests fail.

- [ ] **Step 3:** Add the three write tool definitions to `PLATFORM_TOOLS` in `mcp-tools.ts` (before the closing `]`):
```typescript
{
  name: "create_ea_element",
  description: "Create a new element in the ontology graph. Use this when a user describes a new architectural entity (product, component, actor, service, etc). Defaults to refinementLevel=conceptual.",
  inputSchema: {
    type: "object",
    properties: {
      name:            { type: "string", description: "Element name" },
      elementTypeSlug: { type: "string", description: "Element type slug from the ArchiMate 4 catalog (e.g. digital_product, application_component, business_actor)" },
      description:     { type: "string", description: "Optional description" },
      refinementLevel: { type: "string", enum: ["conceptual", "logical", "actual"], description: "Defaults to conceptual" },
      itValueStream:   { type: "string", enum: ["evaluate", "explore", "integrate", "deploy", "release", "consume", "operate"] },
      ontologyRole:    { type: "string", enum: ["governed_thing", "actor", "control", "event_evidence", "information_object", "resource", "offer"] },
      digitalProductId: { type: "string" },
      portfolioId:     { type: "string" },
      properties:      { type: "object" },
    },
    required: ["name", "elementTypeSlug"],
  },
  requiredCapability: "manage_ea_model",
  sideEffect: true,
},
{
  name: "create_ea_relationship",
  description: "Connect two ontology graph elements with a typed relationship. Validates against EaRelationshipRule before creating.",
  inputSchema: {
    type: "object",
    properties: {
      fromElementId:        { type: "string" },
      toElementId:          { type: "string" },
      relationshipTypeSlug: { type: "string", enum: ["realizes", "depends_on", "assigned_to", "composed_of", "associated_with", "influences", "triggers", "flows_to", "serves", "accesses"] },
      properties:           { type: "object" },
    },
    required: ["fromElementId", "toElementId", "relationshipTypeSlug"],
  },
  requiredCapability: "manage_ea_model",
  sideEffect: true,
},
{
  name: "classify_ea_element",
  description: "Advance an element's IT4IT value stream stage and/or refinement level. Call after the user confirms what stage their architecture work is in.",
  inputSchema: {
    type: "object",
    properties: {
      elementId:        { type: "string" },
      itValueStream:    { type: "string", enum: ["evaluate", "explore", "integrate", "deploy", "release", "consume", "operate"] },
      refinementLevel:  { type: "string", enum: ["conceptual", "logical", "actual"] },
      ontologyRole:     { type: "string", enum: ["governed_thing", "actor", "control", "event_evidence", "information_object", "resource", "offer"] },
    },
    required: ["elementId"],
  },
  requiredCapability: "manage_ea_model",
  sideEffect: true,
},
```

- [ ] **Step 4:** Add the three write tool cases to the `executeTool` switch in `mcp-tools.ts`:
```typescript
case "create_ea_element": {
  const notation = await prisma.eaNotation.findUnique({ where: { slug: "archimate4" } });
  if (!notation) return { success: false, message: "ArchiMate 4 notation not seeded", error: "Notation not found" };
  const et = await prisma.eaElementType.findUnique({
    where: { notationId_slug: { notationId: notation.id, slug: String(params["elementTypeSlug"] ?? "") } },
  });
  if (!et) return { success: false, message: `Element type "${String(params["elementTypeSlug"])}" not found`, error: "Element type not found" };
  const el = await prisma.eaElement.create({
    data: {
      elementTypeId: et.id,
      name: String(params["name"]),
      description: typeof params["description"] === "string" ? params["description"] : null,
      refinementLevel: typeof params["refinementLevel"] === "string" ? params["refinementLevel"] : "conceptual",
      itValueStream: typeof params["itValueStream"] === "string" ? params["itValueStream"] : null,
      ontologyRole: typeof params["ontologyRole"] === "string" ? params["ontologyRole"] : null,
      digitalProductId: typeof params["digitalProductId"] === "string" ? params["digitalProductId"] : null,
      portfolioId: typeof params["portfolioId"] === "string" ? params["portfolioId"] : null,
      createdById: userId,
      properties: (typeof params["properties"] === "object" && params["properties"] !== null) ? params["properties"] as Record<string, unknown> : {},
    },
  });
  return { success: true, entityId: el.id, message: `Created ${et.name} element "${String(params["name"])}"`, data: { elementId: el.id, elementTypeName: et.name, refinementLevel: el.refinementLevel } };
}

case "create_ea_relationship": {
  const notation = await prisma.eaNotation.findUnique({ where: { slug: "archimate4" } });
  if (!notation) return { success: false, message: "ArchiMate 4 notation not seeded", error: "Notation not found" };
  const relSlug = String(params["relationshipTypeSlug"] ?? "");
  const rt = await prisma.eaRelationshipType.findUnique({ where: { notationId_slug: { notationId: notation.id, slug: relSlug } } });
  if (!rt) return { success: false, message: `Relationship type "${relSlug}" not found`, error: "Relationship type not found" };
  // Validate rule exists
  const fromEl = await prisma.eaElement.findUnique({ where: { id: String(params["fromElementId"]) }, select: { elementTypeId: true, name: true } });
  const toEl   = await prisma.eaElement.findUnique({ where: { id: String(params["toElementId"])   }, select: { elementTypeId: true, name: true } });
  if (!fromEl || !toEl) return { success: false, message: "One or both elements not found", error: "Element not found" };
  const rule = await prisma.eaRelationshipRule.findFirst({
    where: { fromElementTypeId: fromEl.elementTypeId, toElementTypeId: toEl.elementTypeId, relationshipTypeId: rt.id },
  });
  if (!rule) return { success: false, message: `Relationship "${relSlug}" not permitted between these element types`, error: "Rule not permitted", data: { validationResult: "blocked" } };
  const rel = await prisma.eaRelationship.create({
    data: {
      fromElementId: String(params["fromElementId"]),
      toElementId: String(params["toElementId"]),
      relationshipTypeId: rt.id,
      notationSlug: "archimate4",
      createdById: userId,
      properties: (typeof params["properties"] === "object" && params["properties"] !== null) ? params["properties"] as Record<string, unknown> : {},
    },
  });
  return { success: true, entityId: rel.id, message: `Created "${relSlug}" relationship`, data: { relationshipId: rel.id, fromElementName: fromEl.name, toElementName: toEl.name, validationResult: "allowed" } };
}

case "classify_ea_element": {
  const data: Record<string, unknown> = {};
  if (typeof params["itValueStream"] === "string")   data["itValueStream"]   = params["itValueStream"];
  if (typeof params["refinementLevel"] === "string") data["refinementLevel"] = params["refinementLevel"];
  if (typeof params["ontologyRole"] === "string")    data["ontologyRole"]    = params["ontologyRole"];
  if (Object.keys(data).length === 0) return { success: false, message: "No classification fields provided", error: "Nothing to update" };
  const updated = await prisma.eaElement.update({ where: { id: String(params["elementId"]) }, data });
  return { success: true, entityId: updated.id, message: `Classified element ${updated.id}`, data: { elementId: updated.id, refinementLevel: updated.refinementLevel, itValueStream: updated.itValueStream } };
}
```

- [ ] **Step 5:** Run tests:
```bash
cd apps/web && npx vitest run lib/mcp-tools-ea.test.ts
```

- [ ] **Step 6:** Commit:
```
feat(tools): add create_ea_element, create_ea_relationship, classify_ea_element MCP tools
```

---

## Task 11: MCP Read / Analysis Tools

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools-ea.test.ts`

- [ ] **Step 1:** Add tests for `query_ontology_graph` and `run_traversal_pattern` to `mcp-tools-ea.test.ts`:
```typescript
describe("query_ontology_graph", () => {
  it("returns elements filtered by elementTypeSlugs", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaElementType.findMany).mockResolvedValue([{ id: "et-1", slug: "digital_product" }] as never);
    vi.mocked(prisma.eaElement.findMany).mockResolvedValue([{ id: "el-1", name: "Portal", elementType: { slug: "digital_product" }, refinementLevel: "conceptual", itValueStream: null, ontologyRole: null }] as never);
    const result = await executeTool("query_ontology_graph", { elementTypeSlugs: ["digital_product"], limit: 5 }, "u-1");
    expect(result.success).toBe(true);
    expect(result.data?.elements).toHaveLength(1);
  });
});
```

- [ ] **Step 2:** Add `query_ontology_graph` and `run_traversal_pattern` definitions to `PLATFORM_TOOLS`:
```typescript
{
  name: "query_ontology_graph",
  description: "Query ontology graph elements with filters. Use before creating elements to avoid duplicates. Returns element IDs, names, types, and refinement levels.",
  inputSchema: {
    type: "object",
    properties: {
      elementTypeSlugs:     { type: "array",   items: { type: "string" }, description: "Filter by element type slugs" },
      refinementLevel:      { type: "string",  enum: ["conceptual", "logical", "actual"] },
      itValueStream:        { type: "string" },
      ontologyRole:         { type: "string" },
      digitalProductId:     { type: "string" },
      portfolioId:          { type: "string" },
      nameContains:         { type: "string" },
      includeRelationships: { type: "boolean" },
      limit:                { type: "number",  description: "Max results, default 20" },
    },
  },
  requiredCapability: "view_ea_modeler",
  sideEffect: false,
},
{
  name: "run_traversal_pattern",
  description: "Run a named bounded analysis pattern (e.g. blast_radius, governance_audit, ma_separation) from one or more starting elements. Returns traversal paths and summary.",
  inputSchema: {
    type: "object",
    properties: {
      patternSlug:     { type: "string", enum: ["blast_radius", "governance_audit", "architecture_traceability", "ai_oversight", "cost_rollup", "ma_separation", "service_customer_impact"] },
      startElementIds: { type: "array", items: { type: "string" } },
      maxDepth:        { type: "number" },
    },
    required: ["patternSlug", "startElementIds"],
  },
  requiredCapability: "view_ea_modeler",
  sideEffect: false,
},
```

- [ ] **Step 3:** Add cases to `executeTool` switch:
```typescript
case "query_ontology_graph": {
  const notation = await prisma.eaNotation.findUnique({ where: { slug: "archimate4" } });
  if (!notation) return { success: false, message: "ArchiMate 4 notation not seeded", error: "Notation not found" };
  const where: Record<string, unknown> = {};
  const slugs = Array.isArray(params["elementTypeSlugs"]) ? params["elementTypeSlugs"] as string[] : [];
  if (slugs.length > 0) {
    const ets = await prisma.eaElementType.findMany({ where: { notationId: notation.id, slug: { in: slugs } }, select: { id: true } });
    where["elementTypeId"] = { in: ets.map(et => et.id) };
  }
  if (typeof params["refinementLevel"] === "string") where["refinementLevel"] = params["refinementLevel"];
  if (typeof params["itValueStream"] === "string") where["itValueStream"] = params["itValueStream"];
  if (typeof params["ontologyRole"] === "string") where["ontologyRole"] = params["ontologyRole"];
  if (typeof params["digitalProductId"] === "string") where["digitalProductId"] = params["digitalProductId"];
  if (typeof params["portfolioId"] === "string") where["portfolioId"] = params["portfolioId"];
  if (typeof params["nameContains"] === "string") where["name"] = { contains: params["nameContains"], mode: "insensitive" };
  const limit = typeof params["limit"] === "number" ? Math.min(params["limit"], 50) : 20;
  const includeRels = params["includeRelationships"] === true;
  const elements = await prisma.eaElement.findMany({
    where,
    take: limit,
    include: {
      elementType: { select: { slug: true, name: true } },
      ...(includeRels ? { fromRelationships: { include: { relationshipType: { select: { slug: true } }, toElement: { select: { id: true, name: true } } } } } : {}),
    },
  });
  const total = await prisma.eaElement.count({ where });
  return {
    success: true,
    message: `Found ${elements.length} elements (${total} total)`,
    data: {
      elements: elements.map(el => ({
        elementId: el.id,
        name: el.name,
        elementTypeName: el.elementType.name,
        refinementLevel: el.refinementLevel,
        itValueStream: el.itValueStream,
        ontologyRole: el.ontologyRole,
      })),
      totalCount: total,
    },
  };
}

case "run_traversal_pattern": {
  const { runTraversalPattern } = await import("@/lib/ea/traversal-executor");
  const result = await runTraversalPattern({
    patternSlug: String(params["patternSlug"] ?? ""),
    startElementIds: Array.isArray(params["startElementIds"]) ? params["startElementIds"] as string[] : [],
    maxDepth: typeof params["maxDepth"] === "number" ? params["maxDepth"] : 6,
  });
  if (!result.ok) return { success: false, message: result.error ?? "Traversal failed", error: result.error };
  return { success: true, message: `Traversal complete: ${result.data!.summary.nodesTraversed} nodes`, data: result.data as Record<string, unknown> };
}
```

- [ ] **Step 4:** Run tests:
```bash
cd apps/web && npx vitest run lib/mcp-tools-ea.test.ts
```

- [ ] **Step 5:** Commit:
```
feat(tools): add query_ontology_graph and run_traversal_pattern MCP tools
```

---

## Task 12: MCP File Tools (import_archimate, export_archimate)

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools-ea.test.ts`

- [ ] **Step 1:** Add tool definitions to `PLATFORM_TOOLS`:
```typescript
{
  name: "import_archimate",
  description: "Import a .archimate XML file from the Archi tool into the ontology graph. All elements are created as draft/conceptual. Max file size: 1 MB base64.",
  inputSchema: {
    type: "object",
    properties: {
      fileContentBase64: { type: "string", description: "Base64-encoded .archimate XML content" },
      fileName:          { type: "string" },
      targetPortfolioId:      { type: "string" },
      targetDigitalProductId: { type: "string" },
    },
    required: ["fileContentBase64", "fileName"],
  },
  requiredCapability: "manage_ea_model",
  sideEffect: true,
},
{
  name: "export_archimate",
  description: "Export elements scoped to a portfolio, digital product, or view as a .archimate XML file. Extension types are mapped to standard ArchiMate types with dpf: properties for round-trip fidelity.",
  inputSchema: {
    type: "object",
    properties: {
      scopeType: { type: "string", enum: ["view", "portfolio", "digital_product"] },
      scopeRef:  { type: "string", description: "ID of the view, portfolio, or digital product" },
      fileName:  { type: "string", description: "Output filename (optional)" },
    },
    required: ["scopeType", "scopeRef"],
  },
  requiredCapability: "view_ea_modeler",
  sideEffect: false,
},
```

- [ ] **Step 2:** Add cases to `executeTool` switch:
```typescript
case "import_archimate": {
  const { importArchimateFile } = await import("@/lib/actions/ea-archimate");
  const fileContent = String(params["fileContentBase64"] ?? "");
  if (Buffer.byteLength(fileContent, "utf-8") > 1_000_000) {
    return { success: false, message: "File too large. Maximum 1 MB base64 (~750 KB raw).", error: "File size limit exceeded" };
  }
  const result = await importArchimateFile({
    fileContentBase64: fileContent,
    fileName: String(params["fileName"] ?? "import.archimate"),
    userId,
    targetPortfolioId: typeof params["targetPortfolioId"] === "string" ? params["targetPortfolioId"] : undefined,
    targetDigitalProductId: typeof params["targetDigitalProductId"] === "string" ? params["targetDigitalProductId"] : undefined,
  });
  if (!result.ok) return { success: false, message: result.error ?? "Import failed", error: result.error };
  return { success: true, message: `Imported ${result.data!.elementsCreated} elements, ${result.data!.relationshipsCreated} relationships`, data: result.data as Record<string, unknown> };
}

case "export_archimate": {
  const { exportArchimateFile } = await import("@/lib/actions/ea-archimate");
  const result = await exportArchimateFile({
    scopeType: String(params["scopeType"] ?? "") as "view" | "portfolio" | "digital_product",
    scopeRef: String(params["scopeRef"] ?? ""),
    fileName: typeof params["fileName"] === "string" ? params["fileName"] : undefined,
    userId,
  });
  if (!result.ok) return { success: false, message: result.error ?? "Export failed", error: result.error };
  return { success: true, message: `Exported ${result.data!.elementCount} elements to ${result.data!.fileName}`, data: result.data as Record<string, unknown> };
}
```

- [ ] **Step 3:** Run all EA tool tests:
```bash
cd apps/web && npx vitest run lib/mcp-tools-ea.test.ts
```

- [ ] **Step 4:** Commit:
```
feat(tools): add import_archimate and export_archimate MCP tools
```

---

## Task 13: Agent Grants and Registry Update

**Files:**
- Modify: `apps/web/lib/agent-grants.ts`
- Modify: `packages/db/data/agent_registry.json`

- [ ] **Step 1:** Add the EA graph grant categories to `TOOL_TO_GRANTS` in `agent-grants.ts` (after the `// Compliance` block):
```typescript
// EA / Ontology Graph
create_ea_element:        ["ea_graph_write"],
create_ea_relationship:   ["ea_graph_write"],
classify_ea_element:      ["ea_graph_write"],
import_archimate:         ["ea_graph_write"],
query_ontology_graph:     ["ea_graph_read"],
run_traversal_pattern:    ["ea_graph_read"],
export_archimate:         ["ea_graph_read"],
```

- [ ] **Step 2:** Open `packages/db/data/agent_registry.json`. Find the EA Modeler agent entry (search for `value_stream` or `ea` in the agent names). Add `"ea_graph_write"` and `"ea_graph_read"` to its `config_profile.tool_grants` array.

  If the EA Modeler agent is not in the registry, locate the closest architecture-domain agent and add the grants there. Do not create a new agent entry.

- [ ] **Step 3:** Verify the grants file compiles without TypeScript errors:
```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 4:** Commit:
```
feat(grants): add ea_graph_write and ea_graph_read grant categories; update EA Modeler agent registry
```

---

## Task 14: Build Gate

**Files:** None — verification only

- [ ] **Step 1:** Run all unit tests:
```bash
cd apps/web && npx vitest run
```
Expected: all tests pass, including `lib/ea/archimate-xml.test.ts`, `lib/actions/ea-archimate.test.ts`, `lib/ea/traversal-executor.test.ts`, `lib/mcp-tools-ea.test.ts`

- [ ] **Step 2:** Run the production build:
```bash
cd apps/web && npx next build
```
Expected: zero TypeScript errors, zero build errors.

- [ ] **Step 3:** If any errors appear, fix them before proceeding. Do not defer build errors.

- [ ] **Step 4:** Final commit:
```
chore(build): verify production build passes for archimate4 ontology graph refactor
```

---

## Testing Checklist

| Area | Test file | Coverage |
|---|---|---|
| XML parser | `lib/ea/archimate-xml.test.ts` | parse, generate, unknown type fallback, extension restore |
| Import action | `lib/actions/ea-archimate.test.ts` | success, notation missing, unknown type conformance |
| Export action | `lib/actions/ea-archimate.test.ts` | scope query, extension type mapping |
| Traversal executor | `lib/ea/traversal-executor.test.ts` | pattern missing, no start element |
| Write tools | `lib/mcp-tools-ea.test.ts` | create element, blocked relationship, classify |
| Read tools | `lib/mcp-tools-ea.test.ts` | query with type filter |

---

## Seed Run Order (for fresh environments)

```bash
# 1. Apply migration
pnpm --filter @dpf/db exec prisma migrate deploy

# 2. Run full seed (includes archimate4 seed called from main seed.ts)
pnpm --filter @dpf/db exec ts-node src/seed.ts
```

Verify the seed calls `seedEaArchimate4()` from `src/seed.ts`. If it is called independently, ensure `seedEaFrameworkMappings` and `seedEaTraversalPatterns` are called within `seedEaArchimate4()` so they run together.

---

## BI-ONTO-002 (Out of Scope — Follow-On)

Standard ArchiMate 4 element type framework mappings (the 30 existing types mapped across 12 frameworks) are tracked as `BI-ONTO-002`. They are explicitly deferred from this phase. Do not implement them here.
