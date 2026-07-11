# Convergence Memo — Collaborative Work Management × Build Studio Customer Mode

**Date:** 2026-07-11
**Author:** Platform research (goal session)
**Status:** Research memo → recommendation (kernel-ratified altitude)
**Governing decision:** WWMD `principle_decide` → **complete-migrate** (composite 7.18, margin 2.89, confidence high, no commandment conflict)
**Related specs:**
- `docs/superpowers/specs/2026-07-11-build-studio-customer-mode-convergence-addendum.md` (accepted-addendum, **unmerged** on `doc/build-studio-customer-mode-convergence`)
- `docs/superpowers/specs/2026-06-22-build-studio-overseer-ux-design.md` (EP-BUILD-STUDIO-UX)
- `docs/superpowers/specs/2026-06-19-unified-build-studio-tracking-all-surfaces-design.md` (EP-UNIFIED-TRACKING)
- `docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md` (accepted, WWMD-ratified)

**Related backlog:** **EP-WORK-CONVERGENCE** (governing epic, filed 2026-07-11, 9 items sequenced) — links the four write-model BIs (BI-D6FA8641, BI-5FDBF786, BI-A443B9CC, BI-BB13B599) plus five newly-filed items (see §6.7). *(The IA-default reframe referenced in Spec 4 as "BI-90670010" was never actually in the live backlog; re-filed here as BI-5EA94BD1.)*

---

## 0. Thesis (TL;DR)

**Collaborative work management and Build-Studio-customer-mode are the same architecture problem, discovered from two directions.** Both resolve to one shape the industry converged on in 2026 (Asana Agentic Work Management, Linear Agent API):

> **One durable work unit → workers (human + AI coworker + Claude/Codex/Grok executor) behind it → one business-language projection → a plain status + approve/revise loop.**

DPF already has ~80% of this substrate — it is **under-wired in two different places**:
- The **collaborative work** surfaces read only `WorkItem`/`WorkItemMessage`; the other six work primitives stay fragmented.
- **Build Studio** reads `FeatureBuild` directly and is blind to the `WorkCapsule` projection, so it can't see external Claude/Codex/Grok work.

The `WorkCase` read-projection (`apps/web/lib/work-management/status-projection.ts:271`) **already fuses `WorkItem` + `WorkCapsule` + `DecisionInteraction` + `RuntimeVerification`** into one 10-state, business-language case — but it is wired to `/portal/cases` and `/workspace/cases`, **not** Build Studio.

The kernel's altitude ruling is **complete the existing substrate (migration), not green-field and not a thin partial surface**. The single non-negotiable success criterion, carried from the addendum:

> **A nontechnical, spouse-level user succeeds at creating platform functionality without ever seeing source code or terminal output.**

---

## 1. The convergence insight

Two epics were solving the same problem without naming it:

| Direction | What it was building | Durable unit | The gap it hit |
|---|---|---|---|
| **Collaborative work management** (EP-CWQ-001, "Collaborative Work Queue") | A shared queue where humans and AI coworkers are co-assignees | `WorkItem` (`assignedToType` = user \| agent) | Loaders read only `WorkItem`; six other work primitives stay fragmented; no @mention/presence; attention inbox is a read-only deep-link funnel |
| **Build Studio customer mode** (EP-UNIFIED-TRACKING + EP-BUILD-STUDIO-UX + addendum) | A plain, coworker-style build experience for nontechnical users | `WorkCapsule` (`executorKind` = build-studio \| claude-desktop \| codex-desktop \| grok-desktop \| opencode \| human \| dpf-native) | BS reads `FeatureBuild` directly, blind to external agent work; write-model hinge (evidence↔capsule, `executor-changed` writer) unbuilt |

Both are the **same object graph**: a durable work unit, workers behind it, one projection, one approval loop. The `WorkCase` projection is the seam that already unifies them. Completing it in both places is the "clear path" that does not exist today.

---

## 2. What the best products figured out — mapped to DPF

Eight patterns from Linear, Jira, Asana, Monday, ClickUp, Notion, ServiceNow, GitHub Projects, and AutoGen/LangGraph/CrewAI-style orchestration, each mapped to DPF substrate and its current state.

| # | Industry pattern (exemplar) | DPF substrate | State |
|---|---|---|---|
| 1 | **Durable work unit** with a stable quotable key + minimal required core ([Linear `ENG-123`](https://linear.app/docs/creating-issues), Jira, GitHub `#123`) | `WorkCapsule` (universal unit per addendum §6.1); `WorkItem` for coworker work | ✅ model shipped; ⚠️ no stable human-quotable key (`capsuleId`/`itemId` are opaque) |
| 2 | **One typed timeline + cited auto-summary, no raw logs** ([Linear discussion summaries](https://linear.app/changelog/2025-10-02-issue-discussion-summaries), [GitHub timeline events](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types), [ServiceNow work-notes vs activity](https://www.servicenow.com/community/developer-forum/work-notes-change-assignment-group-log/td-p/3332535)) | `UnifiedEvidenceTimeline`, `WorkCapsuleActivity`, `changeNarrative`, `buildDecisionLedger` | ✅ Band 2/3 shipped; ⚠️ external lane *faked* from `FeatureBuild.codingProvider` (`WorkflowStageInspector.tsx:137`); evidence not bound to capsule |
| 3 | **Owner ≠ assignee ≠ watcher; handoff as an event; lease-with-reject-back-to-queue** ([ServiceNow AWA](https://www.servicenow.com/community/agent-chat-routing-and-sidebar/advanced-work-assignment-awa-faqs/ta-p/2306792), [GitHub keeps human co-assignee](https://github.blog/changelog/2025-12-18-assigning-github-copilot-to-an-issue-now-adds-you-as-an-assignee/)) | `WorkItem.assignedToType`; capsule `leaseHolderPrincipalId`; `executor-changed` activity kind | ⚠️ `executor-changed` **defined with zero writers** (`work-capsules.ts:88`); no `reassign_capsule_executor`; no first-class Requester |
| 4 | **Status projection: many internal states → ~4 fixed categories** ([Jira status categories](https://support.atlassian.com/jira-cloud-administration/docs/what-is-a-workflow-status/), Linear buckets, GitHub open/closed) | `WorkCase` 10-state projection (`case-types.ts:1`) + `blockingActorKind` | ✅ primitive shipped; ❌ not consumed by Build Studio; needs a ~4-category business collapse for lay surfaces |
| 5 | **Requester ≠ doer; bots as first-class named teammates** ([Linear agents as app users](https://linear.app/agents), [Asana AI Teammates](https://asana.com/resources/ai-teammates-overview), [Monday Digital Workforce](https://ir.monday.com/news-and-events/news-releases/news-details/2025/monday.com-Announces-AI-Vision-to-Empower-Businesses-to-Scale/default.aspx)) | AI coworkers already first-class (`Agent`); `accountableEmployeeId` vs `claimedBy*` | ⚠️ no first-class *Requester* on capsule; agents not rendered as named teammates with a session on the item |
| 6 | **Approval gates: inline one-tap vs full review; requester can't be sole approver** ([GitHub "creator can't be final approver"](https://github.blog/ai-and-ml/github-copilot/assigning-and-completing-issues-with-coding-agent-in-github-copilot/), [ServiceNow Flow approvals](https://www.servicenow.com/community/workflow-automation-articles/flow-designer-approvals-overview-workflow-automation-center-of/ta-p/2528202), [Asana Approvals](https://asana.com/inside-asana/new-approvals-feature)) | Band 4 "Where we need you" (two-choice, never auto-proceed-on-silence); ship = human PR click | ✅ Band 4 design; ⚠️ verbs limited to approve/revise — no first-class defer/split/escalate on the unit |
| 7 | **Kill the "70%-then-cliff" — last 30% stays plain-language, never "open the YAML"** ([MIT NANDA: ~5% of pilots reach production](https://hbr.org/2026/03/the-last-mile-problem-slowing-ai-transformation), [Notion AI](https://www.notion.com/blog/ai-project-management)) | Overseer bands + `engineerView` disclosure toggle (`BuildStudio.tsx:196`); addendum non-goals | ⚠️ `diffSummary = fullDiff.slice(0,500)` in a `<pre>` "labeled as a summary" (Spec 4 §3) — the cliff still exists; IA-default reframe unbuilt (BI-90670010) |
| 8 | **Multi-agent: agents as workers behind ONE session on ONE item, orchestration hidden** ([Linear Agent Interaction SDK — AgentSession + typed activities](https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk), [GitHub coding agent → draft PR + checklist](https://github.blog/ai-and-ml/github-copilot/assigning-and-completing-issues-with-coding-agent-in-github-copilot/)) | `TaskRun`/`TaskMessage` (A2A), `ConversationParticipant`, capsule `executorKind` | ⚠️ sessions exist per-executor but don't roll up to a single capsule-attached, human-legible session; "N agents = N surfaces" risk |

**The five most load-bearing for a nontechnical requester** (research synthesis): (1) a **durable unit with a stable quotable key** and no config wall to create; (2) a **cited, auto-regenerating plain-language summary** over a typed event stream, mechanical events collapsed to grey; (3) **status projection onto ~4 fixed categories** ("In Progress", not "Awaiting-Codegen-Retry-3"); (4) **agents as named teammates via one session on the item**, with delegation keeping a human accountable and a separation-of-duties approval gate; (5) **eliminating the last-mile cliff** — the final 30% stays in the same approve/revise/answer-a-question modality, never a diff/YAML/log.

---

## 3. What DPF already has (substrate reality)

| Element | State | Evidence |
|---|---|---|
| `WorkCapsule` executor-agnostic unit (`executorKind`, lease, `scopeClaims`, soft links) | ✅ shipped | `schema.prisma:1295` |
| `WorkItem` unified human-or-agent assignee (`assignedToType`) + `WorkItemMessage` threads | ✅ shipped | `schema.prisma:10142`, `:10188` |
| `WorkCase` business-language projection (10 states + `blockingActorKind` + plain `reason`) fusing WorkItem+Capsule+Decision+RuntimeVerification | ✅ shipped, wired to `/portal/cases` + `/workspace/cases` only | `work-management/status-projection.ts:271`, `case-types.ts:1` |
| Overseer bands: **Band 2 `changeNarrative`**, **Band 3 `buildDecisionLedger`** | ✅ shipped | `schema.prisma:5029`, `lib/build/decision-ledger.ts`, `BuildStudio.tsx:886` |
| Band 1 solution summary (additive) + `engineerView` disclosure toggle | ✅ shipped | `BuildSolutionSummaryBand.tsx`, `BuildStudio.tsx:196` |
| Build Studio consuming the capsule projection | ❌ not built (BI-BB13B599) — BS bands read `FeatureBuild` directly | `BuildStudio.tsx` (no `work-management` import) |
| ExternalEvidenceRecord ↔ WorkCapsule binding | ❌ not built (BI-D6FA8641) — schema still soft `buildId String?` | `schema.prisma:4955` |
| `executor-changed` writer / handoff protocol | ❌ not built (BI-A443B9CC) — enum entry, zero writers | `work-capsules.ts:88` |
| IA reframe making the plain band layer the default | ❌ not built (BI-90670010, deferred) | Spec 4 §6.1 |

**Diagnosis:** the substrate is real and mostly shipped; the *wiring* is missing in exactly two seams — (a) the collaborative surfaces read only `WorkItem`, and (b) Build Studio reads only `FeatureBuild`. The `WorkCase` projection is the bridge already built for both.

---

## 4. Why it feels like "no clear path"

1. **Two under-wired unifications.** The one substrate that unifies human+AI work (`WorkCase` over `WorkItem`+`WorkCapsule`) feeds neither the coworker collaboration surfaces fully nor Build Studio.
2. **The write-model hinge is unbuilt.** Without evidence↔capsule binding and an `executor-changed` writer, external Claude/Codex/Grok work never reaches the projection — so the "prettier customer surface would still be blind to external work" (addendum §7).
3. **The human is a spectator+approver, not a collaborator.** No first-class Requester on the unit; no @mention/assign-to-coworker; no cross-actor presence; agents aren't rendered as named teammates with a legible session.
4. **The last-mile cliff persists.** `diffSummary.slice(0,500)` in a `<pre>` *looks* like a summary but is truncated code; the IA-default reframe that makes the plain layer primary is deferred.
5. **Governance drift** *(now partly resolved)*. The addendum is still **unmerged**; the four load-bearing BIs previously had **no governing epic** — now filed as **EP-WORK-CONVERGENCE** (§6.7) with the write-model-first ordering priority-encoded.

---

## 5. Licensing / auth reality (verified from official sources) — and why it *reinforces* the model

| Executor | Verified terms | Architectural consequence |
|---|---|---|
| **Claude (Agent SDK / Claude Code)** | Governed by *"Anthropic's Commercial Terms of Service, including when you use it to power products and services that you make available to your own customers and end users"* ([code.claude.com](https://code.claude.com/docs/en/agent-sdk/overview)). **API-key auth required** — *"Anthropic does not allow third party developers to offer claude.ai login … including agents built on the Claude Agent SDK."* Branding: **"Claude Code" name not permitted** for partner products; **"Powered by Claude" + your own branding** is the allowed form. | Legitimate to embed a Claude executor for customers **with an API key** (Console / Bedrock / Vertex / Azure). Anthropic's own terms **mandate the memo's thesis**: the executor must appear as a **DPF coworker "Powered by Claude,"** never a raw "Claude Code" surface. |
| **OpenAI Codex CLI** | **Apache-2.0** ([openai/codex](https://github.com/openai/codex)); auth via ChatGPT sign-in **or** OpenAI API key; MCP-capable. | Embeddable as a provider adapter; use API-key auth for headless/production runs. |
| **xAI Grok API** | API-key developer API, **OpenAI-compatible** (`base_url https://api.x.ai/v1`), function calling ([docs.x.ai](https://docs.x.ai/docs/overview)); separate from the consumer product. | Embeddable as a provider adapter via the OpenAI-compatible client; pay-per-token. |

**Load-bearing finding:** the "executors are workers behind the WorkCapsule, not user surfaces" design is not just good UX — for the Claude path it is **required by Anthropic's terms** (API-key auth, no reselling claude.ai login, no "Claude Code" branding). The architecture and the license agree.

---

## 6. Recommendations

Ordered **write-model first** (the addendum's ordering; the kernel's Architecture-Over-Shortcuts weighting confirms it). "A prettier customer surface before the write model is unified would still be blind to external work."

### 6.1 Build Studio UX
- Make the **plain overseer band layer the default first-viewport**; demote `ProcessGraph`/raw diff/`taskResults`/`buildExecState` one disclosure click behind a single **"Engineer view"** affordance (ship the deferred **BI-90670010**).
- **Kill the fake summary:** replace `diffSummary = fullDiff.slice(0,500)` in `<pre>` with the plain `changeNarrative` (Band 2 already shipped); raw diff moves behind dive-in.
- Approval = **explicit two-choice, never auto-proceed-on-silence** (Approve / "Something looks off"), plus one-click "Try to fix". Add first-class **defer / split / escalate** outcomes alongside approve/revise.
- **Never silently drop the user into raw code** (Spec 4 anti-pattern-1; the wife-test guardrail).

### 6.2 WorkCapsule (durable unit)
- Mint a **stable, human-quotable key** (prefix + monotonic number, e.g. `WK-1042`) at capsule creation — the referenceable identity used in status, comments, approvals, and agent sessions (Linear/Jira/GitHub model).
- Add a first-class **Requester** (the nontechnical commissioner) distinct from the active worker and the accountable owner.
- Keep the required core minimal (title + status) so a requester creates one in one plain-language line — no config wall.

### 6.3 Evidence timeline
- **Bind `ExternalEvidenceRecord` to `WorkCapsule`** with producer identity (principal + `executorKind`) — **BI-D6FA8641**, the write-model hinge.
- Render the timeline as **one typed event stream**: mechanical/agent events **collapsed to grey**, decisions/questions **prominent** (ServiceNow two-lane + Linear collapse), topped by an **auto-regenerating, cited plain-language summary** (Linear discussion-summary pattern; DPF already has `changeNarrative` + `buildDecisionLedger` as the seed).
- Raw evidence stays **behind Engineer view**, never in the default feed.

### 6.4 Handoff protocol
- Implement the **`executor-changed` writer** and a governed `reassign_capsule_executor` path that transfers the lease and records provenance — **BI-A443B9CC**.
- **propose → acknowledge → adopt** (handoff manifest: next action, open risks, evidence digest, branch/worktree, suggested receiver), rendered as **a plain status event, not raw agent plumbing** ("Claude started this; Grok is finishing it").
- **External work-start auto-claims/adopts a capsule** — **BI-5FDBF786** — so external agent work is never orphaned from the unit.
- Keep a **human co-accountable** even when an agent works the item (GitHub's co-assignee fix); support **lease-with-reject-back-to-queue** (ServiceNow AWA).

### 6.5 Status projection
- **Wire Build Studio to the `WorkCase` projection** (`projectCapsule`) instead of reading `FeatureBuild` directly — **BI-BB13B599**, the "wife-test UX."
- Add a **~4-category business collapse** over the 10 internal states for lay surfaces: **Getting set up · In progress · Needs you · Done** (+ *Paused* for blocked/waiting-on-system). The rich state machine stays internal; agent micro-states collapse into "In progress" (Jira status-category model).

### 6.6 Collaboration roles, presence & multi-agent
- Render each executor as a **named teammate with one `AgentSession` attached to the capsule**, emitting a small set of typed, human-legible activities (**thought / action / question / response / error** — Linear Agent SDK pattern). Multi-agent orchestration (planner + specialist workers) **rolls up into one session on one item**; sub-workers appear at most as subtasks — **never N surfaces / N CLIs**.
- Add the missing coworker-collaboration primitives on the canonical unit: **threaded comments + @mention/subscription** (wire `Notification` to a watch fabric), **assign-to-coworker / hand-back**, and lightweight **presence** (who's on this item).

### 6.7 Backlog sequencing (the path) — **filed as EP-WORK-CONVERGENCE (2026-07-11)**

The governing epic **EP-WORK-CONVERGENCE** now unifies EP-UNIFIED-TRACKING + EP-BUILD-STUDIO-UX + the CWQ substrate + this addendum. Nine items, priority-encoded write-model-first:

| Prio | BI | Item | Size |
|---|---|---|---|
| 1 | **BI-D6FA8641** | Bind external evidence to WorkCapsule *(write-model hinge; do first)* | medium |
| 2 | **BI-5FDBF786** | External work-start auto-claims/adopts a capsule | medium |
| 3 | **BI-B24F96D0** | WorkCapsule durable-unit upgrade: stable human-quotable key + first-class Requester | medium |
| 3 | **BI-A443B9CC** | Cross-agent handoff + `executor-changed` writer + lease transfer | large |
| 4 | **BI-BB13B599** | Build Studio reads the `WorkCase` projection *(the wife-test surface)* | medium |
| 5 | **BI-5EA94BD1** | Build Studio IA reframe: plain overseer band layer becomes default | medium |
| 5 | **BI-AC815F1E** | Bridge remaining work primitives into the `WorkCase` projection via `source-registry` | large |
| 6 | **BI-C41AB195** | Unified `AgentSession` rollup: each executor as one named-teammate session on the capsule | large |
| 6 | **BI-B416B12A** | Threaded comments + @mention/subscription + presence on the canonical work unit | large |

**Still open (operator actions):** merge the convergence addendum (`doc/build-studio-customer-mode-convergence`); `promote_to_build_studio` on each BI when ready (linking to an epic is organizational only — it does not promote). One work graph, two entry surfaces (coworker panel + Build Studio).

---

## 7. Success criterion & acceptance test

**A nontechnical, spouse-level user creates platform functionality without ever seeing source code or terminal output.** Concretely, the user can:

1. Describe intent in business language and answer only business questions.
2. See one plain status ("Needs you"), one next action, and one preview/screenshot path — never a worktree name, container id, evidence JSON, provider name, or gate predicate.
3. Read *what changed and why* as a plain narrative (not a truncated diff), with decisions surfaced.
4. Approve / revise / defer / split / escalate in one tap; never be required to open a diff, YAML, JSON, or log to finish.
5. Watch a Claude→Grok handoff render as "someone else is finishing this," not as agent plumbing.

If any step forces the user across the code/terminal line, the convergence has failed — that is the last-mile cliff the whole memo exists to remove.

---

## 8. Kernel decision record

`principle_decide` (calling population `in_platform_coworker`), 2026-07-11:

- **Recommendation:** `complete-migrate` — composite **7.18**, margin **2.89**, confidence **high**.
- Alternatives scored lower: `thin-surface` 4.29, `greenfield` 2.91.
- **Top contributors:** Architecture Over Shortcuts (+0.63 vs +0.20 thin / +0.15 greenfield), Never Assume–Verify (+0.74).
- **Flags:** no commandment conflict; structured coverage strong; no tie.
- **Reading:** complete the existing substrate. Do **not** green-field a new work model; do **not** ship a thin partial surface that leaves the fragmentation as debt.

*(Ledger not persisted — `dpf-organizational-principles` profile not provisioned in this environment; audit trail is the MCP response captured in the goal session.)*

---

### Primary sources
Linear [Agent SDK / AgentSession](https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk) · [discussion summaries](https://linear.app/changelog/2025-10-02-issue-discussion-summaries) · [agents](https://linear.app/docs/agents-in-linear) · GitHub [timeline events](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types) · [coding agent](https://github.blog/ai-and-ml/github-copilot/assigning-and-completing-issues-with-coding-agent-in-github-copilot/) · [co-assignee](https://github.blog/changelog/2025-12-18-assigning-github-copilot-to-an-issue-now-adds-you-as-an-assignee/) · Jira [status categories](https://support.atlassian.com/jira-cloud-administration/docs/what-is-a-workflow-status/) · [Rovo](https://www.atlassian.com/software/jira/ai) · ServiceNow [AWA](https://www.servicenow.com/community/agent-chat-routing-and-sidebar/advanced-work-assignment-awa-faqs/ta-p/2306792) · [Flow approvals](https://www.servicenow.com/community/workflow-automation-articles/flow-designer-approvals-overview-workflow-automation-center-of/ta-p/2528202) · Asana [AI teammates](https://asana.com/resources/ai-teammates-overview) · [approvals](https://asana.com/inside-asana/new-approvals-feature) · Notion [AI PM](https://www.notion.com/blog/ai-project-management) · last-mile [HBR](https://hbr.org/2026/03/the-last-mile-problem-slowing-ai-transformation) · [MIT NANDA via TechTarget](https://www.techtarget.com/searchenterpriseai/feature/7-last-mile-delivery-problems-in-AI-and-how-to-solve-them) · Claude [Agent SDK terms](https://code.claude.com/docs/en/agent-sdk/overview) · Codex [openai/codex](https://github.com/openai/codex) · Grok [docs.x.ai](https://docs.x.ai/docs/overview)
