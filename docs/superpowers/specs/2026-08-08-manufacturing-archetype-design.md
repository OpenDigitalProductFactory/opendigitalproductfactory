# Manufacturing & Industrial OEM Archetype Design

**Backlog:** BI-7697CAD3
**Epic:** EP-VERTICAL-MANUFACTURING
**Decision ledger:** DI-51A97C48FDFD

## Outcome

Provision `manufacturing` as a first-class storefront archetype category with an initial `industrial-equipment-oem` leaf. The category represents an organization that owns the transformation of materials and components into controlled, often serialized finished goods. It is deliberately distinct from retail (selling stock), warehousing (custody of another party's goods), and construction (project/site delivery).

The initial slice makes onboarding, public discovery, finance setup, occupational identity, business doctrine, and readiness classification honest. Manufacturing execution records and the dedicated FACTORY operational renderer remain in their own backlog items.

## Standards and precedent

- ISA-95 / IEC 62264 supplies the enterprise, site, area, work-center/line, work-unit/cell, and equipment hierarchy and the Level 3 manufacturing-operations boundary: https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard
- NIST SP 800-82 Rev. 3 supplies the safety/reliability-aware OT security boundary: https://csrc.nist.gov/pubs/sp/800/82/r3/final
- OPC UA for Machinery and Machine Tools informs later equipment-state integration, not this template slice: https://reference.opcfoundation.org/MachineTool/v102/docs/1.1
- ERPNext Job Cards and Odoo work-center/OEE documentation are implementation precedent for operation-level work and performance, not source code to copy: https://docs.frappe.io/erpnext/job-card and https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/reporting/oee.html

## Taxonomy decision

The kernel compared a new category against retail and warehousing leaves. It recommended `new-manufacturing-category` with composite 14.60, margin 10.67, high confidence, and no commandment conflict. Standards grounding, durable architecture, reuse, and schema honesty outweighed the smaller initial touch surface of a misclassified leaf.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-07-21-archetype-provisioning-playbook-design.md`
  - `docs/superpowers/specs/2026-07-21-spatial-operational-views-design.md`
  - `docs/superpowers/specs/2026-07-28-business-operations-and-performance-views-design.md`
  - `docs/superpowers/plans/2026-08-08-manufacturing-archetype.md`
- Current code substrate reviewed:
  - `packages/storefront-templates/src/twin-profile.ts`
  - `packages/storefront-templates/src/operational-value-stream.ts`
  - `apps/web/lib/workspace-home/profiles.ts`
  - `apps/web/lib/tak/marketing-playbooks.ts`
- Source of truth:
  - The canonical archetype definition and derived profiles own category semantics; ISA-95 owns the referenced factory hierarchy; live operational observations retain source, timestamp, freshness, and quality.
- Decision:
  - Provision Manufacturing as a distinct category, use BAYS only as a truthful interim work-center grammar, and keep BI-E118D536 responsible for the dedicated FACTORY renderer. Marketing remains a B2B evidence-led playbook. Neither surface grants industrial-control authority.

Operational-Precedent: no-precedent (no incumbent factory spatial workflow exists in the repository; ISA-95 hierarchy and the existing BAYS grammar are the grounded interim fallback)

## Provisioning plan

### 1. Template substrate

- Add `manufacturing` to the canonical type and profession axes.
- Add `industrial-equipment-oem` with business-to-business, sales-assisted, physical-goods semantics.
- Populate finance, value-stream, twin, vocabulary, onboarding doctrine, discovery, supply, demo, and trust consumers.
- Use the existing BAYS twin only as an explicit interim work-center grammar. BI-E118D536 owns the dedicated FACTORY line/cell/station/equipment renderer.

### 2. Profession corpus

- Add `manufacturing-operations` to the profession registry.
- Add `production-flow-and-quality-holds.md`, grounded in ISA-95 and NIST OT guidance.
- Add assembler, winding technician, test technician, manufacturing engineer, NPI engineer, quality inspector, and supply planner occupation templates.

### 3. AI coworker decision

Extend existing governed coworkers rather than create a misleading all-purpose manufacturing agent:

- `ops-coordinator` coordinates constraints, queues, and handoffs.
- `data-steward` protects master-data and traceability quality.
- `compliance-officer` supports quality/compliance evidence without taking disposition authority.
- `finance-controller` supports cost and supplier decisions.

The decision is recorded as `manufacturing extends:ops-coordinator`; the occupation roster composes the other specialists by role. A dedicated factory coworker should be established only after production-order, quality, and equipment substrates exist and can constrain its actions.

The profession family uses manufacturing-qualified role bindings (`manufacturing-ops-coordinator`, `manufacturing-data-steward`, `manufacturing-compliance-officer`, and `manufacturing-finance-controller`). These are contextual profession bindings, not new autonomous coworkers: occupation rosters continue to summon the existing governed coworker slugs. Qualifying the bindings preserves the registry invariant that one role resolves to exactly one profession family while making the manufacturing extension explicit.

### 4. Skills and tools

Reuse the profession corpus plus generic operations, data, compliance, finance, web research, and business-analysis capabilities. Do not add an industrial control skill or grant: BI-B9BC5B0B is read-only OPC UA/Sparkplug visibility, while BI-049F2113 owns any future PLC/robot control safety case. Tool and model watchlists remain evidence inputs, not implicit production dependencies.

## Safety and authority

The archetype may describe, observe, summarize, and recommend. It does not command machinery. Product/process release, physical completion, quality disposition, equipment return-to-service, deviations, and safety decisions remain with qualified humans. Missing or stale telemetry never implies healthy or complete.

## Refactoring allocation

Approximately 20% of implementation effort is reserved for shared-contract quality: keep stable category semantics in the existing derived profiles, reuse one activation constant and one profession family, avoid leaf-specific consumer branches, and add invariant tests rather than one-off setup logic.

## UX fit review — manufacturing archetype provisioning

- **Decision:** fits-with-guardrails
- **Owning area:** Workspace is the canonical day-to-day operations home; Business setup and public discovery are supporting entry points, not additional command centers.
- **Route family:** Existing `/workspace`, onboarding, and storefront-management routes only. This slice adds no global or section navigation.
- **Primary persona:** A manufacturing supervisor or production coordinator who needs the active work-center queue, constraints, holds, and handoffs without learning platform taxonomy.
- **Navigation layer touched:** Local workspace contribution and existing setup choices; no new navigation layer.
- **Reuse/convergence:** Reuse the vertical workspace-home profile and the existing BAYS grammar as an explicitly interim work-center view. BI-E118D536 owns the dedicated FACTORY line/cell/station/equipment renderer; this slice must not create a second spatial renderer.
- **Source truth:** The canonical archetype definition and its derived workspace/twin profiles own stable presentation semantics. Future live production, quality, and equipment observations must retain source, timestamp, freshness, and quality rather than infer state from the template.
- **Empty/failure behavior:** An unconfigured organization keeps the existing honest setup path. Missing or stale manufacturing observations must render unavailable/stale and must never imply equipment health, work completion, or quality release.
- **AI boundary:** Profile cards and setup selections do not send prompts. Coworker work continues through the governed launcher and does not gain machinery-control or disposition authority.
- **Required guardrails:** Label BAYS as an interim work-center grammar wherever that distinction is user-relevant; do not claim that FACTORY layout or manufacturing execution is delivered by this provisioning slice.
- **Evidence before merge:** Archetype/profile invariant tests, setup and public-discovery coverage, theme-safe reuse of existing rendered components, exact merged-code typecheck/build, and a canonical-runtime exercise of the configured manufacturing workspace or its honest unconfigured state.
- **Captured in:** This design record; the implementation plan keeps FACTORY rendering and execution in their existing backlog items.

## Acceptance

- Setup and public discovery offer Manufacturing & Industrial OEM.
- Selecting the leaf produces a physical-goods B2B storefront and a manufacturing finance profile.
- All seven occupation keys validate against existing coworker grants and the manufacturing profession family.
- The completeness gate recognizes corpus and coworker-decision depth without adding the category to the grandfather baseline.
- Readiness resolves the category to EP-VERTICAL-MANUFACTURING and refuses higher readiness claims while that evidence remains open.
