# Legal AI Coworker Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff. A new coworker must additionally go through `dpf-establish-coworker`: the `establish_coworker` factory door, the CI conformance checklist, then a behavioural certification from the nightly golden-journey sweep before promotion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first production slice of the Legal AI Coworker: a legal-operations specialist that can intake legal needs, draft/review legal document packets, identify jurisdiction and archetype gaps, and prepare attorney-reviewable the operator/DPF operating documents without acting as an autonomous lawyer.

**Architecture:** Reuse the existing agent registry, skill seed, profession corpus, managed document, route coworker, and action-envelope systems. The legal coworker is a high-risk legal-operations specialist, not a second approval engine or a substitute for counsel. New data structures are limited to legal document metadata and review packet lineage where the managed document store does not already have a canonical field.

**Tech Stack:** Next.js 16 App Router, React server/server actions, Prisma 7, PostgreSQL, Vitest, Testing Library where UI helpers need coverage, DPF managed documents, DPF profession corpus, DPF coworker action envelopes, lucide-react icons, DPF theme tokens.


> **Rescue note (2026-08-16).** This design was recovered from a branch that was pushed and never proposed as a PR, found in the 2026-08-15 never-proposed-branch sweep. **The design landed; the implementation did not.**
>
> - Tracking item: `BI-D936CAAF`
> - Preserved implementation: `doc/legal-coworker` @ `3e39366244b9e87469b35e4823e21787eb80427c`, pinned locally at `refs/salvage/2026-08-15/doc/legal-coworker` and recorded in `~/dpf-deleted-remote-branch-tips-2026-08-15.txt`. Restore with `git push origin 3e39366244b9e87469b35e4823e21787eb80427c:refs/heads/doc/legal-coworker`.
> - Merge state as measured on 2026-08-16: 26 added files, none in main; seven weeks behind main.
> - The original backlog anchors in this document did **not** resolve in this install, so it could not pass `check_plan_backlog_coverage`. Coverage is rebound to `BI-D936CAAF`.
>
> Implementation is deliberately deferred to its own thread: this work needs an install/seed cycle to verify honestly, and a rebase alone would not prove it works. Read `BI-D936CAAF` for the current dependency state before starting.

---

## Backlog Trace

- Epic: `EP-8E224C90` Legal AI Coworker - legal operations, document review, jurisdiction-aware corpus, and the operator dogfood packet
- P0: `BI-97390B0C` the operator/DPF legal operating packet workflow foundation
- P1: `BI-62CECF8E` Specialist identity, prompts, skills, and HITL/legal-risk envelope
- P1: `BI-AB87FA66` Legal operations WSID corpus expansion and jurisdiction-layered analysis repair
- P2: `BI-23292DD5` Managed legal document metadata and approval-gated review packets
- P3: `BI-D95D6CF2` Customer archetype and jurisdiction generalization

## Chunk 1: Coworker Identity And Guardrails

### Task 1: Add Legal Operations Counsel To The Agent Registry

**Files:**
- Modify: `packages/db/data/agent_registry.json`
- Modify: `packages/db/src/agent-model-defaults.ts`
- Modify: `packages/db/src/agent-model-defaults.test.ts`
- Modify: `packages/db/src/agent-identity.test.ts`
- Modify: `docs/professions/registry.json`

- [x] **Step 1: Write failing identity/model tests**

Extend `packages/db/src/agent-model-defaults.test.ts` to assert that `legal-operations-counsel` requires:
- `minimumTier: "frontier"`
- `budgetClass: "balanced"`
- `minimumCapabilities.toolUse: true`
- at least `64000` context tokens

Extend the identity/profession registry tests if needed so the new active agent must map to the `legal-compliance` profession family.

Run: `pnpm --filter @dpf/db exec vitest run src/agent-model-defaults.test.ts src/agent-identity.test.ts`

Expected: FAIL because the agent/defaults do not exist yet.

- [x] **Step 2: Register `AGT-906`**

Add an active agent entry after `AGT-905`:
- `agent_id`: `AGT-906`
- `agent_name`: `legal-operations-counsel`
- `displayName`: `Legal Operations Counsel`
- aliases: `legal-ai-coworker`, `legal-ops-specialist`, `contract-specialist`
- `tier`: `cross-cutting`
- `value_stream`: `cross-cutting`
- `capability_domain`: legal intake, contract/document drafting support, review packet preparation, jurisdiction/archetype issue spotting, counsel escalation
- `hitl_tier_default`: at least `2`
- `tool_grants`: start with read-only grants plus proposal/document capability grants already used by coworkers; do not grant autonomous send/sign/file/payment authority

Update `docs/professions/registry.json` so `legal-compliance.roles` includes `legal-operations-counsel`.

- [x] **Step 3: Add model defaults**

Add a `legal-operations-counsel` row in `packages/db/src/agent-model-defaults.ts`. Prefer frontier-tier routing because legal drafting and review need long-context synthesis, source tracking, and tool reliability.

- [x] **Step 4: Run identity/model tests**

Run: `pnpm --filter @dpf/db exec vitest run src/agent-model-defaults.test.ts src/agent-identity.test.ts`

Expected: PASS.

### Task 2: Route The Coworker In The Shell Without Replacing Licensing

**Files:**
- Modify: `apps/web/lib/tak/agent-routing.ts`
- Modify: `apps/web/lib/tak/agent-routing.test.ts`
- Modify if needed: `apps/web/lib/tak/agent-grants.test.ts`

- [x] **Step 1: Write failing route tests**

Add tests that:
- `/workspace/documents/legal` resolves to `legal-operations-counsel`
- `/workspace/documents/legal/<documentId>` resolves to the same coworker
- `/compliance/licensing` still resolves to `licensing-specialist`
- users without compliance/legal permission get `canAssist: false`
- the system prompt contains "not a substitute for legal counsel", "attorney review", and "do not provide jurisdiction-specific legal conclusions without verified authority"

Run: `pnpm --filter web exec vitest run lib/tak/agent-routing.test.ts lib/tak/agent-grants.test.ts`

Expected: FAIL because the route and prompt do not exist yet.

- [x] **Step 2: Add route config**

Add a route entry for `/workspace/documents/legal` with:
- `agentId: "legal-operations-counsel"`
- `agentName: "Legal Operations Counsel"`
- `capability`: the nearest existing legal/compliance read capability
- `sensitivity: "restricted"` or the highest available sensitivity tier in this file
- model requirements matching the frontier default

Use skills that match the first vertical slice:
- Legal intake
- Draft legal document packet
- Review legal document packet
- Prepare attorney review packet
- the operator/DPF operating packet
- Identify legal corpus gaps

Keep `/compliance/licensing` unchanged. Licensing answers "what permits or authority layers may apply"; Legal Operations Counsel answers "what legal document or legal-risk packet should exist, what is missing, and what needs attorney review."

- [x] **Step 3: Add canned response copy**

Extend the canned response map near the existing `licensing-specialist` entry. The response should make the boundary clear and point users to skills rather than free-form legal advice.

- [x] **Step 4: Run routing tests**

Run: `pnpm --filter web exec vitest run lib/tak/agent-routing.test.ts lib/tak/agent-grants.test.ts`

Expected: PASS.

## Chunk 2: Skills And Prompt Seeds

### Task 3: Add Legal Coworker Skills

**Files:**
- Create: `skills/compliance/legal-intake.skill.md`
- Create: `skills/compliance/draft-legal-document.skill.md`
- Create: `skills/compliance/review-legal-document.skill.md`
- Create: `skills/compliance/prepare-counsel-packet.skill.md`
- Create: `skills/compliance/operator-legal-packet.skill.md`
- Create: `skills/compliance/legal-corpus-gap.skill.md`
- Modify: `packages/db/src/seed-skills.test.ts`
- Modify if needed: `apps/web/lib/actions/agent-skills.test.ts`
- Modify if needed: `packages/db/src/skill-quality-audit.test.ts`

- [x] **Step 1: Write failing skill seed tests**

Add tests that each new skill:
- assigns to `legal-operations-counsel`
- has `riskBand: high` for drafting/review/the operator packet work
- has no direct execution tools that send, sign, file, or bind agreements
- is user-invocable and agent-invocable where existing skill policy allows it
- contains explicit attorney-review and jurisdiction-verification guidance

Run: `pnpm --filter @dpf/db exec vitest run src/seed-skills.test.ts src/skill-quality-audit.test.ts`

Expected: FAIL because the files do not exist yet.

- [x] **Step 2: Create the skill files**

Use the existing skill frontmatter pattern. Keep these skills operational:
- `legal-intake`: classify matter type, parties, jurisdiction, archetype, urgency, governing-law clues, and missing facts
- `draft-legal-document`: create a managed draft packet with assumptions, unresolved clauses, and counsel-review checklist
- `review-legal-document`: summarize obligations, rights, deadlines, risks, missing exhibits, inconsistent terms, and counsel questions
- `prepare-counsel-packet`: package facts, documents, questions, and source citations for an attorney
- `operator-legal-packet`: dogfood the operator/DPF business-use packet needs such as support terms, commercial license/support addendum, privacy posture, contributor/IP questions, and customer MSA gaps
- `legal-corpus-gap`: create a backlog-ready corpus gap when a jurisdiction, archetype, or document type lacks vetted references

Do not phrase any skill as "give legal advice" or "make this legally valid." Use "prepare", "review", "identify", "draft for counsel review", and "flag".

- [x] **Step 3: Run skill tests**

Run: `pnpm --filter @dpf/db exec vitest run src/seed-skills.test.ts src/skill-quality-audit.test.ts`

Expected: PASS.

## Chunk 3: Corpus And Jurisdiction-Layer Repair

### Task 4: Fill The Missing Legal-Compliance Corpus Page

**Files:**
- Create: `docs/professions/legal-compliance/wiki/jurisdiction-layered-analysis.md`
- Modify if needed: `docs/professions/registry.json`
- Modify: `apps/web/lib/decision-perspective/profession-corpus.test.ts`
- Modify if needed: `packages/db/src/seed-profession-corpus.ts`

- [x] **Step 1: Write failing corpus tests**

Add or extend tests so every `legal-compliance.coverageChecklist` entry has a matching wiki page slug, including `jurisdiction-layered-analysis`.

Run: `pnpm --filter web exec vitest run lib/decision-perspective/profession-corpus.test.ts lib/decision-perspective/profession-corpus-wiring.test.ts lib/decision-perspective/resolve-profession-profile.test.ts`

Expected: FAIL because the page is missing.

- [x] **Step 2: Add the corpus page**

Create a page that teaches the coworker to separate:
- federal/national law
- state/province law
- county/city/municipal rules
- professional boards
- contract governing law and venue
- data residency and privacy rules
- industry/archetype rules
- product/service-specific obligations

The page must say that jurisdiction facts are inputs to investigation, not final legal conclusions. It should cite only source keys already accepted by the profession corpus seed, or add new source entries deliberately.

- [x] **Step 3: Add legal operations pages only for the P0 slice**

If the implementation needs more pages for the operator, prefer a small set:
- `contract-review-workflow.md`
- `attorney-review-packet.md`
- `commercial-software-support-terms.md`

Do not create a broad legal encyclopedia in the first PR. Every page needs a clear workflow use and source discipline.

- [x] **Step 4: Run corpus tests**

Run: `pnpm --filter web exec vitest run lib/decision-perspective/profession-corpus.test.ts lib/decision-perspective/profession-corpus-wiring.test.ts lib/decision-perspective/resolve-profession-profile.test.ts`

Expected: PASS.

## Chunk 4: Legal Document Metadata And Review Packets

### Task 5: Add A Narrow Legal Metadata Read Model

**Files:**
- Modify only if needed: `packages/db/prisma/schema.prisma`
- Create if schema changes: `packages/db/prisma/migrations/<timestamp>_legal_document_metadata/migration.sql`
- Create: `apps/web/lib/legal/legal-document-metadata.ts`
- Create: `apps/web/lib/legal/legal-document-metadata.test.ts`
- Modify: `apps/web/lib/documents/document-store.ts`
- Modify if needed: `apps/web/lib/documents/document-store.test.ts`

- [x] **Step 1: First try a no-migration design**

Check whether existing `Document.documentKind`, `DocumentTag`, `DocumentReference`, `DocumentLifecycleEvent.reason`, and `DocumentVersion.summary` can carry the first the operator packet metadata:
- document type
- party names
- jurisdiction tags
- status: intake, draft, review-needed, counsel-reviewed, approved-for-use
- source/citation references
- related documents

If these fields are enough, do not add tables. This is the preferred architecture.

- [x] **Step 2: Write tests for a pure legal document classifier**

Create `apps/web/lib/legal/legal-document-metadata.test.ts` for pure helpers:
- normalize legal document kind slugs
- normalize jurisdiction tags without guessing
- classify legal packet status from tags/lifecycle state
- generate the tag set for the operator packet documents

Run: `pnpm --filter web exec vitest run lib/legal/legal-document-metadata.test.ts`

Expected: FAIL because the helper does not exist.

- [x] **Step 3: Implement the pure helper**

Create `apps/web/lib/legal/legal-document-metadata.ts`. Keep it DB-free and reusable by the UI, server actions, and coworker actions.

- [x] **Step 4: Add schema only if the no-migration design fails**

If a real legal-review packet needs structured fields that cannot be recovered from existing document tables, add the smallest possible table, for example `LegalDocumentProfile`, with:
- `documentId`
- `matterType`
- `jurisdictionScope`
- `legalRiskBand`
- `requiresAttorneyReview`
- `attorneyReviewStatus`
- `counselPacketDocumentId`

If a migration is added, include backfill SQL inline in the migration file and add tests for migration-compatible defaults. Do not create a separate legal document store.

Decision: no schema or migration was added for this slice. Existing managed document fields, normalized tags, document references, lifecycle state, and action proposal parameters cover the the operator packet, attorney-review flags, jurisdiction-unverified status, related documents, and proposal-only legal publication gate.

- [x] **Step 5: Run metadata tests**

Run: `pnpm --filter web exec vitest run lib/legal/legal-document-metadata.test.ts`

Expected: PASS.

### Task 6: Add Attorney-Review Proposal Envelopes

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Modify: `apps/web/lib/actions/agent-coworker-external.test.ts`
- Modify if needed: `packages/db/prisma/schema.prisma`

- [x] **Step 1: Write failing action-envelope tests**

Add tests showing that legal coworker outputs that could affect rights or obligations create proposals instead of direct mutations:
- publish a legal document
- mark a legal packet as approved-for-use
- prepare an external counsel packet
- flag a clause as blocking

Run: `pnpm --filter web exec vitest run lib/actions/agent-coworker-external.test.ts`

Expected: FAIL until legal action categories are routed through `AgentActionProposal`/`CoworkerActionEnvelope`.

- [x] **Step 2: Implement proposal-only legal actions**

Use the existing action-envelope tables:
- `AgentActionProposal` at `packages/db/prisma/schema.prisma`
- `CoworkerActionEnvelope` at `packages/db/prisma/schema.prisma`

Do not add a parallel legal approval system. Legal actions should require explicit human approval and should preserve:
- matter/document id
- proposed state change
- legal risk reason
- unresolved assumptions
- counsel-review status
- governance/attention presentation that names the legal document, target state, legal risk reason, unresolved assumptions, and counsel-review status

- [x] **Step 3: Run action tests**

Run: `pnpm --filter web exec vitest run lib/actions/agent-coworker-external.test.ts`

Expected: PASS.

## Chunk 5: the operator/DPF Legal Packet Vertical Slice

### Task 7: Seed The the operator Packet As Managed Documents

**Files:**
- Create: `apps/web/lib/legal/operator-packet.ts`
- Create: `apps/web/lib/legal/operator-packet.test.ts`
- Modify: `apps/web/lib/documents/document-store.ts` only if a missing extension point is found
- Modify if needed: `packages/db/src/seed.ts` or the existing deploy seed path

- [x] **Step 1: Write failing tests for packet composition**

Test a pure `buildOperatorLegalPacket()` helper that returns document payloads for:
- DPF business-use and commercial boundary memo
- DPF business-use software license agreement checklist
- customer support terms checklist
- customer MSA/legal packet checklist
- privacy/data-processing issue list
- contributor/IP and open-source hygiene checklist
- unresolved counsel questions

Run: `pnpm --filter web exec vitest run lib/legal/operator-packet.test.ts`

Expected: FAIL because the helper does not exist.

- [x] **Step 2: Implement the packet builder**

Keep documents as templates with clear assumptions and unresolved questions. Use existing `saveManagedDocument()` for persistence. Tag documents with:
- `legal`
- `operator`
- `dpf`
- `attorney-review-required`
- `jurisdiction-unverified`

- [x] **Step 3: Add seed/invocation path**

Prefer an explicit skill/action invocation over unconditional global seed data. If an installer seed is required, make it idempotent and organization-scoped.

- [x] **Step 4: Run packet tests**

Run: `pnpm --filter web exec vitest run lib/legal/operator-packet.test.ts`

Expected: PASS.

## Chunk 6: UI For Legal Work Without A Marketing Page

### Task 8: Add Legal Document Workbench Surface

**Files:**
- Create: `apps/web/app/(shell)/workspace/documents/legal/page.tsx`
- Create if useful: `apps/web/app/(shell)/workspace/documents/legal/[documentId]/page.tsx`
- Modify: `apps/web/app/(shell)/workspace/documents/page.tsx`
- Modify: `apps/web/app/(shell)/workspace/documents/[documentId]/page.tsx`
- Create if useful: `apps/web/components/documents/legal-document-badge.tsx`
- Test if pure UI helpers exist: `apps/web/lib/legal/legal-document-metadata.test.ts`

- [x] **Step 1: Add route skeleton using existing document queries**

Build `/workspace/documents/legal` as an operational workbench, not a landing page. It should show:
- legal packet status
- drafts requiring attorney review
- jurisdiction-unverified documents
- missing facts
- counsel packet readiness
- current the operator/DPF packet documents

Use existing DPF theme tokens, compact panels, tables, state badges, and lucide icons. Avoid card-in-card layouts, oversized hero text, decorative gradients, and explanatory marketing copy.

- [x] **Step 2: Add filters and stable dimensions**

The first viewport should support scanning:
- segmented state filter: all, intake, draft, attorney review, approved, archived
- document kind filter
- jurisdiction tag filter
- owner/reviewer filter when data exists

Keep table rows stable. Long document titles and party names must wrap cleanly on mobile and desktop.

- [x] **Step 3: Add detail-page legal context**

On the document detail page, show legal-specific metadata only when the document has legal tags/kinds:
- risk band
- attorney-review status
- jurisdiction tags
- unresolved assumptions
- linked source/corpus references
- linked counsel packet

Do not hide the existing document lifecycle controls; legal actions that publish/approve should flow through proposals when required by Task 6.

- [ ] **Step 4: UX verification**

Run the app through the governed local verification path from AGENTS. For runtime-bound UX verification, use the shared `local-integration-ci` sandbox lease or canonical install after governed advance, not an ungoverned worktree runtime.

Current blocker evidence: on 2026-06-30, preflight for feature SHA `6288bd284658344a4894bc75489002738ebd6542` still could not reach `CAN-TEST`. The CLI preflight reports `MUST-ADVANCE` because the live portal is serving `22fa340a39d2df7e082d3c794e5ffa1bf8188b2b`, which does not contain the feature commit. The MCP preflight reports `BLOCKED` after `git fetch origin` because portal-side ancestry remains uncomputable. Existing blocker: `BI-BB7C0790`.

Capture:
- `/workspace/documents/legal`
- a legal document detail page
- mobile viewport table wrapping
- permission-gated coworker state

## Chunk 7: Customer Archetype Generalization

### Task 9: Add Archetype/Jurisdiction Inputs To Legal Analysis

**Files:**
- Modify: `apps/web/lib/decision-perspective/install-variant-context.ts`
- Modify: `apps/web/lib/decision-perspective/profession-corpus.ts`
- Create or modify tests near: `apps/web/lib/decision-perspective/*test.ts`
- Modify legal skill/corpus files from Chunks 2 and 3

- [x] **Step 1: Write failing tests for context projection**

Add tests that legal analysis receives:
- `StorefrontConfig.archetypeId`
- `Organization` location/jurisdiction fields already exposed by install variant context
- `BusinessContext` geography/industry facts where available
- data residency and sell-to/employ-in jurisdictions

Run the affected decision-perspective tests.

Expected: FAIL if legal context is not yet projected.

- [x] **Step 2: Implement projection using existing context plumbing**

Use the existing `operatesIn`, `sellsTo`, `employsIn`, and `dataResidency` filters. Do not add a second jurisdiction model unless the existing model cannot express the needed legal scope.

- [x] **Step 3: Connect the legal coworker prompt to context**

Update the route prompt and skill guidance so the coworker starts by naming what jurisdiction/archetype facts are known, unknown, and not verified.

- [x] **Step 4: Run context tests**

Run: `pnpm --filter web exec vitest run lib/decision-perspective/profession-corpus.test.ts lib/decision-perspective/profession-corpus-wiring.test.ts lib/decision-perspective/resolve-profession-profile.test.ts`

Expected: PASS.

## Refactoring Allocation

Reserve roughly 20% of implementation effort for these refactors. Do them only when they directly simplify the legal coworker work.

- [x] Extract reusable document kind/tag normalization from `apps/web/lib/documents/document-store.ts` into a small pure helper if legal metadata would otherwise duplicate it.
- [x] Split long route prompt text in `apps/web/lib/tak/agent-routing.ts` into local constants if adding the legal prompt makes the file harder to scan.
- [x] Add a shared legal/compliance permission helper if route and action tests duplicate the same permission gate setup. No helper was added because the legal route has the only explicit compliance capability gate, while legal actions reuse authentication and proposal/document mechanics instead of duplicating route permission setup.
- [x] Tighten profession corpus checklist tests so future registry entries cannot promise pages that do not exist.
- [x] Keep all refactors covered by focused tests and avoid unrelated UI or schema churn.

## Verification Gate

Run the smallest source-local gates after each chunk, then the full gate before PR.

- Agent/skill seed: `pnpm --filter @dpf/db exec vitest run src/agent-model-defaults.test.ts src/agent-identity.test.ts src/seed-skills.test.ts src/skill-quality-audit.test.ts`
- Routing/actions/legal helpers: `pnpm --filter web exec vitest run lib/tak/agent-routing.test.ts lib/tak/agent-grants.test.ts lib/actions/agent-coworker-external.test.ts lib/legal/legal-document-metadata.test.ts lib/legal/operator-packet.test.ts`
- Corpus: `pnpm --filter web exec vitest run lib/decision-perspective/profession-corpus.test.ts lib/decision-perspective/profession-corpus-wiring.test.ts lib/decision-perspective/resolve-profession-profile.test.ts`
- Production build: `pnpm --filter web build`
- UX verification: governed canonical install or shared `local-integration-ci` sandbox lease for `/workspace/documents/legal` and legal document detail pages
- Migration gate if a migration is added: `pnpm --filter @dpf/db exec prisma migrate dev --name legal_document_metadata` during creation, then verify clean apply through the canonical migration gate

## Stop Rules

- Stop if the implementation requires jurisdiction-specific legal conclusions that cannot be sourced from authoritative material.
- Stop if the coworker would send, sign, file, submit, or bind an agreement without explicit human approval.
- Stop if adding legal document metadata requires duplicating the managed document store instead of extending it narrowly.
- Stop if MCP scope blocks backlog/evidence writes; surface the required scope instead of bypassing MCP with direct DB writes.
