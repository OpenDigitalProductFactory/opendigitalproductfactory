# Coworker Identity 360 — One Identity, Every Facet, For Humans and Agents

**Status:** Draft for founder review (2026-08-06). Research + design pass.
**Date:** 2026-08-06
**Author:** Claude Code (external, branch `claude/ai-coworker-identity-hub`)
**Epic:** proposes **`EP-COWORKER-IDENTITY-360`** (new) — extends, does not duplicate, `EP-COWORKER-RT` (management consolidation) and `EP-AI-WORKFORCE-001` (HRIS record).
**Predecessor specs to read first:**
- [`2026-06-26-coworker-management-consolidation-design.md`](2026-06-26-coworker-management-consolidation-design.md) — the *management/admin* consolidation (one record, one name, one priority dial). **Largely shipped.** This spec is its identity-facing sibling, not a redo.
- [`2026-06-13-ai-coworker-hris-management-surface-design.md`](2026-06-13-ai-coworker-hris-management-surface-design.md) — the tabbed record IA that exists today at `/platform/ai/agent/[agentId]`.
- [`2026-04-23-a2a-aligned-coworker-runtime-design.md`](2026-04-23-a2a-aligned-coworker-runtime-design.md) + `2026-06-30-coworker-service-offer-catalog-design.md` — the A2A agent-card / offer projection (the machine-facing face).

---

## 1. Problem (validated against live code, not assumed)

The founder's words: *"The AI coworker has evolved as a non-human identity, alongside our employees. But the user-experience surfaces are not bringing them together as an identity to see all things related to them. The details are in many places. I have no single place to see them all, then drill into and expand one aspect — what it is defined as, what it does, who engages / has engaged it, the costs, the skills. When you look at a person or a customer, we do this. We need to research what we have, plan a better approach, and design a target — easier for employees, and even other AI use-cases that need to interact with them."*

A four-stream code audit (data model, UX surfaces, cost path, engagement path) confirms this — with an important nuance. The platform is **not** missing a coworker record. It is missing a coworker **identity**.

### 1.1 The data already exists — richly

`Agent` (`schema.prisma:3295`) is the canonical entity, surrounded by ~25 satellite tables. Every facet the founder named already has a store:

| Facet | Where it lives today |
| --- | --- |
| **Definition** | `Agent` (displayName/kind/tier/role/valueStream/supervisor), `agent_registry.json` (seed), `AgentGovernanceProfile`, `AgentPromptContext`, `AuthorityBinding`, persona prompt files, ScreenManifest (code) |
| **Skills / tools** | `AgentSkillAssignment`, `SkillDefinition` (catalog), `AgentToolGrant` (+revocation tombstones), `AgentCapabilityClass` |
| **What it does** | `CoworkerService` / `CoworkerOffer` (work offered), `WorkEngagement` (its own recurring work), `ScheduledAgentTask`, `BacklogItem.agentId` |
| **Who engages / has engaged it** | `CoworkerEngagement` (`requestedByUserId` / `requestedByAgentId`), `AgentThread` / `AgentMessage` (conversation counterparties), `DelegationGrant` (human grantors), `BacklogItem.claimedByAgentId` |
| **Costs** | `TokenUsage` (`costUsd`, `inferenceMs` per `agentId`), `AgentBudgetEvent` (`amountUsd` Decimal), `CoworkerTurnMetric`, the Reduction-Gear cost ledger, `AgentExecutionConfig` (budget limits), `AgentModelConfig.budgetClass` |
| **Behaviour / health** | `AgentPerformance`, `CoworkerSelfAssessment`, `CoworkerCapabilityNeed`, `AgentSurfaceReadiness`, regression detector |

The data is not the gap. The **unification surface** is.

### 1.2 A record exists — but it is positioned as platform *admin*, not as an *identity*

`/platform/ai/agent/[agentId]` is a genuinely rich, 7-tab record (Overview · Work Offered · Availability · Capabilities · Autonomy & Governance · Activity · Backlog) — in fact **richer than the human employee "profile,"** which is only a selected panel inside `/employee` with no dedicated `/[id]` URL.

But it lives inside the **AI platform-administration** section, framed as HRIS configuration ("clicks-to-edit a coworker's model/prompt/priority"). The founder does not want to *administer* a coworker there; he wants to *look at* a coworker the way he looks at:

- a **Customer** — `/customer/[id]`: a canonical per-entity URL, a KPI band, an activity **timeline**, and stacked drill-in sections (contacts, estate, opportunities, engagements). This is the strongest 360 template in the app.
- a **Person** — `/employee`: a people directory with a profile panel.

The coworker identity is **not co-located** with these peers, and it is **not built in their idiom**. That is the "no single place / it's all over" feeling, even though a record exists.

### 1.3 Two of the named facets are surfaced *nowhere* on the identity

- **Costs.** Per-coworker spend is real in the data (`TokenUsage.costUsd` / `AgentBudgetEvent.agentId`) but is rendered only **fleet-wide** at `/platform/ai/providers`. A coworker's own record shows model tier and priority — **never what it has cost.** (`AgentBudgetEventsPanel` is mounted only on the providers page.)
- **Who engages / has engaged it.** `CoworkerEngagement` (with `requestedByUserId` / `requestedByAgentId`) is consumed only inside the service-catalog engine (`lib/coworker-service-catalog/*`) and appears in **no coworker UX page**. Meanwhile the **customer** identity *does* have an engagements 360 (`/customer/(crm)/engagements`, `/customer/(crm)/[id]`). Customers get relationship history; coworkers do not — the exact asymmetry the founder names.

### 1.4 The scatter is still real

Even with the record, individual facets *also* have their own top-level pages: `/platform/ai/skills`, `/prompts`, `/assignments`, `/memory`, `/coworker-decisions/*`, `/platform/identity/agents`. The record's Related-Actions menu **links out** to `/prompts`, `/skills`, `/assignments` rather than being self-contained. So a coworker's detail genuinely is spread across 6+ surfaces.

### 1.5 There is no single identity projection for *other AI*

The founder's last clause — *"even other AI use-cases that need to interact with them"* — has no clean answer today. The machine-facing face is **per-offer** (`GET /api/a2a/coworkers/[agentId]/offers/[offerId]` → `application/agent-card+json`). There is **no canonical identity resource** for the whole coworker that both the human page and another agent resolve to. Humans see one construction; agents see a different, narrower one.

---

## 2. Goal & non-goals

**Goal.** Make the AI coworker a **first-class identity** you inspect exactly the way you inspect a Person or a Customer: one canonical URL, one at-a-glance summary, and drill-in facets for *definition · what it does · who has engaged it · cost · skills · governance · behaviour* — built from the data that already exists, and **projected once** so both a human and another agent resolve the same identity.

**Validate by:** (a) a coworker identity reachable in the same idiom and nav altitude as People/Customer; (b) the two missing facets (cost, engagements) present on the identity; (c) one read-model → two consumers (human page + `agent-card+json`); (d) net reduction in distinct surfaces needed to answer "tell me everything about this coworker."

**Non-goals (this pass).**
- **Not** rebuilding the record's edit affordances — `EP-COWORKER-RT` shipped in-place editing of prompt/skills/priority; we **reuse** it. This is a *read/identity* surface, admin edits stay where they are (linked).
- **Not** re-modelling identity — `Agent` + `PrincipalAlias` is the spine (AGENTS.md §11); this is projection, not new identity tables.
- **Not** changing what any coworker *does* or its governance semantics.
- **Not** inventing cost/engagement data — it exists; we surface it.

---

## 3. Research & benchmarking (AGENTS.md §10)

The founder framed the target as "the way you look at a person or a customer." We benchmarked the **identity-360 pattern** both inside the app and against the market.

**Internal templates.**
- **Customer 360 (`/customer/[id]`)** is the reference: canonical per-entity URL → header + status → **KPI band** → two-column body with an **activity timeline** (icon-typed events) beside stacked **drill-in sections** (contacts, estate, opportunities, engagements) → related records below. Sectioned drill-in, not a bare tab bar.
- **People (`/employee`)** proves the *directory→profile* idiom but is *weaker* (no per-entity URL). The coworker should not regress to that; it already has a dedicated URL.

**Market (identity/360 surfaces, data-model level).** Salesforce **Account/Contact 360** (one record, related lists, activity timeline, "everything touching this entity"); Microsoft **Entra ID / service-principal & workload-identity** pages (a non-human identity with owners, credentials, sign-in activity, permissions, cost/usage) — the closest external analog to "a non-human identity you inspect like a person"; Okta **Universal Directory** (people + non-human identities in one directory with per-identity drill-in); observability **service catalogs** (Backstage/OpsGenie service pages: owner, dependencies, on-call, cost, activity). The consistent pattern: **stable identity + owner + capabilities + relationships + activity + cost, on one page, with the same chrome for human and non-human principals.**

**Patterns adopted.**
1. **One identity, one URL, same idiom as its peers.** A coworker identity lives beside People and Customer, not inside platform admin. (Deep-links from `/platform/ai/...` remain for admins.)
2. **Summary-first, drill-in progressive disclosure.** A KPI/chip band answers "who is this and what is it set to" in one glance; facets expand on demand (kernel: progressive disclosure).
3. **Relationships are first-class (the missing facet).** "Who has engaged this coworker" — humans *and* other agents — rendered as a counterparty list + activity timeline, mirroring customer engagements.
4. **Cost belongs to the identity, not just the fleet.** Per-coworker spend, trend, and budget posture on the identity itself.
5. **One read-model, two projections.** The same identity read-model renders the human page **and** a whole-coworker `agent-card+json` at `/api/a2a/coworkers/[agentId]` (identity, capabilities, offers, engagement/authority boundaries) — so "other AI use-cases" resolve the same identity a human sees.

**Patterns rejected / bounded.**
- **A new `Coworker` table / identity store.** Rejected — `Agent` is canonical; adding a parallel identity is the exact fragmentation being fixed.
- **A second edit surface.** Rejected — editing stays in the `EP-COWORKER-RT` record; the 360 is read/inspect + deep-link to edit.
- **Cross-org / external identity federation.** Out of scope; `PrincipalAlias` already reserves the seam.

---

## 4. Design

### 4.1 The Coworker Identity 360 (one page, the customer-360 idiom)

A single identity surface per coworker, composed from the existing read-model (`loadCoworkerRecord`) plus two new projections (cost, engagements):

- **Identity header.** `displayName` + `kind` chip + `family`/area + supervisor + lifecycle/health dot; raw `agentId`/GAID/slug behind a "technical identity" disclosure (already the record's pattern). Primary action: **Ask <name>**. Secondary: **Manage** (deep-links to the admin record for edits).
- **Summary band (at-a-glance).** Model tier · effective priority (Cost/Quality/Time) · # skills · # tools · autonomy (HITL) tier · **30-day cost** · **active/likely engagements** · availability. One row answers "who is this and what is it set to."
- **Body — activity timeline + stacked drill-in facets** (customer-360 layout):
  - **Definition** — plain-language job (persona `# Role` / `# Accountable For` / `# Out of scope`), value stream, governance/authority boundary. *"What it is defined as."*
  - **What it does** — services/offers (`CoworkerService`/`CoworkerOffer`), recurring `WorkEngagement`, scheduled tasks, its backlog slice. *"What it does."*
  - **Engagements & relationships (NEW)** — counterparties who have engaged it: humans (`CoworkerEngagement.requestedByUserId`, `DelegationGrant.grantorUserId`, thread users) and **other agents** (`requestedByAgentId`, A2A tasks), with recency, outcome, and a link to each engagement. *"Who engages / has engaged it."*
  - **Cost (NEW)** — 30/90-day spend from `TokenUsage`/`AgentBudgetEvent`, trend sparkline, top cost drivers (by model/route/engagement), budget posture vs `AgentExecutionConfig` limits, and rejections. *"The costs."*
  - **Skills & capabilities** — assigned `SkillAssignment` + `AgentToolGrant` (read view; edit deep-links to the record). *"The skills."*
  - **Behaviour & health** — `AgentPerformance`, self-assessments, capability needs, readiness/regression signals.
- **Activity timeline** (left/primary column, icon-typed like customer): engagements, conversations, decisions/defers, cost spikes, grant changes, self-assessments — the union of the facet edges as a chronological stream.

### 4.2 Positioning & IA

- **Canonical route:** a per-identity URL in the identity idiom (e.g. `/workforce/[agentId]` or `/identity/coworker/[agentId]`), surfaced beside **People** and **Customers** in the primary nav. Exact route is a review decision (§8).
- The existing `/platform/ai/agent/[agentId]` **admin record** stays for configuration and is reachable via **Manage**; the 360 is the identity/inspection front door. (No hard 308 on the admin record — it is not moving; a new identity surface is added.)
- The **directory** (`/platform/ai/overview` roster) gains an "open identity" affordance; longer term the roster is the identity directory (peer to People directory).

### 4.3 One read-model, two projections (the "other AI" pillar)

Define a single `CoworkerIdentity` read-model (extend `loadCoworkerRecord`) that projects to:
1. **Human page** — the 360 above.
2. **`GET /api/a2a/coworkers/[agentId]`** → `application/agent-card+json`: a **whole-coworker** identity card (identity, capabilities/skills summary, available offers, authority + data boundary, engagement entry-points) — the identity-level complement to today's per-offer card. Access-profile gated exactly like the offer card (`internal-a2a` vs public), reusing `projectCoworkerOfferAgentCard`'s access model.

This closes "even other AI use-cases that need to interact with them": an external agent resolves the **same identity** a human sees, at a stable identity URL, in the A2A-standard media type.

### 4.4 Data-model impact

**Additive and low-risk. No new identity tables.**
- **No schema change required for v1** — cost and engagements are read-projections over existing tables (`TokenUsage`, `AgentBudgetEvent`, `CoworkerEngagement`, `DelegationGrant`, `AgentThread`).
- Watch the known **join seam**: some relations key `Agent.id` (cuid), others `Agent.agentId` (business id). The read-model must resolve both (the record loader already does).
- Optional later: a materialized `CoworkerCostRollup` if live aggregation over `TokenUsage` is too heavy at directory scale (defer until measured — no premature table).

---

## 5. Validation — surfaces & questions answered

| Question | Today | Target |
| --- | --- | --- |
| "Show me everything about this coworker" | 6+ surfaces (record + skills + prompts + assignments + memory + decisions + providers-for-cost) | **1 identity page**, drill-in facets |
| "Who has engaged this coworker (people **and** agents)?" | surfaced nowhere | **Engagements facet + timeline** |
| "What has this coworker cost?" | fleet-wide only (`/providers`) | **Cost facet on the identity**, 30/90-day + drivers |
| "Look at it like a person/customer" | buried in platform admin, different idiom | **Peer identity URL**, customer-360 idiom, beside People/Customers |
| "Let another agent resolve this coworker" | per-offer card only | **Whole-coworker `agent-card+json`** at a stable identity URL |
| "What is it defined as / what does it do / its skills" | spread across record tabs + catalogs | **Definition / What-it-does / Skills facets** on one page |

A change is "done" only when its row hits target, evidenced by a live click-through on the canonical install (AGENTS.md gate).

---

## 6. Phasing (each independently shippable)

**Sequencing decision (founder, 2026-08-06): build the full 360 page first** — do not ship an interim record-only pass. The Cost and Engagements facets are built *as part of* the new Identity 360 page, in the peer identity position, rather than first bolted onto the existing admin record.

- **Phase 1 — The Coworker Identity 360 page (peer position) + the Cost & Engagements facets.** Compose the customer-360-idiom identity page at the new canonical peer URL (beside People/Customers), carrying all facets. The two founder-named facets that exist on the identity nowhere today — **Cost** (per-coworker read-projection over `TokenUsage` + `AgentBudgetEvent`; reuse `AgentBudgetEventsPanel` + a per-agent `budget-events-data` query) and **Engagements** (`CoworkerEngagement` + `DelegationGrant` + thread counterparties, Person vs AI) — ship on this page from day one. **Manage** deep-links to the existing `/platform/ai/agent/[agentId]` admin record for edits. Zero schema.
- **Phase 2 — One read-model, two projections.** Refactor to a single `CoworkerIdentity` read-model behind the page; add `GET /api/a2a/coworkers/[agentId]` whole-coworker `agent-card+json` with the existing access-profile gate, so other AI resolves the same identity.
- **Phase 3 — Consolidation & directory.** Re-point facet deep-links; make the roster the identity directory (peer to the People directory); demote standalone facet pages to catalogs/observatories (continues `EP-COWORKER-RT` WS3).

---

## 7. Relationship to existing work / overlap (checked)

- **Extends** `EP-COWORKER-RT` (management consolidation — largely shipped) and `EP-AI-WORKFORCE-001` (the tabbed record). This spec is their **identity-facing** sibling: they made the coworker *manageable*; this makes it *an identity you inspect like a person/customer*.
- **Reuses** the A2A offer-card access model (`projectCoworkerOfferAgentCard`) for the new identity card.
- **Live backlog + open-epics sweep (2026-08-06):** no in-flight "identity 360 / hub" epic or BI found; nearest neighbours (`EP-A2A`, `EP-COMPANY-IAM-FOUNDATION`, `EP-EMPLOYEE-OCCUPATION`) are adjacent, not overlapping. Proceed as a new epic; final epic placement is a founder decision (§8).

---

## 8. Review decisions

1. **Canonical route / positioning — DECIDED (founder, 2026-08-06):** a **peer identity area beside People and Customers** (e.g. `/workforce/[agentId]`), surfaced in the primary nav at the same altitude. The existing `/platform/ai/agent/[agentId]` admin record stays and is reached via **Manage**. (Exact path token finalized at implementation.)
2. **Epic — DECIDED:** new epic **`EP-COWORKER-IDENTITY-360`** (distinct product concept + validation from the shipped `EP-COWORKER-RT` management consolidation).
3. **Sequencing — DECIDED (founder, 2026-08-06):** **build the full 360 page first** (no interim record-only pass). Cost + Engagements facets ship as part of the new page — see §6.
4. **Machine identity card scope — still open.** What an external (public) agent may see of a coworker identity vs `internal-a2a`. *Recommendation:* reuse the offer card's access-profile boundary verbatim; confirm at the Phase-2 PR gate.

---

## 9. Sources

Internal: code audit of `schema.prisma` (`Agent` + ~25 satellites), `agent-identity.ts`, `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx`, `apps/web/app/(shell)/customer/(crm)/[id]/page.tsx`, `apps/web/app/(shell)/employee/page.tsx`, `lib/coworker-service-catalog/*`, `components/platform/AgentBudgetEventsPanel.tsx`, `api/a2a/coworkers/[agentId]/offers/[offerId]/route.ts`; predecessor specs listed at top. External (identity-360 pattern, data-model level): Salesforce Account/Contact 360; Microsoft Entra workload identities / service principals; Okta Universal Directory; Backstage service catalog.
