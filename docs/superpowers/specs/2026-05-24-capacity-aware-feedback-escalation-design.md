# Capacity-Aware Feedback Escalation Design

| Field | Value |
| ----- | ----- |
| Status | Draft - UX/architecture refresh applied 2026-05-26 |
| Date | 2026-05-24 |
| Backlog item | `BI-FBDC0861` (Phase 2/2a: Feedback routing decision and resolution closure ledger). Live MCP check on 2026-05-26 found no exact indexed spec/plan for this design before filing. Active implementation context also includes `EP-9FC5D2FD` with `BI-4CDB18EE` (Phase 1: Feedback support-mode entry) and `BI-C50D48C6` (Phase 1 correction: align feedback support event contract and fallback handling). `EP-REDUCTION-GEAR-ARCH` remains adjacent substrate context, not the first home for this slice. |
| Epic recommendation | Keep the first BI under `EP-9FC5D2FD` while the first user path is Dale/Build Studio support escalation. Create `EP-FEEDBACK-CAPACITY-ROUTING` only if the scope expands into a platform-wide issue-report substrate beyond the Dale/Build Studio path. |
| Related substrate | [`apps/web/lib/feedback/feedback-event.ts`](../../../apps/web/lib/feedback/feedback-event.ts); [`apps/web/lib/actions/feedback-support.ts`](../../../apps/web/lib/actions/feedback-support.ts); [`apps/web/lib/quality/platform-issue-reports.ts`](../../../apps/web/lib/quality/platform-issue-reports.ts); [`apps/web/lib/quality/issue-report-status.ts`](../../../apps/web/lib/quality/issue-report-status.ts); [`apps/web/components/feedback/`](../../../apps/web/components/feedback); [`apps/web/components/agent/AgentCoworkerShell.tsx`](../../../apps/web/components/agent/AgentCoworkerShell.tsx); [`apps/web/app/api/quality/report/route.ts`](../../../apps/web/app/api/quality/report/route.ts); [`apps/web/lib/actions/quality.ts`](../../../apps/web/lib/actions/quality.ts); [`apps/web/lib/operate/issue-report-triage.ts`](../../../apps/web/lib/operate/issue-report-triage.ts); [`apps/web/lib/queue/functions/issue-report-triage.ts`](../../../apps/web/lib/queue/functions/issue-report-triage.ts); [`apps/web/lib/integrate/issue-bridge.ts`](../../../apps/web/lib/integrate/issue-bridge.ts); [`apps/web/lib/integrate/issue-bridge.test.ts`](../../../apps/web/lib/integrate/issue-bridge.test.ts); [`apps/web/lib/integrate/identity-privacy.ts`](../../../apps/web/lib/integrate/identity-privacy.ts); `PlatformIssueReport`; `Notification`; `PlatformNotification`; `PlatformDevConfig.contributionMode` |
| Related specs | [Quality feedback (2026-03-14)](2026-03-14-quality-feedback-design.md); [Platform feedback loop (2026-03-16)](2026-03-16-platform-feedback-loop-design.md); [Pseudonymous identity and backlog issue bridge (2026-04-18)](2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md); [AI capacity continuity (2026-05-12)](2026-05-12-ai-capacity-continuity-design.md); [Reduction gear architecture (2026-05-24)](2026-05-24-reduction-gear-architecture-design.md); [Vertical workspace home (2026-05-24)](2026-05-24-vertical-workspace-home-design.md); [Feedback resolution closure contract (2026-05-26)](2026-05-26-feedback-resolution-closure-design.md) |
| Scope | The operator Feedback path from a non-technical user such as Dale through coworker support triage, local resolution, local BI creation, or upstream GitHub Issue escalation through the existing issue bridge. |
| Out of scope | Feature implementation in this thread; voice STT until Phase 6; replacing the general backlog system; making GitHub Issues the canonical store for all local issue reports; creating a parallel GitHub Issue writer or issue-tracker abstraction before the existing bridge is exhausted; GearInterface schema design beyond an optional future observation emission. |

---

## Architect Verdict

The original plan has the right product instinct: Feedback must stop being a local dead end. Dale should not have to know whether a failure belongs in a local BI, Build Studio, Admin issue reports, GitHub Issues, or a maintainer's head. The platform should do that routing.

The plan needed five architectural corrections before implementation:

1. **The issue-report substrate was fragmented and must stay converged.** `POST /api/quality/report`, `reportQualityIssue()`, the `report_quality_issue` MCP tool, crash-boundary writes, and coworker-runtime writes historically created `PlatformIssueReport` rows with different context fidelity. The current branch introduces a canonical writer; Phase 0 must preserve that convergence and cover any remaining caller drift before adding a new escalation layer.
2. **The current triage cron will race the new flow.** `quality/issue-report-triage` selects every `PlatformIssueReport(status="open")`, creates a local BI, and marks the report `triaged_local`. Support-mode reports need a distinct status/source path so the cron does not convert upstream-worthy feedback into ordinary local backlog before capacity assessment runs.
3. **The bridge policy is not what the draft assumed.** `escalateToUpstreamIssue()` supports `kind: "issue-report"`, but it explicitly skips `fork_only`. If the product wants an exceptional "send this one critical report upstream" path for fork-only installs, that is a deliberate contribution-policy extension with audit state, not a wrapper around the existing function.
4. **The reverse channel should use the right notification model.** `PlatformNotification` is global/admin-style and has no `userId` or `deepLink`; Dale-facing resolution updates belong in `Notification`. `PlatformNotification` can still carry admin/global feedback health.
5. **The upstream issue path already exists.** `issue-bridge.ts` and its tests are the GitHub Issues capability for backlog, epic, and issue-report escalation. This design must extend that path for feedback policy, labels, privacy gates, and idempotency instead of adding a feedback-specific GitHub API writer.

Follow-up closure correction added 2026-05-26: **resolution is not complete when upstream work exists.** The [Feedback resolution closure contract](2026-05-26-feedback-resolution-closure-design.md) defines the artifact ledger, PR/release linking, applicability scope, identity/privacy gates, local update/apply state, and submitter notification semantics required before Phase 5 can safely tell Dale a fix is ready or installed.

Current branch correction added 2026-05-26: the first support-mode substrate already exists in this worktree (`FeedbackEventDetail`, support session IDs, `createPlatformIssueReport()`, `ISSUE_REPORT_STATUS`, and `startFeedbackSupport()`). The plan should therefore **harden and extend** that substrate rather than ask the implementer to create it again.

This design therefore starts with convergence and hardening, then adds capacity routing and closure.

## 1. Problem

Today, a non-technical operator has one visible instinct when something does not work: click Feedback or describe the problem to the coworker. The system then splinters:

- manual feedback writes a `PlatformIssueReport`;
- crash boundaries auto-write a `PlatformIssueReport`;
- coworker runtime stalls can write a `PlatformIssueReport`;
- the issue-report triage cron turns `open` reports into local BIs and marks them `triaged_local`;
- backlog, epic, and issue-report rows can be escalated upstream through `issue-bridge.ts`;
- the Feedback click now carries typed support context on this branch, but does not yet make a first-class capacity decision or closure projection.

That is close, but not coherent. The missing product contract is:

> Feedback is the operator's single "help me with this" affordance. The platform tries to resolve locally first, then decides whether the work should become local backlog or an upstream project issue.

Without this, Dale hits four dead ends:

1. The local model or provider configuration cannot handle the work.
2. The issue is too architectural for Dale to decompose.
3. The fix belongs in the upstream platform repo, not his install.
4. A hard failure gives him no language for what broke.

## 2. Capacity Terms

This spec uses **resolution capacity**, not just model rate capacity.

| Term | Meaning | Existing anchor |
| ---- | ------- | --------------- |
| Model capability capacity | Whether the active providers can solve the class of task. | `ModelProvider`, `ModelProfile`, `AgentModelConfig`, routing tier checks, `loadBuildStudioCapability()` |
| Runtime/rate capacity | Whether a provider is available and under rate limits. | `checkModelCapacity()` in routing pipeline |
| Local delivery capacity | Whether this install can safely fix, verify, and ship the change locally. | Build Studio, sandbox, MCP grants, user authority, active build state |
| Upstream project capacity | Whether the right path is a pseudonymous GitHub Issue for maintainers. | `issue-bridge.ts`, GitHub Issues, contribution policy |
| Human attention capacity | Whether Dale is able to approve, clarify, or continue. | PAR acknowledgement, coworker support mode, notifications |

The function proposed below should be named around the routing question, not the rate-limit question. Recommended name: `assessFeedbackRouting()`.

## 3. Current Repo Truth

| Area | Verified current behavior | Design implication |
| ---- | ------------------------- | ------------------ |
| Feedback entry | `HeaderFeedbackButton` and `FeedbackButton` now dispatch `CustomEvent("open-agent-feedback")` with validated `FeedbackEventDetail` from `createManualFeedbackEventDetail()`, including `triggerKind`, normalized route, `supportSessionId`, and `autoFilePolicy`. Both pass the same detail into `FeedbackForm` fallback if no panel appears. | Keep the one-click entry. Next work enriches non-manual triggers and active build/thread hints; it does not create a second feedback entry surface. |
| Coworker shell | `AgentCoworkerShell` validates `open-agent-feedback` detail, opens the existing panel, adds support welcome copy, and calls `beginFeedbackSupport()` with route/build/thread context. | No new shell is needed. Mature the existing support mode into a bounded resolution/routing flow; do not create a separate chat surface. |
| Manual issue creation | `POST /api/quality/report`, `reportQualityIssue()`, and the MCP `report_quality_issue` tool now route through `createPlatformIssueReport()`, which validates status, truncates to schema limits, resolves default product/portfolio, and preserves trigger/support/thread/build fields where provided. | Treat this as the canonical writer. Phase 0 hardening should add missing coalescing/privacy/closure hooks and keep all callers on this service instead of reintroducing writer drift. |
| Crash boundary | `apps/web/app/(shell)/error.tsx` auto-posts a critical `runtime_error` report and lets the user add context. | Hard-failure capture already exists; Phase 4 should dispatch the support/escalation event from this path after the local report exists. |
| Issue-report triage | `quality/issue-report-triage` runs every 15 minutes, selects only `status: "open"` reports, converts them into BIs, marks them `triaged_local`, and separately files spike BIs. | New support-mode reports must stay out of plain `open` while awaiting capacity assessment. The existing `SUPPORT_FLOW_STATUSES` constant is the right guardrail to preserve. |
| Issue bridge / Git issue capability | `issue-bridge.ts` supports `EscalationKind = "backlog" | "epic" | "issue-report"`, builds redacted GitHub Issues, records `upstreamIssueNumber`, `upstreamIssueUrl`, `upstreamSyncedAt`, and skips `fork_only`. `issue-bridge.test.ts` covers GitHub repo parsing, body/title redaction, fork-only skip, success persistence, and issue-report escalation with error-stack context. | Treat this as the upstream GitHub Issue capability. Extend bridge policy, labels, privacy gates, and idempotency in place; do not add a parallel feedback-specific GitHub client. |
| Privacy | `identity-privacy.ts` provides stable pseudonym identity and `redactHostnames()`. | Keep pseudonym as the only upstream identity. Add pre-send secret scanning and synthesized summaries before bridge call. |
| Notifications | `Notification` has `userId`, `type`, `title`, `body`, `deepLink`, `read`. `PlatformNotification` has global `severity`, `category`, `subjectId`, `message`, `resolvedAt`. | User-visible feedback resolution uses `Notification`; admin/system health uses `PlatformNotification`. |
| Build Studio capacity | `loadBuildStudioCapability()` already decides whether Build Studio has a strong remote provider with tool use and >=32K context. | Feedback routing should consume this helper when route/build context indicates Build Studio, not duplicate provider-tier logic. |
| UI debt | Feedback fallback and Admin issue-report UI have mostly moved to DPF theme tokens; `TokenExpiryBanner.tsx` still uses hardcoded red/yellow classes and `IssueReportPanel` uses inline CSS-var tone styles for severity/status chips. | Keep touched feedback surfaces token-compliant. If resolution notifications reuse admin banners or queue chips, finish those styling seams in the same slice instead of spreading a second visual language. |

## 4. Research and Benchmarking

### 4.1 Open-source / source-available patterns

| System | Relevant pattern | Adopt | Reject |
| ------ | ---------------- | ----- | ------ |
| Sentry User Feedback / Issues | Feedback can be collected anywhere, attached to issue context, and queried as an issue category. Issue detail pages co-locate feedback, attachments, replays, activity, and linked GitHub/Jira issues. Sources: [Sentry User Feedback](https://docs.sentry.io/product/user-feedback/), [Sentry Issue Details](https://docs.sentry.io/product/issues/issue-details/). | Treat user feedback as issue-like evidence with route/error context and lifecycle state. | Do not copy Sentry's identity model or default to shipping screenshots/replays upstream. DPF privacy rules are stricter. |
| GlitchTip | Open-source Sentry-compatible error tracking receives error events through Sentry SDKs and groups them into an issue queue. Source: [GlitchTip documentation](https://glitchtip.com/documentation/). | Keep crash/error capture protocol-compatible in spirit: small structured envelope, grouping/coalescing, self-hostable posture. | Do not introduce a second external error tracker for this slice. |
| GitLab Service Desk / Issues | Customers can send bug reports, feature requests, or feedback without knowing the GitLab instance; Service Desk tickets become regular issues. Sources: [GitLab Service Desk](https://docs.gitlab.com/user/project/service_desk/), [GitLab Issues](https://docs.gitlab.com/user/project/issues/). | Let non-technical operators enter through a familiar support surface while maintainers work in an issue tracker. | Do not expose raw tracker mechanics to Dale or require him to choose project/request types. |

### 4.2 Commercial patterns

| System | Relevant pattern | Adopt | Reject |
| ------ | ---------------- | ----- | ------ |
| Linear Customer Requests | Customer requests link source feedback to issues/projects and can preserve the source link, customer impact, and importance. Source: [Linear Customer Requests](https://linear.app/docs/customer-requests). | Model feedback as a source-linked request behind an issue, with importance/capacity reason stored locally. | Do not sync customer identity, domain, revenue, or tenant details upstream. |
| Jira Service Management | Request types organize incoming customer requests and can be grouped in a portal. Source: [Atlassian request types](https://support.atlassian.com/jira-service-management-cloud/docs/categorize-customer-requests-into-request-types/). | Use internal classification after capture to route work efficiently. | Do not make Dale pick categories/severity before he can ask for help. |
| GitHub Issues | PR descriptions or commit messages can link to and automatically close Issues with supported keywords when merged to the default branch. Source: [GitHub linked issues and PRs](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue). | Use GitHub Issue state and linked PR closure as the upstream resolution signal. | Do not rely only on GitHub email/web UI for the operator-facing closure loop. |

### 4.3 Standards

OpenTelemetry's log data model separates timestamps, severity, structured bodies, and exception attributes. Source: [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/). DPF should align the feedback event envelope with that shape where useful: `triggerKind`, severity, observed timestamp, route/resource attributes, and an optional structured error body. The local `PlatformIssueReport` remains the domain model; OTel alignment is for event hygiene and future export, not a dependency.

## 5. Design Principles

1. **One operator affordance, multiple routed outcomes.** Dale clicks one thing; the platform chooses local help, local BI, or upstream issue.
2. **Local resolution first, but not forever.** The coworker attempts a bounded support loop, then records why it stopped.
3. **No hidden race with triage.** Reports in support triage are not eligible for the generic issue-report-to-BI cron until the support flow chooses that path.
4. **Reuse the existing Git issue path.** Upstream filing flows through `issue-bridge.ts` unless a later architecture review retires that bridge globally.
5. **GitHub Issues is canonical only after upstream escalation.** Before that, `PlatformIssueReport` is the local canonical record.
6. **Privacy is structural.** Upstream bodies use pseudonym identity, `redactHostnames()`, secret scanning, and coworker-synthesized summaries instead of raw transcript dumps.
7. **Contribution policy stays visible.** `fork_only` exceptional escalation requires explicit operator acknowledgement and audit fields. It must not silently weaken private-install posture.
8. **User notifications are local.** Dale receives a DPF `Notification` with a route deep link; GitHub is a secondary external reference.
9. **20 percent refactor budget is mandatory.** The first implementation slice cleans the feedback/reporting substrate before adding new routing behavior.

## 6. Future Architecture

```text
Operator clicks Feedback or a hard trigger fires
        |
        v
Typed feedback event detail is built
        |
        v
createPlatformIssueReport() writes one local canonical row
        |
        v
Coworker support mode opens on the existing AgentCoworkerShell
        |
        v
Bounded local-resolution loop
        |
        v
assessFeedbackRouting() records routing decision and closure seed
        |
        v
PlatformIssueResolution ledger records expected closure path
        |
        +--> resolved locally
        |       - status: resolved_locally
        |       - resolution status: local_answered or verified_here
        |       - optional ImprovementSignal / telemetry
        |
        +--> local work needed and install can handle it
        |       - status: triaged_local
        |       - create or link local BI
        |       - resolution tracks BI/build/update evidence
        |
        +--> capacity insufficient or hard-failure upstream path
                - status: awaiting_escalation_ack or upstream_pending
                - synthesize safe issue body
                - pre-send privacy/secret checks
                - fileUpstreamFeedback() calls issue-bridge.ts with kind: "issue-report"
                - status: upstream_filed
                - resolution tracks issue/PR/release/apply state before Dale gets closure
```

### 6.1 Trigger Contract

Add a typed payload for `open-agent-feedback` and keep `open-agent-panel` compatibility:

```ts
type FeedbackTriggerKind =
  | "manual"
  | "runtime-error"
  | "grant-denied"
  | "structural-verification-fail"
  | "coworker-stall"
  | "issue-spike";

type FeedbackEventDetail = {
  triggerKind: FeedbackTriggerKind;
  routeContext: string;
  title?: string;
  description?: string;
  errorStack?: string;
  userAgent?: string;
  featureBuildId?: string;
  threadId?: string;
  taskRunId?: string;
  sourceId?: string;
  autoFilePolicy?: "ask" | "auto-hard-failure";
  supportSessionId: string;
};
```

The event opens the coworker with an auto-message such as:

> I can help with what is stuck on this page. I will first try to resolve it here. If it looks like the project team needs to fix the platform, I will package a safe report for you to approve.

Hard-failure triggers may create the local report immediately and then open the coworker with status text. They should not require Dale to describe the crash before anything is captured.

### 6.2 PlatformIssueReport State

Current schema uses a free-form string `status`; the current branch already defines `ISSUE_REPORT_STATUS` and `SUPPORT_FLOW_STATUSES` in `apps/web/lib/quality/issue-report-status.ts`. Keep that file as the application enum source for report states, and update any MCP/API schemas that expose the values in the same implementation slice.

Important boundary: these are **report-routing states**, not end-to-end closure states. PR, release, update, local apply, and verification state belongs to the resolution closure ledger defined in [Feedback resolution closure contract](2026-05-26-feedback-resolution-closure-design.md).

Recommended state vocabulary:

| Status | Meaning |
| ------ | ------- |
| `open` | Generic issue report not yet claimed by support triage. Existing cron may process these. |
| `support_triage` | Coworker is attempting local resolution; generic BI cron must skip. |
| `resolved_locally` | Coworker resolved or explained the issue without creating BI/upstream. |
| `triaged_local` | Converted or linked to local backlog. |
| `awaiting_escalation_ack` | Coworker recommends upstream escalation and needs human acknowledgement. |
| `upstream_pending` | Auto-file or acknowledged escalation is in progress. |
| `upstream_filed` | GitHub Issue exists and local row has upstream issue fields. |
| `resolved_upstream` | Legacy/report-level summary that upstream work has closed; do not use this alone as Dale-facing closure unless the resolution ledger also proves availability/apply state. |
| `suppressed` | Duplicate, automated warmup, spam, or unsafe report suppressed. |

Per AGENTS.md enum discipline, do not let one writer invent a status string alone.

Already-present routing fields to preserve:

- `triggerKind`
- `supportSessionId`
- `source`
- `threadId`
- `taskRunId`
- `featureBuildId`
- `upstreamIssueNumber`
- `upstreamIssueUrl`
- `upstreamSyncedAt`
- unique `(reportedById, supportSessionId)` for authenticated support sessions

Recommended additive fields for the next routing slice:

```prisma
model PlatformIssueReport {
  // existing fields...
  coalesceKey                String?
  coalesceBucket             String?
  occurrenceCount            Int       @default(1)
  lastSeenAt                 DateTime?
  escalationAcknowledgedAt   DateTime?
  escalationAcknowledgedById String?
  escalationPolicy           String?   // selective | contribute_all | fork_only_exception
  capacityDecision           String?   // resolved_locally | local_bi | upstream | ask
  capacityDecisionReasons    Json?
  supportSummary             String?   @db.Text
  resolvedAt                 DateTime?

  @@index([coalesceKey, coalesceBucket])
  @@index([status, createdAt])
}
```

`agentThreadId` should not be added; the current schema already has `threadId`. Do not add PR/release/apply fields to `PlatformIssueReport`; those belong to the resolution ledger so multiple reports can share one closure story.

### 6.3 Coalescing

The draft's `(reportedById, routeContext, 10min)` index is not a clean Prisma/Postgres primitive. Use a deterministic key:

```text
coalesceKey = sha256(reportedById-or-session + routeContext + triggerKind + normalizedErrorSignature)
coalesceBucket = UTC timestamp floored to 10 minutes, formatted as YYYYMMDDHHmm
```

`normalizedErrorSignature` is a stable, low-cardinality digest of the failure shape, not the raw stack:

- for `runtime-error`: error `name` + first non-vendor stack frame's `function:file` (paths stripped to repo-relative segments, line numbers dropped);
- for `grant-denied`: tool name + missing scope;
- for `structural-verification-fail`: build phase + failing check id;
- for `coworker-stall`: thread id-class (running/queued/blocked) + last tool name;
- for `issue-spike`: triage class;
- for `manual`: the empty string (manual reports coalesce on route + reporter alone).

The signature must not contain user-supplied free text, hostnames, secrets, or business identifiers. Those are what `redactHostnames()` and the privacy gates exist to scrub later, not what the coalesce key should depend on.

On create, the service looks for the same `(coalesceKey, coalesceBucket)` and updates `occurrenceCount`, `lastSeenAt`, and append-only context rather than creating another row. A future migration can make this a partial unique index if the service-level guard proves insufficient, but do not start with an expression index that the application cannot reason about.

### 6.4 Capacity Routing Decision

`assessFeedbackRouting(context)` returns:

```ts
type FeedbackRoutingDecision =
  | FeedbackRoutingResolvedLocally
  | FeedbackRoutingLocalBi
  | FeedbackRoutingUpstream
  | FeedbackRoutingAsk;

type FeedbackRoutingBase = {
  reasons: string[];
  scope: "instance" | "archetype" | "project";
  expectedClosurePath:
    | "local_answer"
    | "local_backlog"
    | "local_build"
    | "upstream_issue_pr_release"
    | "admin_action";
  privacySeed: {
    canShareUpstream: boolean;
    requiresSecretScan: boolean;
    requiresAcknowledgement: boolean;
  };
};

type FeedbackRoutingResolvedLocally = FeedbackRoutingBase & {
  route: "resolved_locally";
};

type FeedbackRoutingLocalBi = FeedbackRoutingBase & {
  route: "local_bi";
  suggestedBacklogTitle: string;
};

type FeedbackRoutingUpstream = FeedbackRoutingBase & {
  route: "upstream";
  acknowledgement: "not_required" | "required";
};

type FeedbackRoutingAsk = FeedbackRoutingBase & {
  route: "ask";
  prompt: string;
};
```

Inputs:

| Signal | Source | Routing use |
| ------ | ------ | ----------- |
| Trigger kind | Event detail | `runtime-error`, `grant-denied`, and `structural-verification-fail` start as high-severity and may skip the generic local-BI path. |
| Build Studio capability | `loadBuildStudioCapability()` when route/build context indicates Build Studio | If no strong remote provider exists, route toward provider guidance rather than upstream code issue unless the product bug is independent of local setup. |
| Build/task state | `FeatureBuild`, `TaskRun`, `AgentThread`, existing issue reports | Repeated phase failure, repeated tool loop, or cross-build context mismatch can justify upstream. |
| Model/provider telemetry | routing decision logs, `NoEligibleEndpointsError`, provider status/rate capacity | Distinguish "connect provider" from "platform broke". |
| Authority/grants | MCP insufficient scope, tool grants, user role | Grant-denied can be a local admin action, upstream product gap, or documentation issue depending on context. |
| Coworker support loop result | bounded support-mode transcript and tool results | If the coworker cannot converge after a small number of turns, record a reason and stop. |
| Dale explicit escape | "tell the project", "someone needs to fix the platform" | Route `ask` or `upstream` depending on contribution mode and privacy checks. |

The function is pure at the decision layer. Dependencies are passed in as snapshots so unit tests can cover all branches without Prisma. The caller persists the report status, creates or links a `PlatformIssueResolution`, and records privacy/applicability seeds before any upstream send.

**`ask` vs `upstream` with `acknowledgement="required"`** - these look similar but answer different questions:

| Route | Decision is | Operator question | Privacy/secret-scan state |
| ----- | ----------- | ----------------- | ------------------------- |
| `ask` | not yet made | "I need more information from you to decide" - typically clarifying scope, business impact, or whether this is a configuration issue Dale can fix locally. | Not yet evaluated; gates have not run. |
| `upstream` + `acknowledgement="required"` | already made | "I have decided this should leave the install - do you authorize sending a sanitized pseudonymous report?" | Already evaluated; the gates in Section 6.6 either passed or surfaced a recoverable concern that the operator must consciously override. |

Treat the two as ordered: a routing pass may return `ask`, gather an answer, and re-enter the decision with that answer in context. It must never short-circuit from `ask` directly to an upstream send without re-running privacy gates.

### 6.5 Contribution Mode Semantics

Current repo truth from `issue-bridge.ts`:

- `fork_only` skips upstream escalation.
- `selective` allows caller-prompted escalation.
- `contribute_all` allows caller auto-escalation per routing policy.

Future contract:

| Mode | Behavior |
| ---- | -------- |
| `contribute_all` | Upstream filing may be automatic for hard failures and insufficient-capacity routing once privacy checks pass. Coworker still reports what it did. |
| `selective` | Upstream filing requires Dale acknowledgement except for narrowly defined hard failures if the platform owner has enabled hard-failure auto-file. |
| `fork_only` | Default is no upstream filing. A critical one-shot exception may be offered only as an explicit PAR-style acknowledgement: "This install is private by default. I can send a pseudonymous project issue for this one platform failure." Store `escalationPolicy="fork_only_exception"` and `escalationAcknowledgedAt`. |

Implementation must extend the bridge API or add a dedicated policy wrapper. Do not pass through the current `fork_only` guard and pretend the issue was filed.

### 6.6 Privacy Envelope

Upstream payloads contain:

- install pseudonym from `getPlatformIdentity()`;
- route class and route path when safe;
- trigger kind;
- severity;
- anonymized error class / first stack line;
- build phase and stable public build id only when safe;
- coworker-synthesized summary;
- local public `reportId`;
- `hive:submitted`, `hive:platform-issue-report`, `severity:*`, and `capacity:*` labels.

Upstream payloads never contain:

- `reportedById`, user email, user name, tenant/customer name, organization name, brand assets, secrets, raw transcript, raw business-specific description, or local machine names.

Privacy gates:

1. Coworker writes a synthesized summary instead of sending Dale's raw note.
2. `redactHostnames()` runs over every outbound string.
3. Secret scan runs on title/body/stack before `postIssue()`.
4. If any gate fails, set status `suppressed` or `awaiting_escalation_ack` with a safe explanation; do not send.

### 6.7 Existing Git Issue Capability Reuse

The upstream work object is a GitHub Issue created through the existing issue bridge. Feedback escalation must not create a second "feedback issue" table, a second GitHub REST client, or an issue-tracker abstraction before the existing path proves insufficient.

Required reuse contract:

1. `PlatformIssueReport` remains the local source record before and after upstream filing.
2. `fileUpstreamFeedback()` is a policy/privacy wrapper around `escalateToUpstreamIssue({ kind: "issue-report", id })`, not a new direct GitHub caller.
3. New labels such as `capacity:*`, new redaction checks, and fork-only exception policy belong in or immediately around `issue-bridge.ts` so backlog, epic, and issue-report escalation stay coherent.
4. Existing `upstreamIssueNumber`, `upstreamIssueUrl`, and `upstreamSyncedAt` remain the local link fields. Add new fields only for feedback-specific acknowledgement, decision reasons, and resolution notification state.
5. The reverse channel observes GitHub Issue state through webhook or polling and projects it back into DPF `Notification`; Dale does not need a GitHub account or GitHub UI to understand the outcome.

## 7. UX Contract

### 7.0 Persona Contract

| Persona | Capability | Challenge | What should feel delightful |
| ------- | ---------- | --------- | --------------------------- |
| Dale, non-technical operator | Can describe the stuck moment in plain language and can approve a clear ask. | Cannot classify severity, pick a tracker, read GitHub state, or distinguish provider setup from a platform bug. | One Feedback action, one reassuring support thread, one plain next step. Internal IDs, categories, contribution policy, and GitHub mechanics stay out of the first interaction. |
| Local admin/operator | Can apply updates, reconnect credentials, inspect admin queues, and approve sharing policy. | Needs evidence and precise action without becoming the default support analyst for every report. | Admin views show state, evidence, privacy/applicability reason, and the next operational control in one scan. |
| Maintainer/project team | Can fix upstream code, review PRs, publish releases, and reconcile markers. | Needs sanitized, deduplicated reports with enough context to act without leaking customer identity. | Issues are pre-packaged with safe summaries, durable DPF markers, coalescing, and reproducible evidence. |
| Coworker/agent | Can gather context, attempt bounded local help, file reports, and route work. | Can over-collect private context or loop without deciding. | The flow gives the agent typed inputs, a stopping rule, and a small number of allowed outcomes. |

### 7.1 Operator-Facing Behavior

Feedback should feel like asking a capable coworker for help, not submitting a form into a void.

**Manual click:**

- Header action can remain compact, but the first panel copy should be plain: "What is stuck?"
- The coworker says it will try to solve locally first.
- Dale is not shown category, severity, contribution mode, or GitHub language up front.
- If upstream is recommended, the coworker explains why in one sentence and asks for acknowledgement when policy requires it.

**Hard failure:**

- The error page says the platform captured the crash.
- Optional textbox remains for "What were you doing?"
- If auto-file policy applies, the page/coworker says a pseudonymous project issue was filed and shows the local status first.

**Upstream work ready or installed:**

- Dale gets a local `Notification` with `deepLink` back to the originating route or report timeline and body text that explains the fix/update in non-technical language.
- "Merged" is not described as "fixed here"; the notification waits for the closure ledger to distinguish ready, update required, applied, and verified.
- The GitHub link is secondary, for traceability.

**Fallback when the coworker shell fails to open:**

- If `open-agent-feedback` dispatch is lost (panel mount race, JS error, the shell is unavailable on the current route, or the support session cannot be created), the `FeedbackForm` fallback panel is the visible UX.
- The fallback panel must show the same opening copy ("I can help with what is stuck on this page...") so Dale's mental model does not shift between the rich and degraded surfaces.
- The fallback must still create a `PlatformIssueReport(status="support_triage")` so the report is not lost; routing decision then runs without an interactive coworker turn and is recorded with `capacityDecisionReasons` noting that the support loop did not run.
- Dale must never see a "panel failed to open" technical error as the primary message. The failure is observed via telemetry, not surfaced as a dead end.

### 7.2 UI Design Requirements

Implementation must follow DPF theme-aware styling:

- No hardcoded hex, `rgba(...)`, or Tailwind gray/red/yellow classes in touched feedback surfaces.
- Use `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`, `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]`, `border-[var(--dpf-border)]`, and `bg-[var(--dpf-accent)]`.
- The fallback form remains functional without the coworker panel, but it is not the healthy-install primary UX.
- Buttons use clear commands and compact icons where the existing icon system is present.
- Mobile/narrow viewport: the support panel must not obscure the error page's recovery controls.

Existing debt to keep clean when touched:

- `FeedbackButton.tsx`, `HeaderFeedbackButton.tsx`, and `FeedbackForm.tsx` now use DPF theme tokens; new states must preserve that.
- `IssueReportPanel.tsx` uses CSS-var tone helpers for severity/status chips; if resolution chips are added, prefer shared tokenized badge helpers rather than new inline palettes.
- `apps/web/components/admin/TokenExpiryBanner.tsx` still uses hardcoded red/yellow classes; not in core scope unless reused for feedback/update notifications.

### 7.3 Accessibility Requirements

The Feedback affordance is a non-negotiable escape hatch. It must work for an operator using a keyboard, a screen reader, voice control, or a touch device. Implementation must:

- **Focus management:** opening the coworker support panel moves focus to the first interactive element inside the panel; closing returns focus to the Feedback trigger. The fallback form follows the same rule.
- **Dismiss:** `Esc` closes the panel without losing the in-progress report; reopening restores the same support session via `supportSessionId`.
- **Live region:** the auto-message and any state transitions (e.g. "filing a pseudonymous project issue") are announced via an `aria-live="polite"` region inside the panel, so a screen-reader user knows what the platform did without polling visually.
- **Trigger labels:** Feedback buttons must have an accessible name independent of icon-only rendering; the header action keeps its compact icon but exposes a descriptive `aria-label`.
- **Color is never the only signal:** severity, scope, and resolution chips must pair color with text or an icon so the visual language is legible without the theme palette.
- **Reduced motion:** any panel transition respects `prefers-reduced-motion`; hard-failure auto-open must not autoplay an animation that delays the captured-crash acknowledgement.
- **Voice path (Phase 6):** STT entry must offer a visible cancel control and a text-equivalent transcript before sending into the support flow.

## 8. Implementation Slices

### Phase 0: Substrate Cleanup and Refactor Allocation

Goal: spend the mandatory first 20 percent on reducing feedback/reporting fragmentation and hardening the substrate already present on this branch before new behavior expands.

Scope:

- Preserve and harden the existing single server writer in `apps/web/lib/quality/platform-issue-reports.ts`.
- Confirm `POST /api/quality/report`, `reportQualityIssue()`, the crash boundary, support mode, and MCP `report_quality_issue` all stay on that writer.
- Keep `PlatformIssueReport` status/source/trigger constants in one module and update exposed schemas in the same slice when values change.
- Preserve support-triage statuses and keep `issue-report-triage` limited to generic `open` reports so it skips `support_triage`, `awaiting_escalation_ack`, `upstream_pending`, and `upstream_filed`.
- Normalize route, user, `threadId`, `taskRunId`, `featureBuildId`, source, and user-agent capture where available.
- Add coalescing fields/behavior only after the existing `supportSessionId` uniqueness path is covered by tests.
- Clean theme-token violations in touched feedback fallback UI.
- Add unit tests proving the old entry points still create equivalent rows.
- Run the existing issue-bridge tests to prove Phase 0 preserves `PlatformIssueReport` to GitHub Issue compatibility, even though Phase 0 does not file upstream.

Acceptance:

- Existing manual feedback, crash feedback, and coworker `report_quality_issue` still create reports.
- The issue-report triage cron still converts generic `open` reports to BIs.
- A `support_triage` report is not converted by the cron.
- Re-opening the same support session returns/reconciles the same report instead of creating duplicates.
- No touched feedback UI contains hardcoded color tokens outside allowed exceptions.
- Existing issue-bridge tests still pass for `kind: "issue-report"` escalation.

### Phase 1: Support-Mode Entry

Goal: Feedback click opens the existing coworker shell in support mode with context.

Scope:

- Preserve the existing typed `FeedbackEventDetail` and `supportSessionId` validator.
- Verify `HeaderFeedbackButton` and `FeedbackButton` pass normalized route, trigger kind, support session, and fallback policy.
- Refine support auto-message/welcome copy so Dale understands local-first help before any escalation language appears.
- Attach active build/thread context when route is `/build` and a build is active.
- Create local `PlatformIssueReport(status="support_triage")` at support start or first meaningful user message.

Acceptance:

- Dale clicks Feedback on `/build`; the coworker opens with support copy and no category form.
- If the shell is unavailable, fallback form still posts.
- Created report has `routeContext`, `triggerKind`, `threadId` when available, and status `support_triage`.

### Phase 2: Local Resolution and Routing Decision

Goal: support mode makes a bounded local attempt, records a routing decision, and seeds the expected closure path.

Scope:

- Implement pure `assessFeedbackRouting()`.
- Add fixtures for Build Studio provider-gate, repeated phase failure, grant-denied, runtime crash, and explicit Dale escape.
- Use `loadBuildStudioCapability()` for Build Studio provider-capability checks.
- Record `capacityDecision`, `capacityDecisionReasons`, `supportSummary`, `scope`, `expectedClosurePath`, and privacy/applicability seeds.
- Avoid upstream calls in this phase; it only decides and records.

Acceptance:

- Unit tests cover every decision branch.
- Live portal support scenario: answerable local question resolves locally and sets `resolved_locally`.
- Local-BI scenario sets `triaged_local` and creates/links backlog through the existing backlog path.
- Every non-local decision has an explicit expected closure path before bridge wiring begins.

### Phase 2a: Resolution Closure Ledger

Goal: create the closure substrate before any upstream issue is filed.

Scope:

- Add `PlatformIssueResolution`, `PlatformIssueResolutionReport`, `PlatformIssueResolutionArtifact`, install-state projection, and notification-idempotency support as defined in the closure contract.
- Link each support-triage report to an active resolution when `assessFeedbackRouting()` picks a path.
- Store privacy/applicability seeds and the first artifact (`platform_issue_report`, `backlog_item`, or `local_answer`) before filing upstream.
- Add typed constants for resolution status, scope, artifact kind, install applicability, availability, and application state.

Acceptance:

- One resolution can group duplicate reports without losing the original reporter.
- One report can point to a superseded resolution and the active replacement.
- A local answer can notify Dale without GitHub, PR, or release artifacts.
- Bridge tests prove upstream filing refuses to proceed when no resolution exists.

### Phase 3: Upstream Bridge Wiring

Goal: upstream-worthy feedback files a safe GitHub Issue and updates the local row.

Scope:

- Add `fileUpstreamFeedback()` coworker tool or server action.
- Implement it as a wrapper around `escalateToUpstreamIssue({ kind: "issue-report" })`; do not add a direct GitHub Issue writer.
- Require an active `PlatformIssueResolution` and append a `github_issue` artifact around the bridge call.
- Extend bridge policy for `fork_only_exception` only if ratified.
- Add `capacity:*` labels.
- Add required `DPF-Resolution` / `DPF-Reports` markers to the safe issue body.
- Add privacy/secret scan gate before `postIssue()`.
- Make bridge idempotent on existing `upstreamIssueNumber`.
- Keep bridge changes compatible with backlog and epic escalation; shared labels/redaction helpers should live in `issue-bridge.ts` or adjacent bridge-owned modules.

Acceptance:

- `selective` mode asks before filing.
- `contribute_all` mode can auto-file hard failures after privacy checks.
- `fork_only` mode cannot file silently; explicit acknowledgement is stored.
- Upstream issue URL/number are persisted on the report.
- Resolution artifact ledger contains the upstream issue marker, URL, and privacy decision.

### Phase 4: Implicit Triggers

Goal: hard failures and structural blockers feed the same support/escalation path.

Scope:

- Crash boundary dispatches a hard-failure event after local report capture.
- MCP insufficient-scope/grant-denied paths can raise a typed event or create a support report.
- Build Studio structural-verification failures can create a support report linked to `featureBuildId`/`taskRunId`.

Acceptance:

- Runtime crash creates local report, opens/queues support path, and does not require Dale to choose a category.
- Grant-denied scenario distinguishes local admin action from upstream product gap.
- Structural-verification failure links to the originating build/run.

### Phase 5: Reverse Channel and Notifications

Goal: upstream closure becomes a local operator-facing update only after release/update/apply state is known.

Scope:

- Prefer webhook where install reachability and auth are configured.
- Add scheduled polling fallback for installs without inbound reachability.
- On upstream issue/PR closure, append artifacts and move resolution toward `fix_merged`; do not call this installed.
- Reconcile `ProductVersion`, release manifests, `PlatformDevConfig.updatePending`, `ChangePromotion`, and `SelfUpgradeRun` before moving to `fix_available`, `update_required`, `applied_here`, or `verified_here`.
- Create user `Notification` for `reportedById` with route `deepLink`.
- Use `PlatformNotification` only for admin/global feedback health.

Acceptance:

- Closing a test GitHub Issue or PR records an artifact but does not over-notify Dale as fixed until availability/apply evidence exists.
- Notification opens the original route or a local report detail page.
- No duplicate notification is created on repeated webhook/poll.

### Phase 6: Voice STT Hook

Goal: Dale can speak the feedback.

Scope:

- Reuse the existing STT surface only after it is functionally verified on the live install.
- Voice text enters the same support-mode path.

Acceptance:

- Dale clicks Feedback, speaks the problem, sees transcript, and support routing continues normally.

## 9. Verification Gates

Structural tests are necessary but not sufficient.

| Phase | Required tests | Required live UX verification |
| ----- | -------------- | ----------------------------- |
| 0 | Writer unit tests, cron skip tests, UI token audit for touched files | Manual feedback, crash feedback, and MCP/coworker report all create rows. |
| 1 | Event payload and shell auto-message tests | Click Feedback on `/build` and a non-build route; verify coworker support mode and fallback. |
| 2 | Pure routing matrix tests | Dale local-help scenario resolves without upstream; architectural Build Studio scenario recommends upstream/local BI correctly. |
| 2a | Resolution ledger, report join, artifact, notification-idempotency, and install-state tests | Open a report timeline/detail and verify it shows report received, current path, and no tracker internals. |
| 3 | Bridge policy, idempotency, marker, artifact, and privacy scan tests | File to a test repo or dry-run GitHub adapter; verify upstream fields and resolution artifacts persisted. |
| 4 | Trigger-specific tests | Drive crash boundary and grant-denied scenario on live portal. |
| 5 | Webhook/poll/release/apply idempotency tests | Close test issue/PR, publish or simulate fixed version, apply locally, then observe precise DPF `Notification` in the UI. |
| 6 | STT route/unit tests | Speak or simulate audio through live install; transcript enters support flow. |

Build gates for implementation:

- `pnpm --filter web exec vitest run` for affected tests.
- `pnpm --filter web typecheck`.
- `cd apps/web && pnpm exec next build`.
- Live Docker-served UX verification for any UI path.
- Prisma migration applies cleanly if schema changes land.

## 10. Open Decisions

1. **Fork-only exceptional escalation:** approve or reject the one-shot critical upstream path. Recommendation: approve only with explicit acknowledgement, privacy gate evidence, and audit fields implemented as an explicit extension of the existing issue bridge.
2. **GitHub webhook vs polling priority:** implement polling first if install reachability is unreliable; add webhook as the preferred path when platform reachability is configured.
3. **Report detail UX:** decide whether Dale's deep link returns to the originating route with a small update tray, or a dedicated local report detail page. Recommendation: start with a lightweight local report timeline route for notification deep links, then embed the same timeline in the support drawer/originating route when that lowers friction.
4. **GearInterface emission:** do not add GearInterface writes in the first implementation slice. After Phase 3, consider dual-emitting feedback escalation as a ring-boundary observation if the Reduction Gear Phase 0 writer service is already available.
5. **Admin issue-report page ownership:** if this flow grows beyond Dale/Build Studio, file a separate UI-hardening BI for Admin issue reports instead of mixing admin queue redesign into support-mode delivery.

## 11. Failure Modes

These complement the closure contract's Section 14. They focus on the path from click to routed report; the closure contract's table covers the path from routed report to verified-here.

| Failure mode | Required behavior |
| ------------ | ----------------- |
| Coworker shell fails to open / panel mount race | Render the `FeedbackForm` fallback with the same opening copy. Still create `PlatformIssueReport(status="support_triage")`. Record `capacityDecisionReasons` indicating support loop did not run. Never expose the technical failure to Dale as the primary message. |
| `createPlatformIssueReport()` write fails | Buffer the typed event detail in client state (sessionStorage) so a retry preserves the report. Surface "We could not save this yet - try again" with a single retry CTA, not a stack trace. |
| Support-mode loop exceeds bounded turn limit | Stop, mark `capacityDecision="ask"` with the reason "support loop did not converge", and return Dale to an explicit acknowledgement: "I am not getting closer to fixing this here - should I package a pseudonymous project issue?" |
| Privacy/secret scan blocks an upstream send | Status moves to `awaiting_escalation_ack` with the reason surfaced as a sanitized summary the operator can review. Do not stash the unsanitized blob in the resolution ledger; only the scanner's classification and the offending kind. |
| `fork_only` install asks for upstream filing | Default is no send. Offer the one-shot exception only with explicit PAR acknowledgement, store `escalationPolicy="fork_only_exception"` and `escalationAcknowledgedAt`, and audit the decision. |
| `issue-bridge` GitHub auth missing/expired | Status moves to `awaiting_escalation_ack` with the reason "upstream credentials need attention" and surfaces an admin notification. Do not silently retry. |
| Coalesce-key collision across distinct underlying failures | The bucket window is short (10min); on first sign of cross-incident merging, the service falls back to creating a new row and logs the suspected collision. Better to over-report than to silently merge two different bugs. |
| Hard-failure trigger arrives while the install is offline / DB unreachable | Persist the typed event detail to the crash log so a recovery run can replay it after the install returns. Do not show Dale "feedback failed"; the crash page is already the primary surface. |
| Concurrent support sessions for the same `(reportedById, supportSessionId)` | The unique constraint is the guardrail; the second writer reconciles to the existing row. UI must not present "duplicate report"; the operator sees one continuous thread. |

## 12. Observability And Metrics

The platform must be able to answer "is Feedback working?" without reading individual reports. Each phase contributes the following signals:

| Signal | Definition | Where it lives |
| ------ | ---------- | -------------- |
| Click-to-coworker-open latency | Time from `open-agent-feedback` dispatch to the support auto-message rendering. | Client telemetry, breakdown by `triggerKind`. |
| Local resolution rate | Fraction of reports terminating in `resolved_locally` within one support session. | Server, breakdown by `triggerKind` and route class. |
| Time-to-routing-decision | Time from report creation to `capacityDecision` being set. | Server. |
| Upstream filing success rate | Fraction of `awaiting_escalation_ack` / `contribute_all` reports that reach `upstream_filed` without a privacy block. | Server, breakdown by `escalationPolicy`. |
| Privacy-gate block rate | Fraction of upstream-bound reports stopped by `redactHostnames()` / secret scan / acknowledgement gate. | Server. A rising rate means either drafting is leaky or the gates are over-aggressive. |
| Fallback-form usage | Fraction of reports created via the fallback rather than the coworker panel. | Client. A rising rate signals a regression in the shell/event path. |
| Notification-to-acknowledge latency | Time from local `Notification` create to `read` for feedback closure notifications. | Server. Feeds the closure contract's evidence that operators actually see closure. |

These are signals, not SLOs. SLO targets should be set after one quarter of baseline data on a live install; pre-committing thresholds before the substrate ships is premature.

## 13. Connections to Adjacent Work

- **Dale persona:** `docs/personas/dale-hvac.md` and `docs/dogfood/2026-05-23-dale-hvac-build-studio.md` are the primary verification scenario sources.
- **AI Capacity Continuity:** this design handles an immediate capacity-exceeded feedback path. It should not become a second capacity scheduler.
- **Reduction Gear:** feedback escalation can later become a GearInterface observation at the operator-to-platform boundary, but this spec's first job is to clean and route issue reports.
- **Vertical Workspace Home:** vertical homes should expose the same Feedback affordance, but this spec owns behavior after the click.
- **Quality feedback:** this spec extends the existing three-path quality feedback model; it does not replace crash-boundary or offline queue resilience.

## 14. Next Step After Sign-Off

Do not implement feature code directly from this design. After the 2026-05-26 review update:

1. Use `BI-FBDC0861` as the next Build Studio / implementation handoff item.
2. Feed this spec and the closure contract to `writing-plans` for Phase 2/2a only.
3. Keep Phase 2/2a focused on routing decision plus closure ledger; do not include upstream bridge filing.
4. Plan Phase 3 bridge wiring only after the ledger substrate lands and has evidence.
