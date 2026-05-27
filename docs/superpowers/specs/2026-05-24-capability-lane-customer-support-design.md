---
title: Capability lane — customer support (audit + design)
date: 2026-05-24
status: proposal — awaiting operator review
owner: Mark Bodman (CEO) — proposed by agent
backlog-item: BI-9A86E2A7
epic: EP-BIZ-CAP
relates-to:
  - apps/web/lib/finance/accountant-work-lane.ts (precedent: typed work-lane shape)
  - docs/superpowers/specs/2026-05-24-capability-lane-inventory-procurement-design.md (sibling lane, same shape)
  - packages/db/prisma/schema.prisma (WorkQueue, WorkItem, WorkItemMessage, Engagement, StorefrontInquiry, KnowledgeArticle, CustomerContact)
  - apps/web/lib/tools/integration-coverage-matrix.ts (EmployeeWorkRole enum + integration posture model)
  - apps/web/app/(shell)/storefront/inbox/page.tsx
  - apps/web/app/(shell)/complaints/page.tsx (demo-only — no Prisma model)
  - apps/web/app/(shell)/customer/(crm)/* (sales CRM — NOT customer support)
  - apps/web/app/(shell)/workspace/my-queue/page.tsx
  - apps/web/app/(shell)/knowledge/page.tsx
  - apps/web/app/(shell)/platform/tools/integrations/{microsoft365-communications,whatsapp-business,facebook-pages}/
---

# Capability lane — customer support

## 1. The question

BI-9A86E2A7 (priority 3, medium, triaged-for-build, EP-BIZ-CAP) asks:

> Define the customer support lane for small businesses across **storefront inbox, customer engagement records, workspace queues, complaints, communications channels, and AI coworker coverage**. Acceptance: the lane distinguishes customer support from sales, names current routes and integrations, identifies queue/evidence fields, and states whether `service-support-agent` or `customer-advisor` owns each support step.

This document is the audit deliverable. Same shape as the inventory/procurement audit ([sibling spec](./2026-05-24-capability-lane-inventory-procurement-design.md)) and mirrors the typed precedent in `apps/web/lib/finance/accountant-work-lane.ts`.

## 2. Repo truth (verified 2026-05-24 in this worktree)

### 2.1 Existing Prisma models

| Model | Schema line | Owns | Status |
| --- | --- | --- | --- |
| `WorkQueue` | 8617 | Triage / team / personal / escalation queue with routing policy, SLA, team/portfolio scope | Stable; the canonical queue substrate for support intake. |
| `WorkItem` | 8640 | Generic work item — `sourceType` is free-text so support intake can route here; supports user + agent + thread assignment, urgency, SLA, parent/child, evidence JSON | Stable. The "queue/evidence fields" the BI asks for live here (`evidence Json?`, `routingDecision Json?`, `urgency`, `dueAt`). |
| `WorkItemMessage` | 8686 | Per-item message log with `senderType` (user/agent), `channel` (in-app/email/etc.) | Stable. Per-thread conversation substrate. |
| `CustomerContact` | 112 | Identity-anchor contact record (email, name, phone) | Stable. The customer-identity hinge. |
| `Engagement` | 2560 | **Sales-funnel CRM record** — statuses `new \| contacted \| qualified \| unqualified \| converted`, converts to `Opportunity` | Sales-shaped, NOT support-shaped. See §4 — this is the sales/support boundary the BI names. |
| `StorefrontInquiry` | 7155 | Storefront-side inbound inquiry — `inquiryRef`, `customerEmail`, `customerName`, `message`, `formData`, `status: new \| …` | Stable as a customer-message landing record; no link to WorkItem (no triage-into-queue path yet). |
| `StorefrontBooking` / `StorefrontOrder` / `StorefrontDonation` | 7028 / ~ / 7175 | Other storefront record kinds aggregated into the inbox view | Stable. |
| `KnowledgeArticle` (+ revisions + product/portfolio links) | 8272 | Knowledge article CRUD with revision history | Stable. The self-service substrate. |

### 2.2 Existing routes

| Route | Purpose | Notes |
| --- | --- | --- |
| `/storefront/inbox` | Aggregates `StorefrontInquiry`, `StorefrontBooking`, `StorefrontOrder`, `StorefrontDonation` (last 50 each) | Multi-channel landing view. No triage-to-queue handoff today. |
| `/customer` and `/customer/(crm)/*` | **Sales CRM** — engagements, funnel, opportunities, quotes, sales-orders, customer detail | NOT customer support. See §4. |
| `/customer/marketing/...` | Marketing strategy | Out of this lane. |
| `/complaints` | **Demo-only** complaint tracker built by Build Studio (FB-BB6567DC) — UI uses hardcoded `DEMO_COMPLAINTS` array, no Prisma model | Substrate gap — see §3 #2. |
| `/knowledge` (+ `[articleId]`, `new`) | Knowledge base CRUD | Stable. |
| `/workspace/my-queue` | WorkItem-backed personal queue view | The queue surface for support work. |
| `/workspace` | Workspace home | Aggregator. |
| `/platform/tools/integrations/microsoft365-communications` | Microsoft 365 Email/Outlook/Teams integration page | Wired. |
| `/platform/tools/integrations/whatsapp-business` | WhatsApp Business integration page | Wired. |
| `/platform/tools/integrations/facebook-pages` | Facebook Pages integration page | Wired. |

### 2.3 Coworkers and roles

- **`customer-advisor`** — referenced in `lib/tak/agent-routing.ts`, `lib/marketing/execution.ts`, `lib/testing/route-contracts.ts`. Front-of-house customer-facing AI coworker.
- **`service-support-agent`** — referenced in `lib/tak/agent-routing.ts`, `lib/ai-operations-map/project-routing-topology.test.ts`, `components/workspace/CalendarAgentScheduler.tsx`. Specialist for service-style support cases.
- **`ops-coordinator`** — referenced across multiple files; cross-functional coordinator that handles routing/escalation.
- **`customer_support`** (employee role) — exists in `EmployeeWorkRole` enum (`apps/web/lib/tools/integration-coverage-matrix.ts`).
- **`service_ops`** (employee role) — also in `EmployeeWorkRole` enum; the operations-side complement to `customer_support`.
- **`sales_bd`** (employee role) — distinct from support; needed for §4's sales/support boundary discussion.
- **`owner_operator`** — escalation backstop.

### 2.4 Integration anchors

| Integration | Page | Status today |
| --- | --- | --- |
| Microsoft 365 (Email/Outlook + Teams) | `/platform/tools/integrations/microsoft365-communications` | Wired; the customer-comms tenant binding. |
| WhatsApp Business | `/platform/tools/integrations/whatsapp-business` | Wired. |
| Facebook Pages | `/platform/tools/integrations/facebook-pages` | Wired. |
| Slack | (named in BI; integration catalog) | Native-integration catalog entry exists; check route under `/platform/tools/integrations/` per channel. |
| Gmail | (named in BI) | Catalog-side; same as Slack. |
| HubSpot CRM | (named in BI) | CRM anchor — sales-side, but customer support may touch case records depending on archetype. |

`apps/web/lib/tools/integration-coverage-matrix.ts` defines the typed shape (`IntegrationCoverageMatrixRow` with `posture`, `maturity`, `csdmDomain`, `it4itValueStreams`, `employeeRoles`) — the lane should consume this rather than re-shape integration metadata.

## 3. Missing links / substrate gaps

1. **No `Complaint` Prisma model.** `/complaints` is a Build-Studio-built UI prototype with hardcoded `DEMO_COMPLAINTS` and `useState`. Submitting a complaint does not persist anywhere. Result: severity/category/status fields exist only in the UI, no audit trail, no link to a customer, and no flow into `WorkItem`. **Highest-leverage gap.**
2. **No `StorefrontInquiry → WorkItem` triage link.** A new inquiry lands in `/storefront/inbox` but has no path into the work queue, no assignment, no SLA. The triage is human-only and not evidence-tracked.
3. **`Engagement` is sales-shaped, not support-shaped.** Statuses (`new | contacted | qualified | unqualified | converted`) map to a sales funnel. Customer-service "engagement" (a ticket-style interaction) has no model. Reusing `Engagement` would confuse the sales/support boundary; better to keep it sales-only and let `WorkItem.sourceType="support-inquiry"` carry support cases.
4. **No `WorkItem.customerContactId` link.** `WorkItem` has user + agent + thread assignment but no first-class FK to `CustomerContact`. Support cases routed through `WorkItem` cannot be cleanly "all work for customer X" filtered without abusing the JSON `evidence` field.
5. **No SLA enforcement substrate on support items.** `WorkItem.dueAt` exists; `WorkQueue.slaMinutes` exists as JSON. But there is no "breach event" model, no escalation rule beyond the queue's `routingPolicy`, and no surface that lists "items past SLA."
6. **`KnowledgeArticle` is not yet wired to support handoffs.** Articles exist as a knowledge base but `WorkItem.evidence` does not point at suggested articles; coworker reply drafting does not show "matched articles" to the operator.
7. **No `CustomerEngagement` (service-side) record distinct from sales `Engagement`.** The BI mentions "customer engagement records" — those exist as sales records via `Engagement`, but a service-engagement (case history) record does not exist as a separate shape and is not represented in WorkItem either.
8. **No typed `customer-support-work-lane.ts` module.** The accountant lane has one; the inventory/procurement audit (sibling spec) proposes one. This lane is the third.
9. **No `WorkItem.channelSourceId`-shaped link to messaging-provider artifacts** (a Microsoft 365 message ID, a WhatsApp message ID, a Facebook conversation ID). The `WorkItemMessage.channel` field is the per-reply attribution; the inbound mapping to the originating provider message has no first-class FK.

## 4. Sales vs. support boundary

The BI explicitly asks the lane to "distinguish customer support from sales." Current state:

| Domain | Owns | Routes | Models | Coworker |
| --- | --- | --- | --- | --- |
| **Sales / CRM** | Lead → opportunity → quote → order | `/customer/(crm)/{engagements,funnel,opportunities,quotes,sales-orders,[id]}` | `Engagement`, `Opportunity`, `Quote`, `SalesOrder`, `CustomerAccount`, `CustomerContact` | `sales_bd` employee role; sales-side coworkers (not in this lane) |
| **Customer support** | Inbound inquiry → triage → reply → resolution | `/storefront/inbox` (landing) → `/workspace/my-queue` (triage/work) → `/knowledge` (self-service) → `/complaints` (today: demo) | `StorefrontInquiry`, `WorkQueue`, `WorkItem`, `WorkItemMessage`, `KnowledgeArticle`; **no `Complaint` model** | `customer-advisor`, `service-support-agent`, `ops-coordinator` |

Boundary rule for the lane: a customer interaction is **support** when the operator's next action is "answer / resolve / route to specialist" and there is no expected revenue conversion. It is **sales** when the next action is "qualify / quote / close." Today these two domains share `CustomerContact` (correct) but diverge in their case/engagement substrate (which is gap §3 #3 and #7).

The lane should **not** claim sales surfaces (`/customer/(crm)/*`); it claims `/storefront/inbox`, `/workspace/my-queue`, `/knowledge`, and (when substrate exists) `/complaints`.

## 5. Proposed lane shape

Mirror `apps/web/lib/finance/accountant-work-lane.ts` and the inventory/procurement sibling. The follow-on slice (named in §8) implements:

```ts
// apps/web/lib/customer-support/customer-support-work-lane.ts (proposed — NOT in this PR)

export const CUSTOMER_SUPPORT_WORK_LANE: CustomerSupportWorkLane = {
  roleId: "customer_support",
  roleLabel: "Customer Support",
  taxonomyNodeId: "for_employees/work_coordination_and_communications",
  posture: "hybrid",
  maturityTarget: "observe",
  workstreams: [
    {
      key: "intake",
      label: "Intake — storefront and channels",
      dailyWork: "Watch the storefront inbox and channel surfaces for new inquiries; triage into the work queue.",
      routes: [
        { label: "Storefront inbox", href: "/storefront/inbox" },
        // Channel-specific surfaces today are integration admin pages, not channel inboxes:
        { label: "Microsoft 365 communications", href: "/platform/tools/integrations/microsoft365-communications" },
        { label: "WhatsApp Business", href: "/platform/tools/integrations/whatsapp-business" },
        { label: "Facebook Pages", href: "/platform/tools/integrations/facebook-pages" },
      ],
      handoffRule:
        "Customer Advisor reads the inbox and prepares triage proposals; the work item is created in the support queue once a human or service-support-agent accepts the triage.",
    },
    {
      key: "queue",
      label: "Triage and assignment",
      dailyWork: "Convert inquiries into WorkItems, set urgency and SLA, assign to a user/agent, and watch for SLA breach.",
      routes: [
        { label: "My queue", href: "/workspace/my-queue" },
      ],
      handoffRule:
        "Ops Coordinator owns routing policy and escalation; Service Support Agent owns the actual response work once an item is claimed.",
    },
    {
      key: "respond",
      label: "Respond and resolve",
      dailyWork: "Reply through the right channel, attach matched knowledge articles, mark item resolved with evidence.",
      routes: [
        { label: "My queue", href: "/workspace/my-queue" },
        { label: "Knowledge base", href: "/knowledge" },
      ],
      handoffRule:
        "Service Support Agent drafts replies in proposal mode; outbound send goes through governed channel adapters once write-back gates exist.",
    },
    {
      key: "complaints",
      label: "Complaints handling",
      dailyWork: "Capture, classify, investigate, and resolve complaints with severity tracking and accountable owner.",
      routes: [
        { label: "Complaints", href: "/complaints" },
      ],
      handoffRule:
        "DEMO-ONLY today (gap §3 #1). Lane should explicitly flag the demo state until a Complaint model lands; owner-operator is the backstop for any escalation that touches the page meanwhile.",
    },
    {
      key: "knowledge",
      label: "Knowledge curation",
      dailyWork: "Promote recurring resolutions into knowledge articles; tag by product/portfolio.",
      routes: [
        { label: "Knowledge base", href: "/knowledge" },
        { label: "New article", href: "/knowledge/new" },
      ],
      handoffRule:
        "Customer Advisor proposes article drafts from resolved cases; human approves before publish.",
    },
  ],
  handoffs: [
    {
      actorId: "customer-advisor",
      actorKind: "ai-coworker",
      label: "Customer Advisor",
      responsibility: "Read inbox and channels, propose triage, draft inquiry responses, surface matching knowledge articles.",
      boundary: "Proposal mode only for customer-visible sends until channel write-back gates exist.",
    },
    {
      actorId: "service-support-agent",
      actorKind: "ai-coworker",
      label: "Service Support Agent",
      responsibility: "Own the actual response work on claimed items: drafting, knowledge lookup, evidence capture, resolution.",
      boundary: "Cannot close items the operator has not approved; cannot send outbound without governed adapter scopes.",
    },
    {
      actorId: "ops-coordinator",
      actorKind: "ai-coworker",
      label: "Ops Coordinator",
      responsibility: "Own routing policy, queue assignment, SLA monitoring, escalation triggers.",
      boundary: "Routes work; does not perform response work itself.",
    },
    {
      actorId: "customer_support",
      actorKind: "employee-role",
      label: "Customer Support (employee role)",
      responsibility: "Final-decision authority on customer-visible action and complaint disposition.",
      boundary: "Approval gate for all writes that touch the customer's record or outbound channel.",
    },
    {
      actorId: "service_ops",
      actorKind: "employee-role",
      label: "Service Ops",
      responsibility: "Operational follow-through on resolutions that touch fulfilment / scheduling.",
      boundary: "Crosses into operations lane; not the support owner.",
    },
    {
      actorId: "owner_operator",
      actorKind: "employee-role",
      label: "Owner / Operator",
      responsibility: "Backstop for escalations, complaint resolutions with material customer impact, and policy decisions.",
      boundary: "Escalation backstop; not in the daily triage flow.",
    },
    {
      actorId: "future-complaint-handler-specialist",
      actorKind: "missing-coworker",
      label: "Future complaint-handler specialist",
      responsibility: "Investigate and resolve complaints with severity tracking once a Complaint model exists.",
      boundary: "Missing coworker; track as a later capability once the substrate lands (gap §3 #1).",
    },
  ],
  providerBoundaries: [
    {
      provider: "microsoft365-communications",
      label: "Microsoft 365 Email/Outlook + Teams",
      href: "/platform/tools/integrations/microsoft365-communications",
      posture: "import-staging",
      currentCoverage: [], // populate from integration-coverage-matrix entries
      missingCoverage: ["Inbound message routing into WorkItem", "Outbound send governance", "Conversation thread persistence"],
      writeBoundary: "No outbound send until consent, retention, and audit boundaries are proven (replacement-gate per BI).",
      nextBacklogItemId: "(open) — Channel write-back gate spec",
    },
    {
      provider: "whatsapp-business",
      label: "WhatsApp Business",
      href: "/platform/tools/integrations/whatsapp-business",
      posture: "import-staging",
      currentCoverage: [],
      missingCoverage: ["Inbound message routing into WorkItem", "Template-message send governance", "Opt-in/consent state"],
      writeBoundary: "No outbound send until WhatsApp template approval state is tracked.",
      nextBacklogItemId: "(open) — WhatsApp inbound routing",
    },
    {
      provider: "facebook-pages",
      label: "Facebook Pages",
      href: "/platform/tools/integrations/facebook-pages",
      posture: "import-staging",
      currentCoverage: [],
      missingCoverage: ["Page-inbox routing", "Comment-moderation flow", "Public-vs-private reply policy"],
      writeBoundary: "No outbound until public-reply policy is decided per archetype.",
      nextBacklogItemId: "(open) — Page-inbox routing",
    },
    {
      provider: "slack",
      label: "Slack",
      href: "/platform/tools/integrations/slack",
      posture: "not-mapped",
      currentCoverage: [],
      missingCoverage: ["Channel-vs-DM scoping", "Triage workflow"],
      writeBoundary: "Pre-replacement: Slack is internal-collab; customer-support routing TBD.",
      nextBacklogItemId: "(open) — Slack support-routing decision",
    },
    {
      provider: "gmail",
      label: "Gmail",
      href: "/platform/tools/integrations/gmail",
      posture: "not-mapped",
      currentCoverage: [],
      missingCoverage: ["Inbound routing", "Outbound send governance"],
      writeBoundary: "Parallel to Microsoft 365 path; cannot land until tenant binding is proven.",
      nextBacklogItemId: "(open) — Gmail tenant binding",
    },
    {
      provider: "hubspot-crm",
      label: "HubSpot CRM",
      href: "/platform/tools/integrations/hubspot",
      posture: "not-mapped",
      currentCoverage: [],
      missingCoverage: ["Case-record sync", "Owner attribution"],
      writeBoundary: "HubSpot is the CRM anchor — support side touches it only when archetype warrants case-record duplication.",
      nextBacklogItemId: "(open) — HubSpot support-case sync decision",
    },
  ],
  promotionGuardrail:
    "DPF can own customer work queues and evidence before owning every channel of communication. External messaging tenants remain provider-led until read/write, consent, retention, and audit boundaries are proven (replacement-gate from BI header).",
  nextWorkflow: {
    backlogItemId: "(see §8)",
    title: "Smallest next buildable slice — see §8",
    route: "/storefront/inbox",
    reason:
      "StorefrontInquiry → WorkItem triage is the highest-leverage substrate fix because it activates the queue substrate the rest of the lane depends on.",
  },
};
```

## 6. Queue / evidence fields (per BI acceptance)

The BI asks the lane to "identify queue/evidence fields." Today's `WorkItem` carries:

| Field | Type | Used for |
| --- | --- | --- |
| `sourceType` | `String` | Triage source label — support intake can set e.g. `"storefront-inquiry"`, `"channel-microsoft365"`, `"complaint"`. |
| `sourceId` | `String?` | Optional FK target (today, free-text). |
| `urgency` | `String` (`routine` default) | Triage urgency. |
| `effortClass` | `String` (`medium` default) | Effort sizing. |
| `workerConstraint` | `Json` | Required worker capability shape. |
| `queueId` | FK to `WorkQueue` | Triage destination. |
| `status` | `String` (`queued` default) | Lifecycle. |
| `assignedToType/UserId/AgentId` | Type + FK | Single-claim assignment. |
| `assignedThreadId` | `String?` | Coworker thread continuity. |
| `dueAt` | `DateTime?` | SLA target. |
| `evidence` | `Json?` | Free-form evidence blob — knowledge-article matches, channel context, customer-contact id, screenshots. |
| `routingDecision` | `Json?` | Routing-policy audit trail. |
| `parentItemId` | FK self | Sub-case hierarchy. |
| `a2aTaskId` | `String?` | Agent-to-agent task reference. |

Per-message context lives in `WorkItemMessage` (`channel`, `senderType`, `body`, `structuredPayload`, `deliveredAt`, `readAt`, `respondedAt`, `response`).

Gap §3 #4 — a first-class `customerContactId` FK is missing; the lane should propose adding it as part of the next slice (or via Candidate A in §8) so customer-scoped filtering is clean.

## 7. Integration anchors — concrete

| Anchor | Today | Lane consumes |
| --- | --- | --- |
| Microsoft 365 Email/Outlook + Teams | Integration page wired | `IntegrationCoverageMatrixRow` entry; lane provider boundary cites posture/maturity from there. |
| WhatsApp Business | Integration page wired | Same — typed matrix row drives lane state. |
| Facebook Pages | Integration page wired | Same. |
| Slack | Catalog entry; per-channel routing TBD | Lane marks `posture: "not-mapped"` until routing decision lands. |
| Gmail | Catalog entry | Same. |
| HubSpot CRM | Catalog entry | Lane marks `posture: "not-mapped"`; sales-side primarily. |

## 8. Smallest next buildable slice

Three candidates considered; one recommended.

### Candidate A — Persist complaints + wire to WorkItem

- **Scope:** add `Complaint` Prisma model (severity, category, status, customerContactId, description, resolvedAt, resolvedById, slaBreachedAt). Replace `/complaints` demo data with real persistence. Add `WorkItem.sourceType="complaint"` triage so complaints can enter the work queue with full evidence trail.
- **Pro:** closes the most visible substrate gap (§3 #1). Operator-visible immediately. Unblocks the complaint-handler specialist coworker spec.
- **Pro:** small, additive — one new model, no schema changes elsewhere.
- **Con:** does not yet activate the inbox→queue triage path.
- **Verdict:** Recommended if "fix the visible demo" is the priority.

### Candidate B — StorefrontInquiry → WorkItem triage link

- **Scope:** add `WorkItem.customerContactId String?` FK to `CustomerContact` (closes gap §3 #4). Add an action on `/storefront/inbox` that creates a `WorkItem` from a `StorefrontInquiry` row (sourceType="storefront-inquiry", sourceId=inquiry.id, assigned to default support queue). Add a counterpart `StorefrontInquiry.workItemId String?` so the inbox shows triage state.
- **Pro:** activates the queue substrate for the rest of the lane. Highest *substrate* leverage.
- **Pro:** introduces no new persistence surfaces — uses existing models.
- **Con:** complaint demo stays demo (Candidate A).
- **Verdict:** Recommended if "activate the queue path" is the priority.

### Candidate C — Land the typed lane module + Platform Development index entry

- **Scope:** implement `apps/web/lib/customer-support/customer-support-work-lane.ts` (the shape this audit proposed) and surface it alongside the accountant lane in Platform Development.
- **Pro:** governance/visibility win; lane operator-visible immediately.
- **Con:** closes zero substrate gaps. Best stacked on top of A or B.
- **Verdict:** Worthwhile alongside A or B in the same PR if review bandwidth allows.

**Recommendation:** ship **Candidate B** as the smallest next slice (highest substrate leverage, makes the queue substrate operate). Stack Candidate C on the same PR if review bandwidth allows; otherwise sequence A → C → B or B → A → C as separate BIs.

## 9. Out of scope (carry to follow-on BIs if surfaced)

- The full `Complaint` model + investigation workflow (Candidate A is a follow-on if not picked as the smallest slice).
- Outbound channel write-back (replacement gate must fire first per BI header).
- HubSpot case-record sync (archetype-driven decision).
- A separate `CustomerServiceEngagement` model — recommend using `WorkItem` rather than parallel substrate (see §4).
- Sales/CRM substrate (`/customer/(crm)/*` and `Engagement`/`Opportunity`/`Quote`/`SalesOrder`) — explicitly out of this lane.
- SLA-breach-event model and escalation triggers — defer to a separate slice once the queue path is active.

## 10. Open decisions

1. **Approve the proposed lane shape (§5)?** Recommendation: yes — mirrors the accountant + inventory/procurement precedents.
2. **Pick the smallest-next-slice candidate.** Recommendation: Candidate B (StorefrontInquiry → WorkItem triage) — substrate leverage. Candidate A (Complaint persistence) is the visible-demo fix if priorities flip.
3. **Stack Candidate C on top of B in the same PR, or split?** Recommendation: split.
4. **Where does the complaint substrate live when it lands?** Recommendation: separate `Complaint` model with FK to `CustomerContact` and `WorkItem`-attachment via `WorkItem.sourceType="complaint"`. Do NOT extend `Engagement` (sales-shaped) or `StorefrontInquiry` (intake-shaped).
5. **Should `WorkItem.customerContactId` be added with this lane, or filed as a separate small BI?** Recommendation: bundle it with Candidate B; it's the FK that makes the inbox→queue triage useful.

## 11. Definition of done

- This audit doc is reviewed and accepted or revised.
- Either:
  - **Candidate B is filed as a new BI** with a pointer back to this audit (recommended path), OR
  - The audit is left in place as the substrate map for whichever effort touches customer support next.
- BI-9A86E2A7 acceptance criteria all met:
  - distinguishes customer support from sales ✓ (§4)
  - names current routes and integrations ✓ (§2.2, §2.4, §7)
  - identifies queue/evidence fields ✓ (§6)
  - states whether `service-support-agent` or `customer-advisor` owns each support step ✓ (§5 handoffs)
- BI-9A86E2A7 closes on merge.
