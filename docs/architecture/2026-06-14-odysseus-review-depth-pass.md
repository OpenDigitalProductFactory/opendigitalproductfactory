# Odysseus Review — Depth Pass v2: Substrate Grounding + Email Processing

Date: 2026-06-14

Status: review memo (companion / depth pass)

Companion to: [`2026-06-14-odysseus-ux-routing-model-review.md`](2026-06-14-odysseus-ux-routing-model-review.md)

Audience: DPF product, architecture, UX, and AI platform reviewers

---

## 0. Why this companion exists

The original review memo is correct on **product direction** — the AI cockpit, use-case model
routing, visible receipts, and route discipline are the right bets. But it is written as if DPF's
AI layer were greenfield ("Add…", "Create…", "Introduce…"). A codebase sweep before writing a spec
(per `verify-substrate-before-proposing-new` and `sweep-main-before-trusting-worktree-specs`) shows
that **most of what the memo proposes already exists in named substrate**, two of the proposals are
already fully *designed* in existing specs, and **email processing is not greenfield either** — a
working inbound-email triage loop already ships, and a multi-channel communication fabric is specced
with `email` as a first-class channel.

So "going a level deeper" is not a finer-grained restatement. It is:

1. **Correcting the premise** so we don't double-build.
2. Converting each abstract recommendation into a **concrete delta against named files, tables, and
   existing specs**.
3. Isolating the **genuinely net-new work** (a small set of schema additions + UX surfacing).
4. Adding the **email-processing-for-businesses** section the original omitted, and showing why email
   is the ideal *proving ground* for the use-case routing matrix.

This pass is grounded in source inspection of `apps/web/lib/routing/*`, `apps/web/lib/inference/*`,
`apps/web/lib/marketing/channels/email-postmark/*`, `apps/web/lib/communications/*`,
`packages/db/prisma/schema.prisma`, and the routing/fabric specs cited inline. It is source
inspection, not a runtime test.

---

## 1. Premise correction: routing is already a mature subsystem

The original memo's Evidence section inspects Odysseus thoroughly but does not inventory DPF's own
routing code. The implicit assumption — echoed in older context that routing lives in "AI Routing
System draft files at the repo root" — is **stale**. The real state:

- **~110 files** under [`apps/web/lib/routing/`](../../apps/web/lib/routing/) plus
  [`apps/web/lib/inference/`](../../apps/web/lib/inference/), shipped as completed epics (EP-INF-003
  → EP-INF-012, EP-AGENT-CAP-002, EP-MODEL-CAP-001).
- A single inference entry point — `routeAndCall()` in
  [`routed-inference.ts:184`](../../apps/web/lib/inference/routed-inference.ts) — that every LLM call
  already flows through (it replaced the older `callWithFailover()`).
- A real routing engine — `routeEndpointV2()` in
  [`pipeline-v2.ts:241`](../../apps/web/lib/routing/pipeline-v2.ts) — with a 6-stage pipeline (pin
  override → policy filter → hard capability filter → cost-per-success ranking → capacity penalty →
  diverse fallback chain).
- A **canonical current-state spec** already exists:
  [`docs/superpowers/specs/2026-04-20-routing-architecture-current.md`](../superpowers/specs/2026-04-20-routing-architecture-current.md).

**Implication for the spec the memo asks us to write:** reframe every recommendation from *build* to
*consolidate / surface / extend*. The risk is not "no model routing" — it is **duplicate substrate**
and a second source of truth. The one thing that is genuinely unbuilt (a long-running routing policy
*service*) is already designed; see §4.5.

---

## 2. Substrate ledger — memo claim vs. reality vs. delta

This table is the heart of the depth pass. Each row: what the memo proposes, what already exists
(with the name to reuse), and the **real** delta.

| Memo proposal | Status | Already exists (reuse this) | Real delta |
| --- | --- | --- | --- |
| AI use-case policy **matrix** | **Largely EXISTS** | `RequestContract` ([`request-contract.ts:18`](../../apps/web/lib/routing/request-contract.ts)) carries `taskType`, `sensitivity`, `residencyPolicy`, `budgetClass`, `reasoningDepth`, `requiredModelClass`, `minimumDimensions`. Per-task tier floors come from `TaskRequirement` (DB) + `BUILT_IN_TASK_REQUIREMENTS` + `quality-tiers.ts`. | No *unified, editable* matrix view; policy is split across `TaskRequirement` + `PolicyRule` + `AgentModelConfig` + hardcoded defaults. Delta = **consolidation + an admin surface + the missing task-type rows** (notably the email tasks, §6). |
| Per-thread **model receipt** | **Data EXISTS / surfacing PARTIAL** | Three receipt tables: `RouteDecisionLog` (`schema.prisma:6930` — chosen model + candidate trace + `fallbackChain[]`), `RouteOutcome` (`:2444` — what happened + `providerErrorCode` + `fallbackOccurred`), `AdapterRunTelemetry` (`:2528` — per-execution model/tokens/cost/`errorClass`/`userAccepted`). Already surfaced minimally as `providerId:modelId` in `AgentPanelHeader.tsx:129`. | **Do not add tables.** Delta = a **per-turn receipt view object** joining the three tables, plus a user-facing receipt component in the coworker panel and a Platform>AI evidence tab. |
| Fallback / escalation **reason codes** | **Fallback EXISTS / escalation ABSENT** | Low-cardinality unions already exist and persist: `InferenceError.code` (`ai-inference.ts`), `EndpointUnavailableReason` (`rate-tracker.ts`), `ProviderHealthStatus`/`RemediationKind` (`provider-health.ts`) → `RouteOutcome.providerErrorCode` / `AdapterRunTelemetry.errorClass`. | Codes are **scattered** (no shared registry); there is **no explicit *escalation* reason code** (only *fallback/degrade*). Delta = one shared `reason-codes.ts` registry + an `escalationReason` concept. |
| **Central routing policy service** | **ABSENT but DESIGNED** | Routing is recomputed inline per request (no long-running service / compiled table). | Already specced as a control-plane/data-plane (RIB→FIB) split in [`2026-04-27-routing-control-data-plane-design.md`](../superpowers/specs/2026-04-27-routing-control-data-plane-design.md). Delta = **implement that spec; cite it, don't reinvent it.** This is where the memo's "20% refactor" budget should go. |
| Provider/model **capability metadata** | **EXISTS (mature)** | `ModelProfile` (`schema.prisma:1572`), `ModelCard` types, `AdapterCapabilityProfile` (`:2492`), `ModelCapabilityChangeLog` (`:1644`), drift detection via `rawMetadataHash`. Populated seed → discovery → eval → admin override. | Essentially nothing structural. Overlaps with the matrix-consolidation delta only. |
| `Platform > AI` route **home** | **EXISTS (21 routes)** | Family "AI Operations" at [`apps/web/app/(shell)/platform/ai/`](../../apps/web/app/(shell)/platform/ai/), data-driven nav in `platform-nav.ts:21`, sub-tabs in `AiTabNav.tsx`. Includes providers, routing, model-assignment, decisions, operations-map, prompts, skills. | Memo's surfaces should be **new tabs/panels in this family**, not a new route family. Delta = a **Threads/Receipts tab**, a **Routing-policy (matrix) tab**, a **Model-Fit tab**, a **Spend/Evidence tab**. |
| Architecture guardrails (no hardcoded colors, report-kit, server/client) | **ALREADY ENFORCED** | `--dpf-*` tokens in `globals.css`; rule in `AGENTS.md:173-186`; report-kit primitives `StatusBadge`/`StatCard`/`DataTable`/`FilterBar`/`ExportButton`/`Chart` in [`apps/web/components/ui/report-kit/`](../../apps/web/components/ui/report-kit/). | None — these are existing standards, not new recommendations. The memo can **assert** them as constraints rather than propose them. |
| Local **model fit** experience | **PARTIAL** | Endpoint capability probes already exist: [`apps/web/lib/routing/capability-probes/`](../../apps/web/lib/routing/capability-probes/) write `AdapterCapabilityProfile`; Ollama support present. | DPF should do **endpoint-capability fit** (its probes), *not* Odysseus's host-GPU hardware scan — see §4.6 "what not to copy". Delta = a read-only Model-Fit view over existing probe data. |

**Bottom line:** four of five core proposals are EXISTS-to-PARTIAL. The net-new work is small and
specific: (a) **thread schema additions** (§5), (b) **the email pipeline generalization** (§6),
(c) **implementing the already-designed routing control plane** (§4.5), and (d) **UX surfacing** of
data that already exists.

---

## 3. Two factual corrections to carry into the spec

From source inspection of Odysseus (`pewdiepie-archdaemon/odysseus`, `dev` branch):

1. **License:** Odysseus is **AGPL-3.0**, not MIT (some press says MIT). AGPL matters if we ever
   borrow code rather than concepts — it is copyleft over a network boundary. We are borrowing
   *concepts only*, so this is a flag, not a blocker.
2. **`action_intents.py` does not pick models** and "cockpit" is the memo's term, not Odysseus's.
   Intents in Odysseus are regex classifiers that decide chat→agent-mode promotion; model selection
   lives in `endpoint_resolver.py`. Minor, but the spec should not attribute model routing to the
   intent layer.

---

## 4. Recommendation deep-dives

### 4.1 Use-case policy matrix → consolidate `RequestContract` + `TaskRequirement`, add rows

The matrix the memo draws (the "Local vs Frontier Model Policy" table) maps almost 1:1 onto fields
that already exist:

| Memo matrix column | Existing field |
| --- | --- |
| Use case | `RequestContract.taskType` / `contractFamily` |
| Default policy / tier | `TaskRequirement.minimumTier` → `TIER_MINIMUM_DIMENSIONS` (`quality-tiers.ts`) |
| Local vs frontier role | `RequestContract.residencyPolicy` (`local_only` / `approved_cloud` / `any_enabled`) + `budgetClass` |
| Privacy posture | `RequestContract.sensitivity` (`public`/`internal`/`confidential`/`restricted`) |
| Fallback behavior | `fallback.ts` chain + `RouteDecisionLog.fallbackChain[]` |

**Concrete next action (not "build a matrix"):**

1. Add the **missing task-type rows** to `BUILT_IN_TASK_REQUIREMENTS` — especially the email tasks
   in §6 — each with an explicit `minimumTier`, `residencyPolicy`, and `budgetClass`.
2. Add an **`escalationPolicy`** notion to `TaskRequirement` (today only `minimumTier` exists; there
   is no "may auto-escalate to frontier? / requires approval?" field — see §4.3).
3. Build the **admin matrix view** as a Platform>AI tab over `TaskRequirement` + `PolicyRule`, using
   report-kit `DataTable` + `StatusBadge`. This is the memo's real UX contribution.

> The matrix is **consolidation and surfacing**, not new substrate. Per `verify-substrate-before-proposing-new`,
> the spec must reference `RequestContract`, `TaskRequirement`, and `quality-tiers.ts` by name.

### 4.2 Model receipts → a join view, not new tables

The data is already captured three ways and keyed by `agentMessageId`/`threadId`. The deeper design
question is **composition**, not capture:

- Define a read-side `ThreadTurnReceipt` view = `RouteDecisionLog` (intent + candidates) ⨝
  `RouteOutcome` (result) ⨝ `AdapterRunTelemetry` (execution) on `agentMessageId`.
- Render it in two places: a compact inline chip in `AgentMessageBubble` (requested policy → actual
  model, with a "fell back" badge driven by `RouteOutcome.fallbackOccurred`), and a full row in a
  Platform>AI **Receipts** tab (report-kit `DataTable`, `ExportButton` for CSV).
- `AdapterRunTelemetry.userAccepted` already exists — wire the inline receipt's thumbs-up/down to it
  so receipts double as the production-feedback signal that `production-feedback.ts` consumes.

### 4.3 Reason codes → one registry + an escalation axis

Today's codes describe **why a call failed or degraded** (`rate_limit`, `auth`, `overloaded`,
`model_not_found`, …). The memo also wants **why a call was escalated upward** ("user requested
better answer", "policy requires higher assurance", "privacy blocks frontier"). That second axis
does not exist.

Delta:
- Create `apps/web/lib/routing/reason-codes.ts` as the single source for both axes
  (`FallbackReason` ∪ `EscalationReason`), and have `RouteOutcome`/`AdapterRunTelemetry`/
  `RouteDecisionLog` import from it instead of re-declaring unions.
- Add `escalationReason` to the route decision record so "why did this go to frontier?" is auditable —
  required by the memo's governance section and by the privacy posture in §6.

### 4.4 `Platform > AI` → tabs, not a new family

The family exists with a data-driven nav. The memo's surfaces slot in as new entries in
`platform-nav.ts` / `AiTabNav.tsx`:

- **Routing Policy** (the matrix, §4.1) — beside the existing `routing/` profiles page.
- **Receipts / Evidence** (§4.2) — joins the three receipt tables; co-locate fallback/escalation logs.
- **Model Fit** (§4.6) — read-only over `AdapterCapabilityProfile`.
- **Spend** — over `TokenUsage` + `RouteOutcome.costUsd`; this is also the convergence point with
  finance/ops reporting (answers Open Question 5).

All built from report-kit + `--dpf-*` tokens. No new global "Tools"/"Models" destination — the memo
is right about that, and `platform-nav.ts` already enforces it.

### 4.5 The 20% refactor → implement the control/data-plane spec

The memo reserves ~20% for refactoring the AI/provider boundary "before adding new UI". That budget
has a **named target already designed**:
[`2026-04-27-routing-control-data-plane-design.md`](../superpowers/specs/2026-04-27-routing-control-data-plane-design.md)
specifies a RIB (catalog + probes + policy union) compiled to a FIB lookup table with atomic publish
and a watchdog — explicitly to kill the seed↔runtime drift class that has bitten DPF before
(`seed-is-bootstrap-calibration-is-runtime`). Recommendation: the spec the memo asks for should
**adopt that design as its refactor work item**, not describe a generic "policy layer" in the
abstract. The memo's `AiRoutingDecision` TypeScript sketch is essentially a lighter `RouteDecision`
that already exists in `pipeline-v2.ts`; we should not introduce a parallel type.

### 4.6 Local model fit → endpoint capability, NOT host-hardware scan (what not to copy)

Odysseus's `services/hwfit/*` scans local **GPU VRAM/RAM** because it is a single-user desktop app
deciding which GGUF a machine can run. DPF is a **server / multi-node** platform where "what can run
locally" means "what do our configured local/remote endpoints actually support", which DPF already
measures with `capability-probes/` → `AdapterCapabilityProfile`. So the Model-Fit screen should be a
**readiness view over probe results and endpoint health**, mapping configured endpoints → supported
use cases → unsupported workloads. Borrow Odysseus's *framing* ("which tasks can run locally, which
need fallback"); do **not** copy its hardware-scan implementation. (Host-hardware scan is only
relevant for the edge-node story under `platform/edge-nodes/`, if at all.)

---

## 5. The genuinely net-new work: thread metadata

`AgentThread` ([`ai-coworker.prisma`](../../packages/db/prisma/schema/ai-coworker.prisma)) is intentionally thin
(`@@unique([userId, contextKey])` — one thread per user per route context, plus CLI-session and
spawn fields). The memo's proposed thread metadata mostly exists *elsewhere*, keyed by
`threadId`/`agentMessageId`. Mapping the memo's fields to reality:

| Memo field | Status | Where it lives today / what to do |
| --- | --- | --- |
| `threadId` | EXISTS | `AgentThread.id` |
| `ownerPrincipalId` | PARTIAL | `AgentThread.userId` is a `User`, not a `Principal`; dual-principal exists at the *action* layer (`ToolExecution.delegatingUserId`). Add a principal link if we want principal-scoped threads. |
| `workspaceArea` | PARTIAL | `AgentThread.contextKey` + `AgentMessage.routeContext` already encode this. |
| `mode` (advise/act) | PARTIAL | **Ephemeral UI state only** (`AgentPanelHeader.tsx:177`). Persist it on the thread if it must survive reloads/audit. |
| `requestedModelPolicy` | PARTIAL | Per-*agent* in `AgentModelConfig`, not per-thread. Snapshot on the turn if per-thread override is wanted. |
| `actualModelReceipt` | PARTIAL (strong substrate) | `AdapterRunTelemetry` per turn; surface as §4.2 view. No new table. |
| `fallbackEvents` | PARTIAL | Implicit in `AdapterRunTelemetry.status`/`errorClass`; no explicit per-thread timeline. Derive in the receipt view. |
| `memoryMode` | **ABSENT** | No field anywhere. **Net-new.** See Open Question 3. |
| `toolAuthority` | PARTIAL | Per-*agent* (`AgentToolGrant`, `AgentGovernanceProfile.autonomyLevel`) + per-action `CoworkerActionEnvelope`. Snapshot on thread if needed. |
| `attachedSources` | PARTIAL | Per-message `AgentAttachment` + ephemeral composer `contextRefs`. **No durable thread-level source set.** Net-new if we want persistent grounding. |
| `compactionState` | **ABSENT** | No compaction model exists at all. **Net-new.** |
| `decisionLinks` | **ABSENT** | `DecisionInteraction` (`schema.prisma:9677`) keys on `profileId`/`buildId`/`taskRunId` — **no `threadId`**. **Net-new join** from thread → decision. |

**So the real schema work is four items, not twelve:** `memoryMode`, durable `attachedSources`,
`compactionState`, and a thread↔`DecisionInteraction` link. Everything else is "snapshot an existing
value onto the thread" or "render an existing table". The spec should say exactly that, so we don't
greenlight a twelve-column migration when four columns + one join is the truth.

---

## 6. Email processing for businesses (new section)

This is the addition you flagged. Email processing is one of Odysseus's most complete features — and
it is **not greenfield in DPF either**. The right move is to **generalize what already ships**, pin it
to the **local/utility tier** (the connective tissue to §4.1), and attach it to the **Employee
Communication Fabric**.

### 6.1 What Odysseus actually built (and the one lesson that matters most)

Odysseus's email feature (`routes/email_routes.py`, `routes/email_pollers.py`,
`routes/email_helpers.py`, `src/email_thread_parser.py`):

- **Ingest:** raw **IMAP/SMTP via `imaplib`**, username/password, connection-pooled; auto-detects
  Sent/Drafts/Spam folders. Polls `SINCE`-filtered, **capped at 5 emails/pass**.
- **LLM triage pipeline**, each stage flag-gated and **result-cached per message**: summarize (1–3
  bullets) · classify/auto-tag (12 tags) · spam (→ move to Junk) · **draft reply (stored, never
  auto-sent)** · calendar-event extraction (+ regex fallback) · urgency triage.
- **Thread parsing** is pure rule-based (regex + BeautifulSoup), no LLM.
- **The load-bearing lesson:** every email AI stage resolves its model via
  `resolve_endpoint("utility")` — the **cheap/local "utility" role**, deliberately kept off the
  frontier tier, and **not** part of the agent-mode teacher-frontier escalation path. Email is the
  textbook background-utility, privacy-sensitive, high-volume workload, and Odysseus routes it
  accordingly. The reply prompt also carries a hard *"NEVER invent facts…"* guardrail.

### 6.2 What DPF already has

| Capability | DPF substrate (reuse) |
| --- | --- |
| Inbound transport (working) | Postmark inbound webhook → [`apps/web/app/api/integrations/email-postmark/inbound/route.ts`](../../apps/web/app/api/integrations/email-postmark/inbound/route.ts) (HMAC-verified, at-least-once). |
| Inbound message anchor | `InboundChannelMessage` (`schema.prisma:7286`) — holds `fromAddress`, `subject`, `body`, `classification`, `routedEngagementId`, `draftedReplyId`. **`domain` is hardcoded `"marketing"`.** |
| Triage brain (working) | `runInboundResponder` ([`responder.ts:44`](../../apps/web/lib/marketing/channels/email-postmark/responder.ts)): rule pre-filter → LLM classify (`qualified-inquiry`/`support`/`spam`/`other`) → CRM link → draft reply → human-approval queue. **`classifyWithLlm` already calls `routeAndCall(...)`** (`responder.ts:138`). |
| Draft → approve → send | `OutboundDraft` → `OutboundApprovalDecision` → `OutboundPublication` (`schema.prisma:7211/7237/7257`); `sourceType="inbound-channel-message"` already supported. Send via `lib/shared/email.ts` (SMTP) or Postmark API. |
| Multi-channel home (specced) | **Employee Communication Fabric** — [`2026-05-15-employee-communication-fabric-design.md`](../superpowers/specs/2026-05-15-employee-communication-fabric-design.md). `email` is a first-class channel (`channel-types.ts`); §14.4 defines `tasks/submit` as the inbound→coworker contract. WhatsApp Secretary spec is the worked routing example. |
| Identity / continuity | `CommunicationChannelBinding` (sender → `Principal`) + `CommunicationChannelSession` (`schema.prisma:4339/4370`). |
| Action-item extraction | `WorkItem`/`WorkQueue` (`schema.prisma:9283`) with generic `sourceType`/`sourceId`; backlog ingest at `lib/operate/backlog-ingest.ts`. |
| Evidence | `CommunicationDeliveryAttempt` (`schema.prisma:4393`) for sends; the `InboundChannelMessage` row for inbound. |

### 6.3 The two genuine gaps

Everything downstream of "a parsed inbound message row exists" is built or specced. Only two pieces
are truly missing:

1. **A continuous mailbox poller / inbound transport for general business email.** Today's only
   inbound path is the Postmark webhook (marketing-scoped), and the MS365 Graph reader
   (`microsoft365-communications/communications-client.ts:94`) is a **top-5 health *probe*, not a
   sync loop**. Business email from a customer's own Gmail/M365 mailbox needs delta-sync or provider
   push.
2. **Inbound attachment ingestion.** The Postmark inbound parser ignores `Attachments[]`; there is no
   path from an email attachment into `AgentAttachment`/`Document`.

### 6.4 Recommended architecture

Compose the **Communication Fabric** (channel + routing) with the **marketing execution loop**
(reference triage implementation), and route email AI through the **existing router pinned to the
utility/local tier**:

1. **Transport — OAuth/push, not IMAP-password.** Add the inbound email channel under the fabric's
   reserved convention `apps/web/app/api/communications/<provider>/webhook/route.ts` (fabric §13.5).
   Connect customer mailboxes via **Gmail API / MS Graph delta-sync with OAuth**, or provider inbound
   webhooks (Postmark). Credentials via `IntegrationCredential` custody. This honours
   `dpf-as-integration-conduit` — the customer brings their own mailbox + OAuth consent; DPF never
   enrolls as a mail partner or stores raw passwords.
2. **Anchor — generalize `InboundChannelMessage`.** Relax the `domain="marketing"` assumption (add
   `domain="inbox"`/`"support"` or make it org-scoped business mail). Reuse the classification /
   routing / draft columns verbatim.
3. **Triage — lift `runInboundResponder` out of `lib/marketing/`** into a domain-agnostic responder.
   Mirror Odysseus's flag-gated, result-cached stages: summarize · classify · spam · draft ·
   extract-actions · urgency — each cached on the message row so re-runs skip processed mail.
4. **Routing posture — the bridge to §4.1.** Register email tasks as **new `taskType`s** in
   `BUILT_IN_TASK_REQUIREMENTS` with `residencyPolicy: "local_only"` (or `"approved_cloud"` per org
   policy), `budgetClass: "minimize_cost"`, and low/medium `reasoningDepth`. This is the DPF
   equivalent of Odysseus's `resolve_endpoint("utility")`. **Today's marketing classifier does NOT
   set residency/budget** (`responder.ts:139` passes only `"internal"`), so it can currently land on
   a frontier model — fixing that is a concrete, shippable first win.
5. **Coworker routing — fabric §14.4 `tasks/submit`.** A triaged email that needs real work is handed
   to the right coworker thread via the existing inbound→coworker contract, not a new mechanism.
6. **Action extraction → `WorkItem`** (`sourceType="inbound-email"`, `sourceId=inboundId`) and/or
   backlog ingest; calendar invites → the calendar surface (Odysseus's primary extracted action).
7. **Drafts — never auto-send.** Reuse `OutboundDraft` → `OutboundApprovalDecision` →
   `OutboundPublication` + `CoworkerActionEnvelope` propose/approve. This matches both Odysseus
   (drafts await approval) and DPF governance (effectful actions need preview/confirmation).
8. **Attachments — new parsing work** into `AgentAttachment` (thread scratch) or `Document` (durable).
9. **Privacy — email is the proving ground.** Inbound business mail is the canonical
   `confidential`/`local_only` workload. Email tasks set `fallbackPolicy` to same-class or
   approval-required, **never** silent `frontier-with-receipt`, satisfying the memo's "no silent
   frontier escalation for sensitive work".

### 6.5 What NOT to copy from Odysseus for email

- **IMAP + username/password (no OAuth).** It can't even do M365/Gmail (Odysseus's own README admits
  this) and it violates `dpf-as-integration-conduit`. Use OAuth/Graph/Gmail API or provider webhooks.
- **Single-user personal mailbox model.** DPF is multi-principal and org-scoped; intake must carry
  tenant + principal + tool-grant gating, not just an owner column.
- **Storing mail creds in app settings.** Use `IntegrationCredential`.
- **Frontier-by-accident.** Odysseus got this *right* (utility role); DPF must replicate it
  explicitly via residency/budget (§6.4 step 4), because our current email classifier doesn't.

### 6.6 Email slices

- **Slice E1 — Pin email to local/utility now.** Register email `taskType`s + set
  `residencyPolicy`/`budgetClass` on the existing marketing classifier call. Tiny change, immediate
  privacy/cost win, exercises the §4.1 matrix end-to-end. *No new transport.*
- **Slice E2 — Generalize the loop.** Lift `runInboundResponder` + relax `InboundChannelMessage.domain`.
- **Slice E3 — Business inbox transport.** Graph/Gmail OAuth delta-sync poller under the fabric webhook
  convention; sender→`Principal` binding.
- **Slice E4 — Full triage stages + attachments.** Summarize/extract-actions/urgency stages →
  `WorkItem`/calendar; attachment ingestion into `Document`.
- **Slice E5 — Coworker routing.** Wire `tasks/submit` so triaged mail reaches the right coworker.

---

## 7. Corrected open questions (several are answerable from substrate)

1. **Expose model selection to every user, or policy/mode only?** Already answered in code: admins
   own provider/model (`AgentModelConfig`, Platform>AI); users get **mode/policy** (advise/act,
   sensitivity) via `AgentPanelHeader`. Keep that split; don't expose raw model pickers to end users.
2. **Which use cases auto-frontier vs. require approval?** Encode on `TaskRequirement` via the new
   `escalationPolicy` field (§4.3). Email = utility/local, **never** auto-frontier.
3. **Private/no-memory mode — block writes or just retrieval?** Genuinely unbuilt (`memoryMode`
   absent). Recommendation: `private` blocks **both** persistence and retrieval for the thread;
   `scoped` blocks retrieval only. Needs the net-new field in §5.
4. **Model fit by host hardware or endpoints?** **Endpoints**, via existing `capability-probes` —
   not Odysseus's host-GPU scan (§4.6). DPF is server/multi-node.
5. **Where do AI spend/fallback/quality evidence converge with finance/ops?** On the `TokenUsage`
   ledger + `RouteOutcome.costUsd`/`AdapterRunTelemetry.estimatedCostUsd`, surfaced in a Platform>AI
   **Spend** tab and exported to finance reporting via report-kit. No new ledger.

---

## 8. Revised next decision

Approve a short architecture/design spec that **explicitly builds on existing substrate** and scopes:

1. The use-case matrix as **consolidation of `RequestContract` + `TaskRequirement`** + the missing
   rows (incl. email), with an admin tab — *not* a new policy type.
2. The **per-turn receipt view** (join of the three existing receipt tables) + its inline and
   Platform>AI surfaces — *no new receipt tables*.
3. The **four net-new thread fields/joins** only (`memoryMode`, durable `attachedSources`,
   `compactionState`, thread↔`DecisionInteraction` link).
4. Adoption of the **2026-04-27 control/data-plane spec** as the refactor work item.
5. **Email processing** scoped via Slices E1–E5, starting with E1 (pin email to local/utility),
   owned by the Communication Fabric + marketing-execution-loop, *not* a new email epic.

The central product bet from the original memo stands — DPF should feel like a reliable AI cockpit,
not a pile of settings. The correction this pass adds: **most of the cockpit is already built; the
work is to consolidate, surface, and govern it — and email is the highest-leverage first proof,
because it forces the local-first routing posture to become real.**
