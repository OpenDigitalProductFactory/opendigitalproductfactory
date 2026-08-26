---
status: active
---

# The Attention Surface — a kernels-first "Needs you" inbox, separate from the work backlog

| Field | Value |
| ----- | ----- |
| Status | **Design-first (spec only, no feature code).** For founder review. Keystone + slices filed under new epic `EP-ATTENTION-SURFACE`. |
| Date | 2026-06-23 |
| Trigger | Founder (Mark): the escalation band lives on the `/ops` Backlog (a category error); model the real home on mature HITL products — a question queue + email/message to approve-or-ask — with kernels-first routing so a human only sees the residue. |
| Predecessor | [2026-06-23 escalation surface honest-context + auto-resolve](2026-06-23-escalation-surface-honest-context-and-auto-resolve-design.md) (PR #2315, commit d813ee67a) — made the band legible; this spec gives it the right home. |
| Anchor doctrine | [2026-06-20 issue-report surface attendance](2026-06-20-issue-report-surface-attendance-design.md) §5.7 (two front doors: work vs decisions), §14 (trust dial). `BI-0ACD9AB2` is the OPEN receiving-loop BI this composes with. |
| Related substrate | [`Notification`](../../../packages/db/prisma/schema.prisma) (schema.prisma:4362), [`/api/v1/notifications`](../../../apps/web/app/api/v1/notifications/route.ts), [`/api/v1/governance/approvals`](../../../apps/web/app/api/v1/governance/approvals/route.ts), [`command-center`](../../../apps/web/lib/workspace/command-center.ts), [`escalation-attention`](../../../apps/web/lib/quality/escalation-attention.ts), [`evaluateDecisionPerspective`](../../../apps/web/lib/decision-perspective/evaluator.ts), [`evaluateBuildStudioDecision`](../../../apps/web/lib/build/decision-service.ts), [`option-scoring`](../../../apps/web/lib/decision/option-scoring.ts), [`founder-review`](../../../apps/web/app/(shell)/platform/ai/founder-review/page.tsx), [`portal-navigation-model`](../../../apps/web/lib/navigation/portal-navigation-model.ts). |
| Related designs | [Paused AI work approval surface](../plans/2026-05-13-paused-ai-work-approval-surface.md), [Realtime HITL + mobile companion](2026-05-13-realtime-hitl-mobile-companion-design.md), [Portal UX simplification spine](../plans/2026-05-26-portal-ux-simplification-spine.md), [Build Studio overseer UX](2026-06-22-build-studio-overseer-ux-design.md). |
| Composes epics | `EP-INTAKE-UNIFY` (the WORK front door — peer), `EP-WWMD-MCP` (record-outcome write-back), `EP-HITL-MOBILE` (channels), `EP-COWORKER-INTERACTIVITY` (cross-page HITL handoff), `EP-LEARNING-COMMONS` (trust-dial tuning), `EP-BUILD-STUDIO-UX` (BI-FD796419 "Where we need you" band), `EP-NAV-COHERENCE` (DONE — nav rules to obey). |
| 2026-06-29 addendum | Founder direction: AI Coworkers should act as proactive custodians, not passive task lists. Backlog: `BI-5B6F666F` (platform primitive) + `BI-ACB04A21` (Build Studio pilot). |

---

## 0. Thesis — two planes, not one queue

DPF has been folding "a human must decide this **now**" into the `/ops` Backlog because of the 2026-06-20 "converge everything into /ops" directive. That conflated two planes that have different cadence, different owners, and different half-lives:

| Plane | Cargo | Question it answers | Cadence | Home today | Home it needs |
| ----- | ----- | ------------------- | ------- | ---------- | ------------- |
| **Backlog** | Work to **schedule** — features, bugs, chores | "What should we build next?" | Planned, prioritized, eventually built | `/ops` (✓ correct) | `/ops` (unchanged) |
| **Attention** | Decisions to **make now** — escalations, approvals, reviews, paused AI | "What needs *me*, and why can't the AI finish it?" | Blocking, time-sensitive, perishable | Scattered across ~10 routes; escalations wrongly on `/ops` | **One "Needs you" inbox on `/workspace`** |

The 2026-06-20 design already named the principle — **two front doors, one drain each**: `ingestBacklogItem` drains *work* queues into the backlog; **WWMD/the governed scopes** drain *decision* queues before they reach a human (§5.7). The backlog front door was built. The decision front door was specified but never given a room. This spec builds the room and wires the door.

The room is **kernels-first by construction**: every decision is routed through the governed scopes (WWMD / WWWD / WSID) *first*; the inbox holds only the **residue** the scopes genuinely cannot resolve — and only when that residue is one the kernel can honestly speak to. That last clause is the hard-won lesson of PR #2315, and §3.2 makes it load-bearing rather than aspirational.

And aggregating the residue is necessary but **not sufficient**. Each topic carries its *own* rationale for why it needs attention — an overdue bill, a five-minute-old paused build, a compliance filing due tomorrow — and those rationales are incommensurable: a human cannot rank them by gut, and prioritizing one over another is hard without **triage and context**. So the room must triage, not just list. §4.4 is the triage model: it makes heterogeneous items comparable by decomposing each into the *same* objective factors and ordering by a transparent, explainable rule — and it does this **without fabricating a single cross-axis "priority" score**, which would be the #2315 0.000-theater wearing a precise-looking costume.

### Non-goals

- Do **not** build a second backlog, ticket tracker, or work queue. The backlog stays the work SSoT.
- Do **not** create a new identity-bearing entity or a materialized `AttentionItem` table — the inbox is a **projector** over each queue's own model (§4.1).
- Do **not** re-introduce the degenerate WWMD verdict on cards (§3.2). Honest context or a real score — never 0.000 theater.
- Do **not** fabricate a single magic cross-axis "priority: 0.73" to rank incommensurable items — surface the comparable factors and order by an explainable tiered rule instead (§4.4).
- Do **not** add a new top-level rail destination (the kernel scored this 0.061 vs 0.69; §6.1) or any cross-rail-section secondary nav (EP-NAV-COHERENCE hard rule).
- Do **not** let any external channel one-tap-approve high-risk work (§5).

---

## 1. Live finding — the attention plane is real, scattered, and mostly invisible

A human-decision item can land in at least **ten** places today. Verified against the live codebase (routes, models, pending-status sentinels):

| # | Queue | Canonical route | Model · pending-state | How a human learns of it | Writes `Notification`? |
| - | ----- | --------------- | --------------------- | ------------------------ | ---------------------- |
| 1 | Build-stall escalations | `/ops` band | `PlatformIssueReport` · `status=awaiting_escalation_ack` / `type=build-stall-escalation` | Band on the **wrong plane** (Backlog) — the category error | No |
| 2 | Founder-review (AI decision residue) | `/platform/ai/founder-review` | `DecisionInteraction` · `outcomeType∈{defer,escalate}`, `humanOutcome=null` | Buried page; **"Record outcome" is disabled** (gated on EP-WWMD-MCP) | No |
| 3 | Marketing / outbound approvals | `/customer/marketing` | `OutboundDraft` · `status=pending-review` (`ApprovalQueuePanel`) | In-page band only | No |
| 4 | Bill approvals | `/finance/bills`, `/s/approve/[token]` | `BillApproval` · `pending` / `Bill` · `awaiting_approval` | Status-filter pill + **email token page** | No |
| 5 | Expense approvals | `/finance/expense-claims`, `/s/expense-approve/[token]` | `ExpenseClaim` · `submitted` | Banner + **email token page** | No |
| 6 | Compliance submissions | `/compliance/submissions` | `RegulatorySubmission` · `draft` | Status-filter grid | No |
| 7 | Research proposals | `/admin/research` | `ResearchProposal` · `pending` | Admin-only panel | No |
| 8 | Agent action proposals | `/api/v1/governance/approvals` | `AgentActionProposal` · `proposed` | **API only — no UI built** | No |
| 9 | Capability needs | folded into `/ops` | `CoworkerCapabilityNeed` · `submitted/reviewing` | Auto-filed to backlog (a *work* item, correct) | No |
| 10 | Paused AI work | `/platform/ai/paused-work` | `TaskRun` · `input-required` / `auth-required` | **Surface unbuilt** — only watchdog/Ops-Map monitoring | partial (TaskRun-stall) |

Two structural defects:

1. **No single place to look.** A founder cannot answer "what needs me right now?" without visiting ten routes — three of which (paused-AI, agent-proposals, founder-review-resolution) have no working human surface at all. The `Notification` model, `/api/v1/notifications`, and `/api/v1/governance/approvals` exist — a clear signal an inbox was *intended* — but **only `TaskRun`-stall and tax-remittance paths actually write `Notification`**. The backbone is laid; nothing rides it.
2. **The escalation band is on the wrong plane.** PR #2315 made it legible (honest blocker context, conservative auto-resolve, manual Dismiss). But legible-and-misfiled is still misfiled: it sits in the Backlog's `products` rail section, competing with work it has nothing to do with.

The bones exist (per [`command-center.ts`](../../../apps/web/lib/workspace/command-center.ts) `buildAttentionItems`, which *already* reads `pendingActionProposalCount`, `blockedTaskRunCount`, and improvements as read-only diagnostics). The "room" — an actionable, kernels-routed, channel-delivered inbox — was never built.

---

## 2. Research & precedent

### 2.1 Internal precedent (reuse, don't reinvent)

| Source | Adopt | Caveat |
| ------ | ----- | ------ |
| [Issue-report attendance §5.7/§14](2026-06-20-issue-report-surface-attendance-design.md) | Two front doors (work vs decisions); trust dial = HITL-first, earn autonomy per decision-class via evidence; "attention lens, not a new dashboard". | §5.3/§14 WWMD-pre-consult **mechanism** was degenerate (superseded by #2315). Keep the **doctrine**, fix the **mechanism** (§5.2). |
| [Escalation honest-context (#2315)](2026-06-23-escalation-surface-honest-context-and-auto-resolve-design.md) | Cards show facts (top blocker, self-fix class, originating BI) not a verdict; conservative auto-resolve frees the queue. | "If a future need arises to have WWMD adjudicate, it must first be given structured features that map a blocker to principle dimensions." This spec honors that literally (§5.2). |
| [Paused AI work plan](../plans/2026-05-13-paused-ai-work-approval-surface.md) | `TaskRun` is the paused-work record; decisions audit through `AuthorizationDecisionLog` + `TaskMessage`; **`auth-required` ≠ human judgment** (it's missing credential); OWASP "Lies in the Loop" → raw action shown beside the AI brief. | Unbuilt. This spec subsumes its inbox as one producer of the unified surface. |
| [Realtime HITL + mobile companion](2026-05-13-realtime-hitl-mobile-companion-design.md) | Canonical `HitlNotificationEvent` contract; channel-policy table; portal is canonical, push/email carry **deep links** not decisions; `Notification`/`PushDeviceRegistration`/`notification-adapter.ts`/`agent-event-bus.ts`/`/api/agent/stream` all exist. | Channel strategy (§7) is lifted directly from here; `EP-HITL-MOBILE` already owns it (4/6 done). |
| [Founder-review surface](../../../apps/web/app/(shell)/platform/ai/founder-review/page.tsx) | The closest existing "AI needs a human decision" queue — already reads the `escalate/defer` residue and groups by gap reason. | Buried route; resolution loop disabled. The new inbox **subsumes** it as a lens (§8.5). |
| [Command-center](../../../apps/web/lib/workspace/command-center.ts) | `WorkspaceAttentionItem[]` + `buildAttentionItems` already project several queues; `/workspace` is `primaryOrder:10` and labelled "See what needs attention next". | Read-only diagnostics today; this spec makes them **actionable** and **complete**. |

### 2.2 External HITL product precedent (the shape Mark asked for)

Mature human-in-the-loop products converge on two delivery shapes, and DPF should match both:

- **A question/approval queue** — one inbox, newest-or-highest-stakes first, each item = a small accountable decision with prepared context and bounded actions (approve / reject / request-changes / answer). This is the dominant pattern in agent-ops tooling (OpenAI Agents SDK durable pause/resume; Azure agent-orchestration HITL gates that are explicit about approve-vs-refine-vs-redirect; the "interrupt → human → resume" loop in LangGraph-style runtimes).
- **Email / message to approve-or-ask** — the human is reached *where they are* (email, chat) with a secure link back into the authenticated decision. DPF already ships this for **bills and expenses** (`/s/approve/[token]`), proving the pattern is house-native.

Security constraints carried from OWASP agentic guidance (already cited in the paused-work plan): no unauthenticated one-tap approval of high-risk/irreversible actions; the AI-written brief is never the *only* evidence (raw action shown beside it); every decision is audited; the channel must resist summary-forging ("Lies in the Loop").

**Todoist precedent (focus discipline, not the operating model).** Mark named Todoist as the everyday mental model: a human-managed list that keeps attention focused. Current Todoist docs show the familiar primitives: priorities lift important timed work near the top of Today/Upcoming, filters narrow tasks by date/project/label/priority, and reminders nudge around dated work ([priorities](https://www.todoist.com/help/articles/set-a-priority-in-todoist-Wy82Jp), [filters](https://www.todoist.com/help/articles/introduction-to-filters-V98wIH), [reminders](https://www.todoist.com/help/articles/introduction-to-reminders-9PezfU)). DPF should adopt the focus discipline — clear order, filters, reminders, snooze — but reject the manual-list premise. The coworker already owns live operational context, so it should generate attention from source state and explain why it is interrupting.

---

## 3. The kernels-first routing pipeline (the spine)

The inbox is the **last** stop, not the first. Every decision is routed through the governed scopes before a human sees it. The good news from substrate verification: **this cascade already exists in code.** The work is to make it the universal front door, persist its residue uniformly, and surface that residue in one place.

### 3.1 The cascade that already runs

[`evaluateDecisionPerspective`](../../../apps/web/lib/decision-perspective/evaluator.ts) is the kernels-first cascade:

```
WSID (profession profile) ──▶ WWWD (org autonomyPolicy) ──▶ DPF doctrine ──▶ defer
        orderedProfileChain() walks the fallback chain; first profile with confidence>0 wins
```

It returns `outcomeType ∈ {recommend, arbitrate, escalate, defer}` (types.ts:16). It **escalates** on principle conflict, on high/critical risk, and when confidence falls below the profile's `autonomyPolicy.minimumConfidenceForRecommendation`; it **defers** with `coverageGap=true, gapReason="no-applicable-material"` when no profile has applicable material. At the WWMD layer, [`evaluateBuildStudioDecision`](../../../apps/web/lib/build/decision-service.ts) calls `principle_decide` and returns `needs-human` when `!recommendation || confidence !== "high"` (decision-service.ts:148), or `captured-gap` → "Send to founder review" on tool failure. And [`decide()`](../../../apps/web/lib/decision/option-scoring.ts) already returns `recommendation: null` with reasoning *"the decision needs human judgment instead of advisory math"* when no principles apply.

**The residue is already typed.** `escalate`, `defer`, `needs-human`, `captured-gap`, `recommendation:null`, `principleConflict`, and the paused-`TaskRun` states are all the cascade saying "a human is required." `DecisionInteraction` already persists the `{escalate, defer}` residue (that is exactly what the founder-review page reads). The pipeline does not need inventing — it needs **a single residue contract and a single home.**

### 3.2 The scorability caveat — kernels-first only works on decisions the kernel can score

This is the load-bearing constraint and the reason the predecessor (#2315) had to rip out a WWMD button.

A kernel consult is only meaningful when the decision maps to dimensions the kernel actually carries. The `PRINCIPLE_DIMENSIONS` registry (`packages/db/src/wiki-taxonomy.ts`, 14 keys: `long_term_maintainability`, `blast_radius`, `reusability`, `evidence_density`, `human_cognitive_load`, `capacity_utilization`, `governance_compliance`, `public_safety`, `speed_to_value`, `schema_grounding`, `operational_independence`, `data_privacy`, `cost_efficiency`, `vendor_lock_in`) has **no axis for a resume/defer/escalate operations call**. So when #2315 ran `principle_decide` on "resume vs defer vs escalate" with no structured features, `buildOptionScores` found nothing to grip: every option's composite was `0.000`, margin `0.000`, confidence forced `low`, and the "strongest contributors" were just the two highest-weight commandments in retrieval order — **identical and decision-independent on every card.** That is theater, and it taught the queue's users to ignore it.

**The rule this design enforces** — every routed decision-class is tagged at the routing layer as one of:

| Class | Meaning | Pipeline behavior | Inbox rendering |
| ----- | ------- | ----------------- | --------------- |
| **kernel-scorable** | Maps to ≥1 `PRINCIPLE_DIMENSIONS` axis with real `features` (e.g. plan-readiness, architecture trade-off — what Build Studio review already scores). | Run `principle_decide` / `evaluateDecisionPerspective` with structured features. Residue reaches the human only on low margin / conflict / coverage-gap. | Show the **contribution ledger** — recommended option, top ± contributors, confidence. |
| **unscorable-by-construction** | No dimension carries the axis (resume/defer/escalate ops calls; pure ops judgement; `human_cognitive_load`-only UX-fit calls — see [nav-coherence](../specs/2026-06-21-nav-coherence-operator-console-design.md)). | **Do not run `principle_decide`.** Route straight to the human with honest context. | Show **facts** (top blocker, self-fix class, what was attempted, originating BI + status) — the #2315 pattern. **Never a 0.000 verdict.** |
| **org-business** | A customer-business call the org has a stance on. | Route through the org WWWD corpus (`wiki_query` org-overlay stance/principle); WWMD doctrine only if the org corpus is silent. | Show the WWWD source + confidence. |

**This spec eats its own dog food.** The genuine IA fork in §8 (elevate `/workspace` vs new rail) is *kernel-scorable* — it maps to `long_term_maintainability`, `reusability`, `human_cognitive_load` (cost), `speed_to_value`, `blast_radius`. Run through `principle_decide` with real features, it returned a **clean, high-confidence margin of 0.630** — no theater — because those axes exist. The contrast is the whole point: **the kernel can decide an architecture question (axes exist) and cannot decide a resume/defer escalation (no axis) — and the design must know the difference at the routing layer, not discover it on every card.**

A `decisionClass.scorability` tag (`kernel-scorable | unscorable | org-business`) is the one piece of new typed metadata the pipeline needs; it lives on the residue contract (§6.2), not on a new table.

### 3.3 The trust dial (HITL-first; autonomy earned per decision-class)

From the attendance design §14, kept as a first-class acceptance constraint, not later polish:

- HITL is a **function of confidence**, not an always-on gate. Low confidence / below-tie-margin / commandment conflict / novel context → **propose-and-review** (human approves/overrides; the override is a labeled correction). High confidence, repeatedly-correct-in-context → **autopilot** (executes, human reviews after the fact).
- The dial is **per decision-class and per scope**, and starts low. As evidence accrues it rises and HITL recedes to genuine novelty + high stakes.
- The human shifts from *approver-of-each* to **reviewer-of-evidence**: an overview (counts, classes, outcomes, anomalies) with drill-in, because every decision is on record (what was decided, which scope, the ledger, evidence refs, outcome). "Acknowledged" is never terminal; "reviewed-with-evidence" is.
- **The tuning loop closes through `EP-LEARNING-COMMONS`** (already in-flight): a human override or a went-awry outcome is a labeled correction that refines the WWMD principle / WWWD doctrine / WSID technique (or its `dimensionVector`/weight). Decide → evidence → outcome → tune the scope. This spec **emits** the correction signal; the Commons epic owns the refinement. Do not build a parallel tuner.

For V1 the dial is **conservative everywhere**: every consequential item is propose-and-review. Autonomy graduates per decision-class only as evidence earns it. This is the same posture the escalation auto-resolve took in #2315 (resolve only on provably-settled state).

### 3.4 Proactive custodian mode — quiet until useful

The long-term posture is not "AI creates more tasks for the human." It is **AI Coworker as custodian**: the coworker watches its own work, the human-facing surface, and the relevant source-owned state, then steps forward only when doing so reduces uncertainty or keeps work moving.

This mode is cross-coworker. Build Studio is the first pilot because the 2026-06-29 live incident made the gap concrete: the operator clicked **Retry UX Verification**, work was technically enqueued, but the page still felt inert while hidden blockers accumulated (browser-use import crash, sandbox branch mismatch, missing recovery implementation, then an acceptance-criteria mismatch). A non-technical user should never need to reverse-engineer that from build IDs, branch chips, phase labels, or logs. The coworker should say, in one line, what is happening and what it can safely do next.

**Custodian trigger classes (source-state driven, not vibes):**

1. **Human required:** the existing attention residue path — approvals, escalations, paused work, missing evidence, review decisions.
2. **Work appears inert:** the user took an action or a build entered a state, but no visible progress/evidence/result appears inside a bounded time window.
3. **Safe self-recovery is available:** the coworker can retry, resume, refresh evidence, repair a known transient condition, or collect missing context within its grants.
4. **Priority materially changed:** a deadline, risk, blocker, or blast radius changed enough that the attention order should update.

**Intervention contract:** every proactive intervention has a reason and a bounded action. It renders as: `Why now` (one line), `Recommended next action` (one primary button), and quiet alternatives (`Snooze`, `Show why`, `Let coworker handle it` when safe, or `Open details`). It must also state when no human action is required: "I'm working on it" is a valid status; "Waiting on you" is reserved for a real human decision. Internal identifiers, branch names, queue mechanics, and diagnostics stay behind engineer disclosure by default.

**Anti-nagging rule:** the coworker remains silent while work is progressing normally. Producers debounce repeated signals per `(source, itemKey, triggerClass)`, suppress re-entry while an unread/active notification exists, and respect snooze/not-now decisions. Repeated failure after a self-recovery attempt escalates with the last attempted action and evidence, not another generic prompt.

**Relationship to Todoist:** Todoist helps the human curate and revisit their list; DPF should instead curate from live operating state. The user may pin, snooze, group, or correct order, but the default list is produced by source adapters and the triage rules in §4.4. That distinction is the value of an AI Coworker: the human is not maintaining the system's awareness by hand.

**Relationship to autonomy:** proactive does not mean unilateral. The trust dial in §3.3 still governs execution: low-risk reversible recovery may become "coworker handles it"; consequential or irreversible action remains propose-and-review. The intervention itself is a recommendation envelope, not a prompt-send or hidden authorization.

**WWMD / UX-Fit decision (2026-06-29):** `principle_decide` scored three design-placement options and recommended **A: amend this Attention Surface spec and cross-link Build Studio as the pilot** with high confidence (composite 9.479, margin 2.200, commandmentConflict:false). The decision was also made on merits: this avoids a duplicate queue/spec, keeps source truth in the existing attention plane, and preserves Build Studio as the concrete proof point. The operator UX bar is: one status, one next action, and no jargon in the default view.

---

## 4. The aggregator — a projector over existing queues, riding the Notification backbone

### 4.1 No new table — project, don't materialize

Each queue's truth stays in its owning model (single-source-of-truth). The inbox is a **read-model projector** — `AttentionItem[]` — exactly as `command-center.ts` already projects `WorkspaceAttentionItem[]`. A materialized `AttentionItem` table would create dual-write drift the moment a bill is approved in `/finance` without the mirror row updating. Rejected.

```ts
// lib/attention/types.ts — projector output, NOT a persisted entity
type AttentionItem = {
  id: string;                         // stable per source row, e.g. "decision:DI-…", "escalation:PIR-…"
  source: AttentionSource;            // "escalation" | "ai-decision" | "paused-ai" | "agent-proposal"
                                      //  | "approval-outbound" | "approval-bill" | "approval-expense"
                                      //  | "compliance-submission" | "research-proposal"
  title: string;
  context: string;                    // the honest one-liner (blocker / question / what + why-paused)
  decisionClass: {
    scorability: "kernel-scorable" | "unscorable" | "org-business";
    ledger?: ContributionLedger;      // present iff kernel-scorable
  };
  riskClass: "read" | "bounded-write" | "high-risk" | "unknown";
  triage: {                           // §4.4 — the SAME comparable factors on every item, surfaced AS context.
                                      //  There is deliberately NO single composite "priority" number here.
    timeToAct: "overdue" | "due-today" | "due-soon" | "none";   // primary, objective sort key
    deadlineIso?: string;             // present when a hard deadline exists (bill due, filing deadline, SLA breach)
    residueReason:                    // WHY the kernel couldn't resolve it — typed by the §3.1 cascade outcome
      "coverage-gap" | "principle-conflict" | "high-risk-gate" | "auth-required" | "needs-credential" | "policy-approval";
    blastRadius?: string;             // what/who is blocked until decided — the "if you don't act…" line
    decideEffort: "one-tap" | "review" | "judgment";            // the human_cognitive_load cost axis
  };
  age: { createdAtIso: string };      // SLA age computed in the view (escalation-attention.ts pattern)
  actions: AttentionAction[];         // bounded, source-specific: approve | reject | request-changes
                                      //  | answer | dismiss | snooze | pin | open-in-context
  deepLink: string;                   // to the owning surface for heavy context
  audience: { operator: boolean; assigneePrincipalId?: string };
};
```

Each source is a small pure adapter (`lib/attention/sources/<source>.ts`) returning `AttentionItem[]` from its model's pending-state query — the verified sentinels in §1. The aggregator fans out across adapters in parallel (the `command-center.ts` `Promise.all` pattern) and is **read-only and idempotent**; it never mutates the source rows.

### 4.2 The `Notification` model as the event + delivery spine

The projector answers "what's in the inbox right now." `Notification` answers "tell the human a *new* thing arrived" and carries the cross-channel delivery (§7). The `HitlNotificationEvent` contract from the mobile-companion spec is the canonical event:

- When a source row enters a pending-human state (an escalation is filed, a `TaskRun` pauses, a `DecisionInteraction` records `escalate/defer`, a bill needs approval), the producer emits a `HitlNotificationEvent` and writes one user-targeted `Notification` row (`type`, `title`, `body`, `deepLink` to the inbox item, `read`). This is the under-used backbone from §1 finally carrying traffic.
- When a source row enters a proactive-custodian trigger (§3.4), the producer uses the same event spine and dedup behavior. It does **not** create a new queue; it creates a timely attention signal for a source-owned fact.
- The inbox list reads the **projector** (live truth); the notification feed + badges read **`Notification`** (the "new since you last looked" signal). One is state, the other is event. Per the mobile spec, add a narrow `NotificationDelivery` table **only if** per-channel retry/state is required — not in V1.
- `agent-event-bus.ts` + `/api/agent/stream` (SSE) already exist for live portal refresh; reuse, don't add a transport.

### 4.3 What stays home (deep-link, don't duplicate)

The inbox shows the **decision**, not the domain lifecycle. A bill's full ledger lives in `/finance`; a build's progress lives in `/build`; a marketing draft's editor lives in `/customer/marketing`. The `AttentionItem.deepLink` carries the human to the owning surface for heavy context. The inbox never reimplements `/finance` or `/build`. This is the "attention lens, not a second dashboard" rule from the attendance design, applied to every source.

### 4.4 Triage & prioritization — "why this, why now"

Aggregation is necessary but not sufficient. A founder looking at a bill, a paused build, and a compliance filing cannot rank them by gut: **each topic carries its own rationale for needing attention, and those rationales are incommensurable.** The surface's job is to make them comparable *and* show the context that justifies the order — because, as the founder put it, prioritizing one over another is hard without triage and context.

**The integrity rule (the scorability caveat, applied to ranking).** Do **not** collapse incommensurable axes into a single fabricated `priority: 0.73`. A precise-looking number with no honest basis is exactly the #2315 0.000-theater in a new costume — it *looks* authoritative and means nothing, and it trains the user to distrust the order. Instead: decompose every item into the **same** small set of comparable, mostly-objective factors, order by a **transparent tiered rule**, and surface the factors **as the context**. The order must be explainable in one sentence per item, never "because the model said 0.73."

**The triage factors — the same axes on every item, each derived from real data (never invented):**

| Factor | What it measures | Source examples (verified) | Objective? |
| ------ | ---------------- | -------------------------- | ---------- |
| **Time-to-act** | Hard deadline / SLA: overdue → due-today → due-soon → none | `Bill`/`ExpenseClaim` due date; `RegulatorySubmission` deadline; `ValueStreamHitlGate.escalationTimeoutMinutes`; escalation age vs SLA | **Yes — the primary key** |
| **Risk / stakes** | `riskClass` (read / bounded-write / high-risk) × value-at-stake (amount, irreversibility) | `TaskRun.riskClass`; bill amount; outbound-send reach | Mostly |
| **Blast radius** | What / who is blocked until this is decided | a paused build blocks delivery; an agent-proposal blocks a coworker; an escalation blocks its originating BI | Mostly (maps to the `blast_radius` dimension) |
| **Residue reason** | *Why* the kernel couldn't resolve it — the rationale itself | the §3.1 cascade outcome: coverage-gap / principle-conflict / high-risk-gate / auth-required / needs-credential / policy-approval | **Yes — already typed** |
| **Decide-effort** | How much the human must do: one-tap vs judgment call needing context | the action set + whether an AI brief exists | Mostly (the `human_cognitive_load` cost axis) |

**The ordering rule (tiered / lexicographic, explainable — not a magic composite).** A small, deliberately narrow **override tier** floats above everything: a topic jumps to the top only when a **hard deadline is imminent** (within a configurable window, default 24h — a regulatory filing, a payment due) **or** the action is **irreversible *and* high-risk** — and it is always shown *with its reason* (*"pinned to top: filing due in 6h"*), never silently. Below the override, sort primarily by **time-to-act** tier (overdue → due-today → due-soon → none); within a tier by **risk**; within risk by **blast-radius**; ties broken by **age** (FIFO). This is the paused-work plan's proven shape ("high-risk → bounded-write → read, FIFO within tier") generalized across sources, and it reuses the existing `command-center.ts` `SEVERITY_RANK` / `ATTENTION_RANK` / `selectReadinessAttention` ordering primitives. Every position is then defensible in a line: *"first because it's overdue, high-risk, and blocks delivery."* Where two items genuinely **are** commensurable on scorable axes — e.g. two financial approvals both mapping to `cost_efficiency` / `governance_compliance` — the kernel **may** rank *those two* and show the ledger (kernel-scorable, §3.2). Where they are **not** (a bill vs a build), the tiered rule orders them honestly and the human re-triages. The system never claims a precision it does not have.

**Context on every card — what makes the order legible.** Each item answers "why this, why now" by surfacing its factors, plus two one-liners the founder specifically needs: **"what's blocked / what happens if you don't act"** (the consequence) and **"why it's here"** (the residue reason — the kernel's honest *"I couldn't decide this because…"*). That is the context without which prioritization is guesswork.

**Triage controls — the human keeps the final call.** Pin, **snooze / defer-until** (a date; the item re-surfaces then), **group-by** (source / deadline / risk), and a per-item "not now" that records a *labeled triage decision*. The tiered order is a strong, explainable default; the human re-ranks with full context. And the trust dial (§3.3) applies to **triage** exactly as to decisions: as the AI's ordering proves correct (the human rarely re-orders a class), it earns the right to auto-snooze low-priority items and batch low-risk classes — triage autonomy earned by evidence, never asserted.

**Proactive mode changes surfacing, not truth.** A custodian trigger (§3.4) can bring an item forward, add a "why now" line, or offer a recovery action, but it cannot invent urgency. It still derives from the same factors above and the same source-owned state. If the system cannot explain why it interrupted, it should not interrupt.

**Distinct from the Golden Triangle.** `/platform/ai/priority` (the Golden Triangle, `EP-GOLDEN-TRIANGLE`) prioritizes AI *work effort* — a Cost/Quality/Time posture compiled into model tier, effort, and verification. Attention-triage prioritizes *human decisions* — which residue to address first. Different planes (like backlog vs attention): **compose the vocabulary, do not merge the surfaces.**

---

## 5. Channel strategy — in-app question queue + email/message (Mark's non-negotiable #1)

The portal inbox is **canonical and always required**. Email/message is a **reach** layer that links back to the authenticated decision — never a replacement, never an unauthenticated high-risk approval. Channel selection is rule-driven by risk (lifted from the mobile-companion spec §7):

| Item risk / kind | In-app inbox | Email / message | Push (mobile, later) |
| ---------------- | ------------ | --------------- | -------------------- |
| High-risk / irreversible (resume a build, high-risk MCP, large outbound send) | **Required** | Secure **deep link** to authenticated decision only | Deep-link only |
| `auth-required` (missing credential, not judgment) | **Required** | Deep link | Deep-link only |
| Bounded-write, reversible (request-changes, clarify) | **Required** | Deep link; **answer-by-reply** later | Optional |
| Low-risk, reversible, policy-classified (a routine bill/expense under threshold) | **Required** | **Signed one-click approve/reject** — the pattern bills/expenses already ship (`/s/approve/[token]`) | Optional |
| Resolved / FYI | History row | Optional summary | Optional |

Hard rules (OWASP "Lies in the Loop" + paused-work locked decisions): (1) no external channel approves high-risk work directly; (2) the AI-prepared brief is shown **beside** the raw requested action, never instead of it; (3) every decision — in-app, email, or mobile — calls the **same** decision module and writes the **same** `AuthorizationDecisionLog` + `TaskMessage` audit; (4) push/email payloads carry no raw prompt/business content.

This directly satisfies Mark's shape: a **question queue** (the in-app inbox) **and** **email/message to approve-or-ask** (deep-link for anything consequential; signed one-click only for the low-risk reversible class DPF already trusts to email).

---

## 6. IA placement — elevate `/workspace`, audience-aware, nav-coherent

### 6.1 Decision (kernel-ratified)

The home is **`/workspace`** — its first viewport becomes the **"Needs you"** inbox band, backed by a **`/workspace/inbox`** section page (full queue with filters) that is a sibling in the **same `workspace` shell section**. Not a new rail destination.

Run through `principle_decide` as a *kernel-scorable* interface-surface decision (real features on `long_term_maintainability`, `reusability`, `human_cognitive_load`-cost, `speed_to_value`, `blast_radius`):

- **Recommendation: `elevate-workspace`** — composite **0.691**, margin **0.630**, confidence **high**, no commandment conflict, strong structured coverage (0% semantic fallback).
- Top contributors: *Architecture Over Shortcuts* (+0.25), *Never Assume — Verify* (+0.23). The `new-inbox-rail` option scored **0.061**, pulled down by *Consult the Governed Scopes Before Asking a Human* and *Do the work; don't task the operator*.

Why it holds: `/workspace` is already `primaryOrder:10` (the first thing every operator and worker sees) with the shellNav description literally **"See what needs attention next."** The bones (`command-center.ts` `buildAttentionItems`) already live there. A new rail peer would compete with the designated attention home and re-open the nav fragmentation `EP-NAV-COHERENCE` just closed. Keeping `/workspace/inbox` inside the `workspace` section (siblings: `/workspace`, `/workspace/documents`) means **no cross-rail-section secondary nav** — obeying the hard rule that reverted the P1 operator-console teleport.

### 6.2 Audience-awareness

`PortalAudienceMode` is live (`worker | operator | customer | diagnostic`; AppRail Simple/Full toggle; cookie `dpf-nav-mode`). The inbox is **audience-scoped**:

- **Operator** (founder/admin) sees the full residue: escalations, AI-decision residue, approvals, paused-AI, agent-proposals. This is the primary persona.
- **Worker** sees only items assigned to them or their role (e.g. a finance worker's bill/expense approvals) — `AttentionItem.audience.assigneePrincipalId`. No platform-internal escalations.
- The first-viewport band renders in both worker and operator modes (matching `/workspace`'s existing `audienceModes: ["worker","operator"]`); `/workspace/inbox` full view is operator-first with a worker-scoped subset.

### 6.3 UX Feature-Fit Gate (per `dpf-ux-fit-review`, captured here)

- **Decision:** `fits-with-guardrails`.
- **Owning area:** Workspace.
- **Route family:** `/workspace` (first-viewport band) + `/workspace/inbox` (section page). No new rail destination.
- **Primary persona:** founder/operator — "what needs me right now, and why couldn't the AI finish it?"; secondary: domain worker (own approvals only).
- **Navigation layer touched:** section nav inside Workspace + the existing first-viewport command strip. One layer.
- **Reuse/convergence:** extend `command-center.ts` `buildAttentionItems` into the `AttentionItem` projector; reuse `escalation-attention.ts` (age/blocker-summary), `report-kit` `StatusBadge`/`DataTable`/`StatCard`, the founder-review grouping projector. New primitives must retire the per-queue bespoke panels (`ApprovalQueuePanel`, the founder-review cards) by converging them onto the inbox item, not add a dialect.
- **Source truth:** each source model's pending-state query (§1) — no new owning model; `Notification` owns the "new" signal.
- **Empty/failure behavior:** empty = "Nothing needs you right now" with a link to recent decisions (not a wall of zeros). A source adapter that errors degrades to a "couldn't load <source>" row, never a blank inbox.
- **AI boundary:** inbox items that *start* coworker work (e.g. "let the AI retry") require preview + explicit confirmation; navigation/answer actions do not. No metric tile sends a prompt.
- **Evidence before merge:** route tests for the projector + each adapter; theme-token scan; browser exercise of `/workspace` + `/workspace/inbox` at desktop and mobile widths; fixtures for each source's pending state and for empty/error states.

### 6.4 Migration off the Backlog

The escalation band (`escalation-attention.ts` / `EscalationsAttention` / `getOpenEscalations`, shipped by #2315) **moves from `/ops` to the `/workspace` inbox** as the `escalation` source adapter — unchanged logic, new home. `/ops` returns to **work only** (backlog items, improvements, capability needs as *work*). `/platform/ai/founder-review` becomes a **filtered lens of the same inbox** (the `ai-decision` source), and its disabled "Record outcome" loop is realized via the `EP-WWMD-MCP` `wwmd_record_outcome` handler (§7 composition). `/admin/issue-reports` stays the evidence/audit trail (already reframed by the attendance design). No queue is deleted; each is **re-homed or re-framed** so there is exactly one place a human looks.

---

## 7. Composition map — what this owns vs what it wires

This surface is an **aggregator + router + home**. It deliberately owns very little net-new substrate; it wires existing planes together. Relate-not-duplicate:

| Concern | Owner | This spec's relationship |
| ------- | ----- | ------------------------ |
| Work intake → backlog | `EP-INTAKE-UNIFY` (`ingestBacklogItem`) | **Peer plane.** We are the *decisions* front door; that is the *work* front door. We compose `BI-0ACD9AB2` (receiving loop) — its classified escalations are our `escalation` source. |
| Record the human's decision back to the kernel | `EP-WWMD-MCP` (`wwmd_record_outcome`, BI-WWMD-MCP-08/09, currently deferred) | **Consume + unblock.** Our inbox is the surface that *needs* the disabled "Record outcome"; this spec is the demand signal to land that handler. |
| Channels (push/email/mobile, event contract) | `EP-HITL-MOBILE` (4/6 done) | **Reuse.** `HitlNotificationEvent`, channel policy, `notification-adapter.ts` come from here. We are the portal surface those channels deep-link into. |
| Cross-page HITL handoff, PUC envelope | `EP-COWORKER-INTERACTIVITY` | **Reuse.** A coworker handing a decision to a human routes into our inbox. |
| Trust-dial tuning (override → refine scope) | `EP-LEARNING-COMMONS` (in-flight) | **Emit, don't build.** We emit the labeled-correction signal; the Commons refines WWMD/WWWD/WSID. |
| Proactive custodian mode | `EP-ATTENTION-SURFACE` `BI-5B6F666F` | **Own.** Cross-coworker contract for "quiet until useful" interventions: why now, one action, snooze/show-why, no duplicate task list. |
| Build Studio custodian pilot | `EP-BUILD-STUDIO-UX` `BI-ACB04A21` (extends BI-FD796419) | **Compose.** Build Studio proves the pattern with one status + one next action per build, proactive stuck detection, and in-place guided recovery. It should render build attention through this plane, not a parallel queue. |
| Nav rules | `EP-NAV-COHERENCE` (done) | **Obey.** No new rail; no cross-section secondary nav; audience-aware. |

---

## 8. Risks & mitigations

| Risk | Why it matters | Mitigation |
| ---- | -------------- | ---------- |
| **Re-degeneracy** — a future card runs `principle_decide` on an unscorable axis | The exact #2315 failure; trains users to ignore the queue | `decisionClass.scorability` tag at the routing layer (§3.2); `unscorable` items never call `principle_decide`; a test asserts no inbox card renders a `0.000`-composite ledger |
| **False-precision priority** — a single fabricated cross-axis `priority: 0.73` to rank incommensurable items | The same 0.000-theater failure in a new costume: an authoritative-looking order with no honest basis | No composite priority number (§4.4); decompose into the same objective factors, order by an explainable tiered rule, surface the factors as context; the kernel ranks only items genuinely commensurable on scored axes |
| **Alert fatigue** — the inbox becomes a wall of low-value items | OWASP "Overwhelming HITL"; the failure the paused-work plan warns of | Kernels-first means only residue arrives; conservative auto-resolve (#2315 pattern) clears settled items; the §4.4 tiered triage surfaces the few that matter first; snooze + digest low-risk classes |
| **Dual-queue drift** — projector and a cached/materialized copy disagree | Single-source-of-truth violation | No materialized `AttentionItem` table — pure projector over owning models (§4.1) |
| **Cross-section teleport** — inbox reachable from a foreign rail section | Reverted once already (P1 operator console) | `/workspace/inbox` is a `workspace`-section sibling only; nav-reachability test |
| **Projector latency** — fanning ~10 source queries on every `/workspace` render | `/workspace` is the landing page; slowness is felt by everyone | `Promise.all` fan-out + per-source count caps; promote hot counts to indexed columns only if p95 query budget is exceeded (mobile-spec deferral pattern) |
| **Unauthenticated approval leak** via email/push | High-risk actions approved without portal auth | Channel policy (§5): high-risk = deep-link only; signed one-click strictly limited to the low-risk reversible class bills/expenses already use |
| **Escalation rate masks itself** — making the queue legible hides that too many builds escalate | The band is mostly real, not ghosts (#2315 finding) | Out of scope here (legibility ≠ rate-tuning, per #2315 §4); surface a rate metric for the trust-dial overview but do not auto-suppress |

---

## 9. Backlog (filed under new epic `EP-ATTENTION-SURFACE`; keystone first)

Substrate verification for the epic: `EP-INTAKE-UNIFY` is the *work* front door (its done `BI-196693D6` = "one place to see queued **work**"); `EP-WWMD-MCP`/`EP-HITL-MOBILE`/`EP-COWORKER-INTERACTIVITY` each own a *piece* (record-outcome / channels / handoff) but **none owns the unified attention plane**. A peer epic is justified and composes the four — it does not duplicate them. Filing the attention work under the backlog epic would re-commit the category error this design corrects.

| # | BI | Title | Size | Why |
| - | -- | ----- | ---- | --- |
| **Keystone** | BI-AS-1 | `AttentionItem` projector + `/workspace` "Needs you" band + `/workspace/inbox` page — escalation + ai-decision + paused-ai + agent-proposal sources, audience-scoped, **triaged (tiered order, no composite score)** + deep-link out | L | The room. Re-homes the #2315 escalation band off `/ops`; reuses `command-center`/`escalation-attention`/report-kit. |
| 2 | BI-AS-2 | `decisionClass.scorability` routing tag + the "never render a 0.000 ledger" guard test; render kernel-scorable items with the contribution ledger, unscorable with honest facts | M | Makes kernels-first real without re-degeneracy (§3.2). |
| 3 | BI-AS-3 | Wire the `Notification`/`HitlNotificationEvent` spine — producers emit on pending-human entry; inbox badge + feed read `Notification`; SSE live refresh | M | Lights up the under-used backbone (§4.2); composes `EP-HITL-MOBILE`. |
| 4 | BI-AS-4 | Finance + business approval source adapters (outbound, bill, expense, compliance-submission, research-proposal) into the projector, worker-audience-scoped | M | Completes aggregation; converges `ApprovalQueuePanel` et al onto the inbox. |
| 5 | BI-AS-5 | Email/message channel: secure deep-link for consequential items + signed one-click for the low-risk reversible class; same decision module + audit | M | Mark's non-negotiable #2 (§5); composes bills/expenses token pattern + `EP-HITL-MOBILE`. |
| 6 | BI-AS-6 | Realize the founder-review **resolution** loop: `wwmd_record_outcome` write-back from the inbox; founder-review becomes the `ai-decision` lens | M | Unblocks the disabled "Record outcome"; composes `EP-WWMD-MCP`; emits the `EP-LEARNING-COMMONS` correction signal. |
| 7 | BI-AS-7 | Trust-dial overview: per-decision-class counts/outcomes/anomalies with drill-in; emit labeled-correction signal on override | M | §3.3 reviewer-of-evidence posture; feeds the Commons tuning loop. |
| 8 | BI-AS-8 | **Triage & prioritization model** — per-item factors (time-to-act, risk, blast-radius, residue-reason, decide-effort), tiered ordering, "why this / why now" + "what's blocked" context lines, and snooze/pin/group-by controls. **No composite priority score**; the kernel ranks only genuinely-commensurable items | M | §4.4 — makes heterogeneous topics comparable *with the context that justifies the order* (Mark: prioritizing one over another is hard without triage + context). |
| 9 | BI-5B6F666F | **Proactive AI Coworker custodian mode** — source-state triggers for human-required, inert/stalled, safe-self-recovery, and material-priority-change moments; render one "why now" line, one recommended action, snooze/show-why, and quiet thresholds. Build Studio pilot: BI-ACB04A21 | L | §3.4 — turns the Attention Surface from a passive inbox into the coworker's proactive team-custodian primitive without creating a second backlog or magic priority score. |
| 10 | BI-282C39D5 | **`provider-credential` source** — an enabled AI provider whose saved OAuth sign-in has EXPIRED is projected as a one-tap "Reconnect &lt;provider&gt;" item (deep-links to Providers & Routing). A `human-required` custodian trigger (§3.4): fires the moment the token lapses, so the operator is told BEFORE a coworker turn fails, not after. Scoped to *previously-connected, now-expired* credentials only — a never-configured provider is opt-in, not an alert (stays soft "attention" in AI-readiness). | S | Closes the gap where an expired credential (while a local model still exists) kept AI-readiness at "attention" and `projectAiReadinessAttentionItems` (blocked-only) raised nothing. Pairs with the honest failure message + one-click reconnect CTA (#2965). |
| 10a | BI-DB6A75D4 | **`provider-credential` scope correction — routing-disabled providers.** The row-10 scoping ("enabled … now-expired") is necessary but not sufficient, and left row 10 unable to fire for the incident it was written for: `routing/fallback.ts` sets a non-local provider to `status=disabled` once its credentials genuinely fail, which removes it from the active/degraded set the detector scans. Extend the source so a provider that is **`disabled` and holds a stored credential** (i.e. previously connected) is also a one-tap "Reconnect &lt;provider&gt;" item. `inactive` stays excluded — that is an operator choice to turn a provider off, not a failure. The row-10 exclusion of never-configured providers is unchanged. | S | Observed live: `anthropic-sub` sat `disabled` for four days with **zero** operator signal — exactly the "operator only found out when a coworker turn died" failure row 10 promises to prevent. Row 10's own detector and the disable path were mutually exclusive. |
| 11 | BI-7CB2CCDE | **`coworker-envelope` source** — a `CoworkerActionEnvelope` in status `proposed` is projected for its `delegatingUserId` and ONLY for that user, with the coworker, the requested manifest action, the rationale, the bound `TaskRun`, the immutable review binding (subject, gate, repository, commit, path, blob) and the expiry rendered on the card. Approve/Decline post to `/api/agent/envelope/:id/{approve,deny}`, the authenticated state-machine routes. Resolved and expired envelopes are excluded in the query and re-checked in the projector, so no settled envelope can present a live control. | S | An eleventh queue that did not exist when the §1 inventory was written: the universal authority envelope (`lib/coworker/authority-approval-envelope.ts`) parks a governed coworker on `input-required` awaiting employee approval, but no human surface read the table. Live state held 16 `proposed` envelopes while `/workspace/inbox` showed none, so the only visible "Approve action" belonged to an unrelated `AgentActionProposal`. The two record classes stay separate end to end — separate source, separate card, separate endpoints. |

Keystone BI-AS-1 ships the split, the home, and a basic tiered order; 2–3 make it kernels-first and live; 4–5 complete aggregation + channels; 6–7 close the resolution + tuning loops; 8 makes the queue genuinely triable (the founder's prioritization need) on top of the keystone's tiered baseline. Each is design-first input for Mark's review — **no feature code in this task.**

---

## 10. Open decisions (for Mark)

1. **`/workspace/inbox` vs inbox-as-`/workspace`-home.** This spec recommends a first-viewport band on `/workspace` **plus** a dedicated `/workspace/inbox` full page (both in the workspace section). Alternative: make `/workspace` *itself* the inbox and demote the command-center matrix. Recommendation: keep the band-plus-page split so the readiness matrix survives; revisit if telemetry shows the matrix is ignored.
2. **Worker-audience rollout.** V1 can ship operator-only and add the worker-scoped subset (own approvals) in a fast-follow. Recommendation: operator-first, worker subset in BI-AS-4 alongside the finance adapters (since those are the worker-relevant ones).
3. **Signed one-click email scope.** Limit to bill/expense-style low-risk reversible items in V1 (proven pattern), or extend to other reversible approvals? Recommendation: V1 = bills/expenses only; widen per-class only after a security review of each class.
4. **Escalation-rate metric placement.** Surface "why N builds escalate" on the trust-dial overview (BI-AS-7) or leave to a separate ops-health surface? Recommendation: a read-only tile on the overview; rate-*tuning* stays out of scope per #2315.
5. **Triage depth in the keystone vs BI-AS-8 — RESOLVED (2026-06-23, founder go-ahead).** Keystone BI-AS-1 ships the tiered baseline (override tier → time-to-act → risk → blast → age) + the residue-reason line so the inbox is usable on day one; BI-AS-8 layers the full factor decomposition, the "why this / why now" + "what's blocked" context lines, and snooze/pin/group-by controls on top. Reflected in §4.4 and §9.
6. **Auto-pin override — RESOLVED (2026-06-23, founder go-ahead).** A topic floats above the tiered order only when a hard deadline is imminent (configurable window, default 24h) **or** the action is irreversible-and-high-risk, always shown with its reason ("pinned to top: filing due in 6h"); everything else stays in the tiered order. Folded into the §4.4 ordering rule as the override tier.
```
