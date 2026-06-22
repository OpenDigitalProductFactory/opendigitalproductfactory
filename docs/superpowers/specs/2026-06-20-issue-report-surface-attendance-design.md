# Issue-Report Surface Attendance and Trusted Escalation Routing

| Field | Value |
| ----- | ----- |
| Status | Draft - chief architect review applied 2026-06-20; responder WWMD-consult mechanism + unified decision front door (5.7) + trust dial / autopilot maturation (§14, operator doctrine) completed 2026-06-20. Root-cause prevention (planner kernel-lens, BI-C2CB3073) shipped #2195. Receiving loop (BI-0ACD9AB2) is HITL-first per §14. No responder code yet. |
| Date | 2026-06-20 |
| Trigger | Operator asked: "what process is working `/admin/issue-reports`, and what progress is made daily?" Live investigation found: no human or agent is actively attending the surface. |
| Related epic | `EP-INTAKE-UNIFY`, especially BI-EDFBE081, re-scoped here as provenance and routing convergence. This surface is not a redundant backlog queue. |
| Related substrate | [`PlatformIssueReport`](../../../packages/db/prisma/schema.prisma), [`createPlatformIssueReport`](../../../apps/web/lib/quality/platform-issue-reports.ts), [`ISSUE_REPORT_STATUS`](../../../apps/web/lib/quality/issue-report-status.ts), [`issue-report-triage`](../../../apps/web/lib/operate/issue-report-triage.ts), [`issue-report-triage` cron](../../../apps/web/lib/queue/functions/issue-report-triage.ts), [`IssueReportPanel`](../../../apps/web/components/admin/IssueReportPanel.tsx), [`escalateBuildToHuman`](../../../apps/web/lib/build/escalate-build-to-human.ts), [`route-context-map`](../../../apps/web/lib/tak/route-context-map.ts). |
| Related designs | [Quality feedback](2026-03-14-quality-feedback-design.md), [Capacity-aware feedback escalation](2026-05-24-capacity-aware-feedback-escalation-design.md), [PIR immediate projection](2026-06-06-pir-immediate-projection-design.md), [Work intake unification](2026-06-06-work-intake-unification-design.md), [Multi-agent collaboration visibility](2026-06-04-multi-agent-collaboration-visibility-design.md), [Build Studio reliability](2026-06-19-build-studio-reliability-analysis.md), [Build Studio PR merge resolution](2026-06-19-build-studio-pr-merge-resolution-design.md), [TAK](../../architecture/trusted-ai-kernel.md), [GAID](../../architecture/GAID.md), [DPF TAK/GAID conformance](../../architecture/agent-standards-dpf-conformance.md). |

---

## 0. Architect Verdict

Keep the core insight: `/admin/issue-reports` is not a queue that Mark, support, or an admin should manually drain. It is the platform's signal receiving plane: runtime faults, feedback/support reports, automated observations, and "the machine could not safely continue" escalations land here first.

The current draft was right to separate the streams, but it was not yet a trusted-agent design. It named "push to a responder" without specifying the responder identity, authority boundary, SLA, trace context, receipt/evidence shape, UI contract, loop-closure rule, or failure modes. That is dangerous: it would likely create a second unattended agent loop, only with better words.

This design strengthens the surface around four hard rules:

1. **Classify before projecting.** A report is not automatically work. Stream policy decides whether it becomes a digest, runtime evidence, support flow, local backlog work, upstream feedback, partner/reseller support, or a human decision card.
2. **Escalations must be received by an active responder.** "Acknowledged" only means a signal was claimed. It is not closed until a build resumes, is explicitly killed/deferred, becomes a tracked work item, routes to upstream/partner support, or reaches a human with an actionable decision packet.
3. **TAK/GAID evidence is part of the product contract.** Each consequential escalation response needs identity, authority class, trace context, parent linkage, and an auditable outcome. V1 can be GAID-Private and hash/timestamp backed; it must still be shaped like a receipt.
4. **The UI is an attention lens, not a new operations dashboard.** Operators see what needs attention and why; they do not sort through 700 rows, resolve log signatures by hand, or choose which agent should continue a stalled build.
5. **Consult the governed scopes before escalating to a human.** A `needs-human` verdict is the last resort, not the reflex. The responder first routes each blocker through WWMD / WWWD / WSID; only the residue the scopes genuinely cannot resolve reaches a person. This is the same gate that belongs in front of every agent-to-human decision point on the platform (see 5.7), and it is why the fix matters beyond this one page.

Recommended scope: implement this as a routing and attendance layer over the existing `PlatformIssueReport` substrate, not a new issue tracker. Spend roughly 80% of the slice on behavior and 20% on convergence/refactoring: shared stream classifier, report status helpers, origin/provenance helpers, and tests that prevent future local create/projection drift.

---

## 1. Live Finding (2026-06-20)

`/admin/issue-reports` carries 743 `PlatformIssueReport` rows. The only live process is an automated triage path that projects generic `open` reports into backlog items. The important measured facts:

- **0 reports have ever been human-dispositioned** as suppressed or resolved across all 743 rows.
- **80% of reports are system-generated** with no human reporter.
- The auto-created backlog items pile up: 407 `BI-PIR-*` items open, oldest 2026-04-21; only 14 done and 14 deferred.
- **19 Build Studio "needs a human" escalations**, all high severity and all created today, sit unanswered. They are linked to a WWMD subsystem build that decomposed into many tasks, abandoned at ideate/plan, and raised `needs-human` correctly.

Diagnosis: the sender side of `recursive-self-fix-limits` now exists. The receiving side does not. The platform can raise its hand, but the hand lands on an unattended surface and is then drowned in automated noise.

The even more precise defect: `escalateBuildToHuman()` currently creates an ordinary `open` `PlatformIssueReport`. The immediate projection event and 15-minute safety-net cron can treat that as generic bug evidence, creating or touching a backlog item and marking the report as locally triaged. That is not attendance. It is evidence conversion without a responder.

---

## 2. Research and Benchmarking

### 2.1 Internal Precedent

| Precedent | Adopt | Issue for this design |
| --------- | ----- | --------------------- |
| [Quality feedback](2026-03-14-quality-feedback-design.md) | `PlatformIssueReport` is the single issue-report record; triage bridge closes the original "stored but not surfaced" loop. | Its later auto-triage pattern assumes `open` reports are generic bug evidence. Stream 3 violates that assumption. |
| [PIR immediate projection](2026-06-06-pir-immediate-projection-design.md) | Event-driven projection beats waiting for the cron; the cron stays as safety net and spike detector. | Projection is only correct after stream classification. Immediate generic projection is wrong for `build-stall-escalation` / `selfFixClass`. |
| [Work intake unification](2026-06-06-work-intake-unification-design.md) | Backlog is the work SSoT; origin surfaces keep evidence and provenance. Route PIR backlog creation through `ingestBacklogItem` for standard `intake_origin` activity. | Do not fold `/admin/issue-reports` away. Its support/escalation lifecycle is legitimate evidence and routing state. |
| [Capacity-aware feedback escalation](2026-05-24-capacity-aware-feedback-escalation-design.md) | `SUPPORT_FLOW_STATUSES` are deliberately skipped by generic BI projection; local support, upstream feedback, and closure ledger are separate from raw report status. | Stream 3 should use a support/escalation status before the generic cron can consume it. |
| [Build Studio reliability](2026-06-19-build-studio-reliability-analysis.md) | `selfFixClass` is the right feasibility discriminator: `auto-recoverable`, `needs-human`, `needs-external-capability`. | The design must route by self-fix class, not only severity. |
| [Build Studio PR merge resolution](2026-06-19-build-studio-pr-merge-resolution-design.md) | Non-technical users must never be asked to resolve low-level system conflicts; AI should resolve, then escalate only after bounded attempts. | A "needs-human" report must contain attempted fixes, blocker summary, and the exact decision residue. |
| [Multi-agent collaboration visibility](2026-06-04-multi-agent-collaboration-visibility-design.md) | Agent work needs trace context, authorization class, parent receipt, request/result hashes, and GAID-Private posture first. | The escalation responder is a consequential agent flow and must use the same receipt shape. |

### 2.2 External Standards and Product Precedent

| Source | Pattern to adopt | Design implication |
| ------ | ---------------- | ------------------ |
| [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework) and [AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/) | AI risk is managed through Govern, Map, Measure, Manage; trustworthiness is designed into lifecycle and evaluation, not asserted after the fact. | The surface needs metrics, policy, routing, and evaluation evidence, not just a nicer table. |
| [NIST NCCoE Software and AI Agent Identity and Authorization](https://www.nccoe.nist.gov/projects/software-and-ai-agent-identity-and-authorization) | AI agents taking actions need standards-based identity, authorization, and logging. | The responder must be a distinct agent/principal with scoped authority and audit, not an anonymous cron. |
| [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) | Agentic apps need explicit threat-aware controls for systems that plan, act, and make decisions across workflows. | Add threat/failure coverage: confused deputy, runaway self-repair, prompt injection in escalation packets, alert fatigue, false suppression. |
| [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices) and [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) | Scope minimization, audience-bound tokens, retry limits, and no token passthrough are core controls. | Escalation tools must require minimal grants, track scope-upgrade attempts, and stop rather than bypass authorization. |
| [A2A protocol](https://github.com/a2aproject/A2A) | Agents discover capabilities, collaborate on long-running tasks, and operate without exposing internal state/tools. | The responder can be modeled as a task/capability recipient; expose task state and artifacts, not internal prompts. |
| [W3C Trace Context](https://www.w3.org/TR/trace-context/) and [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/) | Trace context lets distributed signals be correlated across process boundaries. | Every escalation response should carry a trace id from report -> responder task -> tool calls -> build outcome. |

---

## 3. Purpose and Non-Goals

### Purpose

`/admin/issue-reports` is the platform's runtime signal and escalation receiving plane. It answers:

- What did the platform observe?
- Which stream does the signal belong to?
- Who or what is actively attending it?
- What is the SLA and current age?
- What evidence, trace, receipt, or backlog item is linked?
- What closed the loop?

### Non-goals

- Do not ask a human to manually drain system-generated rows.
- Do not create a second backlog, ticket tracker, or Build Studio queue.
- Do not bulk-backfill deduped/noise reports into new BIs.
- Do not hide runtime fault evidence merely because it is noisy.
- Do not let an autonomous responder widen its own authority or continue unbounded retry loops.
- Do not expose raw prompts, stack traces with secrets, hostnames, or internal topology in receipts or upstream reports.

---

## 4. The Three Primary Streams

| # | Stream | Examples | Current handling | Target handling | Closure rule |
| - | ------ | -------- | ---------------- | --------------- | ------------ |
| 1 | **Automated noise and low-value operational chatter** | `warmup`, recurring `log-signature-scanner`, known non-actionable signatures | Filed as individual reports, sometimes projected to BIs | Suppress or aggregate into a digest; only spikes or new actionable signatures create one BI | Digest emitted, suppression reason stored, spike threshold evaluated |
| 2 | **Runtime fault evidence** | `crash_boundary`, `agentic-loop-guard`, `coworker_runtime`, true regression evidence | Projected to `BI-PIR-*` with dedup, crash-boundary special handling | Keep projection, but route creation through the shared backlog front door and attach standard provenance | Linked local BI exists or report is resolved/suppressed with reason |
| 3 | **Self-fix exhausted / needs responder** | `type="build-stall-escalation"`, `selfFixClass="needs-human"` or `needs-external-capability` | Created as `open` PIR, then may be generic-triaged while nobody receives it | Immediately assign an agent responder task, carry SLA, close loop with build/backlog/support outcome | Build resumes, is killed/deferred, routes to human/partner/upstream with decision packet, or produces linked local work |

Support-mode feedback and upstream feedback are adjacent streams. They already use `SUPPORT_FLOW_STATUSES` and should stay in the same state vocabulary, but this design's urgent gap is stream 3 attendance.

---

## 5. Target Architecture

### 5.1 Stream Classifier

Add a small, pure classifier module before any projection or responder dispatch:

```ts
type IssueReportStream =
  | "noise-digest"
  | "runtime-fault"
  | "self-fix-escalation"
  | "support-feedback"
  | "upstream-feedback";
```

Inputs: `type`, `source`, `selfFixClass`, `triggerKind`, `routeContext`, `featureBuildId`, `taskRunId`, `dedupeKey`, `errorDigest`, and current `status`.

Rules:

- `selfFixClass != null` or `type === "build-stall-escalation"` -> `self-fix-escalation`.
- `status` in `SUPPORT_FLOW_STATUSES` -> `support-feedback` or `upstream-feedback`.
- `source === "warmup"` or known `log-signature-scanner` classes -> `noise-digest`, unless spike/new-signature policy says otherwise.
- `source === "crash_boundary"` or `errorDigest != null` -> `runtime-fault`.
- Unknown/high severity -> fail safe to `runtime-fault` with review required, not suppression.

This classifier is a refactor target: both the immediate event handler and the cron must consume it. A future writer must not have to remember which path skips which status.

### 5.2 Stream Routing

| Stream | Writer status on create | Handler | Backlog behavior |
| ------ | ----------------------- | ------- | ---------------- |
| `noise-digest` | `suppressed` with digest metadata, or `open` only until classifier consumes it | Digest aggregator, spike detector | No per-report BI. One spike BI only when threshold triggers. |
| `runtime-fault` | `open` | Existing immediate projection + cron safety net | Create/touch `workType="bug"` BI through `ingestBacklogItem` with `origin={kind:"platformIssueReport", id: reportId}`. |
| `self-fix-escalation` | Prefer `awaiting_escalation_ack` at write time, then `support_triage` when responder task claims it | Escalation responder task | No generic BI. The responder may link/create a BI only if the residue is actual platform work. |
| `support-feedback` | `support_triage` | Coworker support flow | Local answer, local BI, upstream feedback, or human acknowledgement per capacity-routing design. |
| `upstream-feedback` | `upstream_pending` / `upstream_filed` | Existing issue bridge path | Local report remains closure ledger seed; GitHub is external work reference only. |

Critical invariant: **a stream-3 report must never be treated as closed because it was acknowledged or projected.** Generic `open` projection is not the responder.

### 5.3 Escalation Responder Contract

The responder is a governed agent task, not an invisible cron.

**First move - consult the governed scopes, not the human.** Before producing any output, the responder routes each blocking issue through the governed decision scopes (WWMD founder kernel via `principle_decide` / `wiki_query`; WWWD org doctrine; WSID profession). This is the load-bearing step the pipeline is missing today: the reviewer already measures plans against `docs/founder-kernel/wiki/principles/` (`build-reviewers.ts` `ARCHITECTURE_REVIEW_REFERENCES`), but the planner and the `needs-human` boundary carry no kernel lens (`build-agent-prompts.ts` references none). So the reviewer rejects on kernel grounds the planner never consulted, and the build asks a human for guidance the kernel already holds: ~12 of the 19 live escalations are kernel-commandment matters - missing input validation is *never trust input - validate, encode, parameterize*; missing authz is *least privilege, deny by default*; missing failing tests is the repro / TDD doctrine. The responder resolves every governance-class blocker by injecting the kernel's answer as a hard plan requirement and re-planning; only a genuine product / judgment call the scopes do not cover - or a grounding bug they cannot fix (e.g. the ~5 non-existent file paths) - becomes `needs-human-decision`.

Minimum contract:

- **Identity:** one named responder capability, initially a Build Studio operations/incident responder. It resolves to a real `Agent`/`Principal` and appears in Agent Card/AIDoc projections.
- **Authority:** effective permission is computed through TAK: human/operator authority, responder grants, route/task scope, and tool metadata. The agent cannot self-upgrade or bypass MCP scope errors with DB writes.
- **Inputs:** the PIR, linked `FeatureBuild`, linked `TaskRun`, `BuildActivity`, prior review issues, dispatch attempts, relevant logs, and source links. Raw prompt transcripts are read only when policy permits and are never copied into receipts.
- **Outputs:** one of `resume`, `kill-or-defer`, `local-work`, `needs-human-decision`, `needs-external-capability`, `upstream-feedback`, or `suppressed`.
- **Bounds:** max attempt count, wall-clock budget, and no recursive self-fix spawning without a parent receipt and explicit authorization class.
- **SLA:** default P0 for `selfFixClass="needs-human"` and high severity: 15 minutes to claim, 60 minutes to produce a first disposition. Tune later from evidence. The SLA is policy, not founder doctrine.
- **Loop closure:** the responder writes a structured outcome and updates report/build/backlog state. "I looked at it" is not an outcome.

### 5.4 Evidence, Trace, and Receipt Shape

Use GAID-Private posture in V1. No public signing required yet, but shape the record so signing and federation are projection work later.

Each responder action should emit or update an evidence object with:

| Field | Purpose |
| ----- | ------- |
| `traceId`, `spanId`, `parentSpanId` | Correlate report -> responder task -> tools -> build outcome. Align with W3C Trace Context / OpenTelemetry shape. |
| `reportId` | PIR origin. |
| `taskRunId` | Responder task. |
| `featureBuildId` | Build being attended, if present. |
| `actorAgentId` / private `gaid` | Acting responder identity. |
| `principalRef` | Human/organization authority context. |
| `authorizationClass` | `analyze`, `execute`, `delegate`, `approve`, or `escalate`, mapped to local TAK grants. |
| `executionMode` | `immediate` or `proposal`; proposal requires acknowledgement before side effects. |
| `parentReceipt` | Link to the escalation/create receipt or parent build/action receipt where available. |
| `requestHash` / `resultHash` | Digest of the decision packet and outcome artifact. |
| `outcome` | One of the responder outputs above. |
| `evidenceRefs` | ToolExecution ids, BuildActivity ids, BacklogItem ids, log digests, PR/CI links. |

Privacy rule: receipts reference prompt/context packets by digest and authorized evidence refs. They do not copy raw prompts, secrets, hostnames, or unnecessary PII.

### 5.5 State Machine

```text
createPlatformIssueReport()
  |
  v
classify stream
  |
  +-- noise-digest ----------> suppressed/digest -> spike? -> optional one BI
  |
  +-- runtime-fault ---------> open -> project/touch BI -> triaged_local
  |
  +-- support-feedback ------> support_triage -> local/upstream/BI/human residue
  |
  +-- self-fix-escalation ---> awaiting_escalation_ack
                               |
                               v
                            responder claims task
                               |
                               v
                            support_triage
                               |
                               +-- resume build ------------> resolved_locally
                               +-- kill/defer build --------> resolved_locally or triaged_local with linked BI
                               +-- needs human decision ----> awaiting_escalation_ack with decision packet
                               +-- needs external capacity --> upstream_pending or partner-support route
                               +-- not actionable ----------> suppressed with reason
```

`acknowledged` is deliberately absent as a terminal meaning. If current code still writes it, implementation must either map it to an existing status or retire it in favor of the typed vocabulary.

### 5.6 Relationship to the Backlog

The backlog holds work. The issue-report surface holds signals, evidence, and support/escalation routing state.

- Stream 2 creates or touches backlog bug work.
- Stream 3 does **not** create a separate BI merely because the platform needed a responder. The responder may create/link a BI only when there is actual platform work after analysis.
- If an escalation belongs to the originating backlog item, update or annotate that item instead of creating `BI-PIR-*` siblings.
- Route any new PIR-created work through `ingestBacklogItem` so provenance is standard: typed origin where possible, `BacklogItemActivity(kind="intake_origin")`, and temporary compatibility body marker if needed.

### 5.7 The Unified Decision Front Door

This surface and its responder are one instance of a platform-wide pattern - and that pattern is why the fix matters far beyond `/admin/issue-reports`. The backlog front door (`ingestBacklogItem`) is where every detector files WORK so it lands in one tracked place. **WWMD is the front door for DECISIONS** - where an agent routes a choice before escalating it to a human. They are the same queue-elimination move on different cargo:

| Front door | Drains | Rule |
| ---------- | ------ | ---- |
| `ingestBacklogItem` | work queues (improvements, capability needs, issue reports) | every detector files through one path; the backlog is the work SSoT |
| WWMD (`principle_decide` / `wiki_query`) | decision queues (Build Studio `needs-human`, coworker HITL, an agent's `AskUserQuestion` to the operator) | consult the governed scopes before escalating any decision to a human; escalate only the residue |

Build Studio's `needs-human` escalation queue and an agent's question-to-the-operator queue are the same shape - an agent escalating a decision to a human - and both drain through WWMD. The escalation responder in 5.3 is precisely this gate wired in front of the build pipeline; the identical gate belongs in front of every `AskUserQuestion` / HITL surface as a runtime pre-escalation guard. Wiring one gate in front of both surfaces is the leverage: it converts most "ask a human" events into "consult the kernel" events, draining the decision queue before it forms and leaving the operator only the true residue.

This generalizes `do-the-work-dont-task-the-operator`, `decisions-belong-to-their-scope`, and the consult-the-scopes-before-asking-a-human directive into one mechanism, and is a kernel-candidate in its own right. It is also the spine of the companion article this work earns (section 13).

---

## 6. UI and Interaction Contract

`/admin/issue-reports` should become an admin evidence and attention surface. It should not be a large table that asks the operator to interpret platform internals.

### 6.1 Lenses

1. **Attention** - only reports requiring a responder, human acknowledgement, partner/upstream route, or overdue SLA.
2. **Runtime Faults** - crash/runtime evidence with linked backlog item and occurrence count.
3. **Digests** - suppressed/aggregated warmup and log-signature noise, with spike history.
4. **All Evidence** - searchable audit list for admins.

### 6.2 Escalation Card

For stream 3, the row/card must show:

- Build or originating work title.
- `selfFixClass`.
- Current responder status.
- SLA age and first-disposition deadline.
- What was already attempted.
- Linked trace/evidence count.
- Current closure outcome or human-decision packet.

Actions are constrained:

- Open linked build/thread/evidence.
- Acknowledge a proposal when a human decision is truly required.
- Suppress only with required reason.
- Do not expose git, container, model-token, or raw log mechanics to a non-technical user.

### 6.3 Visual/Component Guardrails

- Reuse report-kit primitives (`StatusBadge`, `DataTable`, `FilterBar`, `StatCard`) and platform theme tokens.
- No hardcoded color dialects, local status maps, nested cards, or wide decorative panels.
- Use compact, scan-friendly admin density.
- Mobile: cards may stack, but status, age, and action controls must not wrap into illegible overlaps.
- The issue surface should deep-link to Delivery/Build thread lenses when a build is involved; it must not duplicate the Delivery lifecycle UI.

---

## 7. Possible Issues and Required Mitigations

| Risk | Why it matters | Mitigation |
| ---- | -------------- | ---------- |
| Stream-3 reports remain `open` and are consumed by generic projection | This is the observed defect. It creates BIs without attendance. | Classify before projection; set self-fix escalations to support/escalation status before the cron sees them. |
| Agent responder becomes another unattended loop | The system could recursively fail and raise more noise. | Bounded attempts, parent receipt, responder SLA, no recursive spawn without explicit authorization. |
| Noise suppression hides real incidents | Warmup/log signatures can become real regressions. | Unknown/high severity fails safe to runtime-fault; spike detector still creates one BI; digest keeps counts visible. |
| Backlog bloat continues | 407 open `BI-PIR-*` rows prove projection alone is insufficient. | Do not create per-signature BIs; update occurrences; create/link only actual work after classification. |
| Human is asked to make raw technical decisions | Violates "do the work, don't task the operator." | Responder packages decision residue: options, recommendation, impact, evidence, and safe actions. |
| Authority boundary is vague | A responder that can inspect logs, mutate builds, and file work is consequential. | TAK effective-permission computation, scoped tool grants, proposal mode for side effects, audit every allow/deny. |
| Receipt/evidence is hand-wavy | TAK/GAID trust claim becomes marketing instead of system behavior. | Emit GAID-Private shaped evidence with trace, authorization class, parent linkage, request/result hashes. |
| Existing support statuses are overloaded | `awaiting_escalation_ack` may mean human ack, agent claim, or upstream ack. | Define status semantics in `issue-report-status.ts`; if new states are needed, update constants, schemas, and tests together. |
| Partner/upstream support leaks data | `needs-external-capability` can cross trust boundaries. | Keep V1 local; upstream/partner route requires privacy synthesis, secret scan, pseudonym, explicit consent, and no raw prompt dumps. |
| UI becomes another dashboard | Parallel lifecycle and status surfaces create drift. | Attention/evidence lens only; canonical work remains backlog/Delivery. |

---

## 8. Implementation Slices

### Slice 0 - Immediate Rescue

Handle the 19 stalled `needs-human` Build Studio reports now, without waiting for the new responder implementation:

- Query each linked `FeatureBuild` and originating backlog item.
- Decide whether it can be resumed, should be killed/deferred, or needs a human decision packet.
- Record an evidence note for each report/build.
- Do not bulk close or suppress.

This is an operational cleanup, not proof that the design is implemented.

### Slice 1 - Classifier and Projection Guard

- Add the pure stream classifier.
- Make immediate projection and the cron consume it.
- Ensure `selfFixClass` / `build-stall-escalation` reports bypass generic BI projection and enter support/escalation status.
- Keep runtime-fault projection behavior intact.
- Add tests for all stream rules and cron/immediate-handler parity.

Refactor budget: shared classifier + shared status helpers replace local if/else checks in the writer, event handler, and cron.

### Slice 2 - Responder Task and SLA

- Create/claim one responder `TaskRun` per stream-3 report.
- Link `reportId`, `featureBuildId`, `taskRunId`, trace id, and responder agent id.
- Implement claim/heartbeat/SLA visibility.
- First-disposition outcomes: resume, kill/defer, local-work, needs-human-decision, needs-external-capability, upstream-feedback, suppressed.
- Add hard attempt/time bounds.

### Slice 3 - Evidence and Receipt Projection

- Emit GAID-Private shaped receipt/evidence records for claim, tool use, denied action, proposal, and terminal outcome.
- Map local grants to `authorizationClass`.
- Use trace context across PIR, responder task, ToolExecution, BuildActivity, and backlog evidence.
- Digest decision packets and outcome artifacts instead of storing raw prompts in receipts.

### Slice 4 - UI Attention Lens

- Rework `/admin/issue-reports` into Attention, Runtime Faults, Digests, and All Evidence lenses.
- Add escalation cards with SLA age, responder status, self-fix class, evidence links, and safe action set.
- Keep Delivery/Build lifecycle as the destination for build-specific progress.
- Verify desktop and mobile with browser screenshots.

### Slice 5 - Provenance Convergence

- Route Stream 2 PIR-created backlog work through `ingestBacklogItem`.
- Emit `BacklogItemActivity(kind="intake_origin")`.
- Preserve the existing `Source report: PIR-*` compatibility marker until readers no longer need it.
- Do not backfill deduped historical rows into duplicate BIs.

---

## 9. Acceptance Criteria

- A new `build-stall-escalation` / `selfFixClass="needs-human"` report is **not** projected as a generic `BI-PIR-*` before a responder claims it.
- Every stream-3 report has exactly one active responder task or a terminal outcome.
- The UI shows overdue stream-3 reports in the Attention lens within the SLA window.
- "Acknowledged" is not treated as terminal anywhere.
- Stream-1 warmup/log-signature noise does not create per-signature backlog work; digest and spike logic remain visible.
- Stream-2 crash/runtime reports still project to local bug work with existing dedup behavior.
- Every consequential responder action has trace context and GAID-Private receipt/evidence shape.
- A human decision card contains options, recommendation, consequence summary, and evidence refs; it never asks the operator to inspect raw logs or git conflicts.
- `/admin/issue-reports` uses report-kit/theme primitives and has no overlapping text at desktop or mobile widths.

---

## 10. Verification Gates

| Layer | Gate |
| ----- | ---- |
| Unit | Classifier tests, projection guard tests, responder state tests, receipt-shape tests, existing `issue-report-triage` tests. |
| Typecheck | `pnpm --filter web typecheck` source-local. |
| Build | `pnpm --filter web build` only on canonical local install or shared local-CI convergence sandbox, per AGENTS.md. |
| Functional | Create representative reports for each stream; verify status, projection, responder task, and UI lens behavior. |
| UX | Browser exercise `/admin/issue-reports` desktop/mobile; confirm attention lens, digests, escalation card, no hardcoded visual dialect drift. |
| Data safety | Verify no raw prompt, hostname, secret, or unnecessary PII appears in receipts/upstream-ready payloads. |

---

## 11. Open Decisions

These do not block the design, but they should be resolved before implementation planning:

1. **Responder identity:** use an existing operations/admin coworker, create a Build Studio escalation responder, or route through capability routing once that substrate is ready. Recommendation: start with one named Build Studio operations responder backed by existing incident/admin capabilities.
2. **SLA defaults:** initial proposal is 15 minutes to claim, 60 minutes to first disposition for high `needs-human` self-fix escalations. Tune after two weeks of evidence.
3. **Status vocabulary:** can existing `support_triage` and `awaiting_escalation_ack` express agent claim vs human residue clearly enough, or do we need one new status? Recommendation: prefer existing statuses for Slice 1, add only if tests show ambiguity.
4. **Receipt storage:** V1 can store receipt projection in existing task/evidence metadata if queryable. Add a top-level receipt table only if query-first evidence proves metadata is insufficient.
5. **Noise digest storage:** use existing report rows plus suppressed status and aggregate query first; add a digest table only if the UI/query cost justifies it.

---

## 12. Recommendation

Approve the design direction with the guardrails above. The urgent fix is not a prettier issue-report page and not a new queue. It is a trusted receiving loop:

```text
report -> classify -> route -> active responder or digest/projection -> evidenced closure
```

This aligns with TAK because authority, tool use, escalation, and evidence are mediated at runtime. It aligns with GAID because consequential agent actions are identity-bound, traceable, and receipt-shaped. It aligns with DPF architecture because backlog remains the work SSoT, issue reports remain signal/evidence, and the operator sees the few items that truly need attention rather than the machinery underneath.

---

## 13. Companion Article (after implementation)

Per operator direction (2026-06-20), once implemented this design is the basis for an external write-up. Thesis: a self-building platform must do more than *raise its hand* when it cannot proceed - it must route that escalation through a trusted decision front door before it ever reaches a human. Two queues, one drain: `ingestBacklogItem` for work, WWMD for decisions (5.7). Working title: *"The Trusted Receiving Loop: WWMD as a Decision Front Door."* Draft only after Slices 0-4 are live, so it can cite real before/after evidence: the 19 stalled WWMD builds, the escalation answer rate, and the drop in operator-facing attention volume. The article is a deliverable of this epic, not a side task - it is how the pattern reaches other builders.

---

## 14. Trust Dial and Autopilot Maturation (operator doctrine, 2026-06-20)

This surface is not just an escalation router. The responder (5.3) and the decision front door (5.7) are the first instance of a platform AUTOPILOT with a calibrated trust dial. This section is the operating model for how human involvement *decreases over time without losing oversight* - and it is the load-bearing reason the responder is safe to build.

### 14.1 The dial is the decision's confidence, not a fixed gate

Every governed decision (the responder's, and any coworker's "should I plan vs change directly", "resume vs defer", etc.) runs through WWMD / WWWD / WSID and carries a confidence + margin (`principle_decide`) and an evidenced receipt (5.4). HITL is a *function of that confidence*, not an always-on checkpoint:

- LOW confidence / margin below the tie threshold / commandment conflict / novel context -> HUMAN-IN-THE-LOOP: the decision is *proposed*; the human approves or overrides; the override is recorded as a labeled correction.
- HIGH confidence, repeatedly correct-in-context -> AUTOPILOT: the decision executes and is recorded; the human reviews *after the fact*, not before.

The dial is per decision-class and per scope. Early on it sits low - the scopes are unproven for this context, so the check often does not produce a firm decision and a human weighs in. As evidence accumulates the dial rises and HITL recedes to genuine novelty and high stakes.

### 14.2 Human as reviewer-of-evidence, not approver-of-each

The human interface shifts from "approve every decision" to "review an evidenced record." The operator does not read every plan-vs-direct or resume-vs-defer call. They see an OVERVIEW - counts, decision classes, outcomes, anomalies - and DRILL IN only when something looks off. Because every decision is on record (what was decided, which scope was consulted, the contribution ledger, the evidence refs, the outcome), a drill-in is always possible and an audit is never reconstructed after the fact. "Acknowledged" is never terminal (5.5); "reviewed-with-evidence" is.

### 14.3 The tuning loop - how the scopes actually get better

The recorded decisions and their outcomes are the training signal for the governed scopes themselves:

- A human OVERRIDE of a proposed/autopilot decision is a labeled correction -> refine the WWMD principle / WWWD doctrine / WSID technique (or its dimensionVector / weight) so the next decision in that context is right.
- A decision that went AWRY (caught on drill-in) -> feed the failure signature back into the same scope content.

Over a few improvement cycles, performance and certainty rise, the dial rises, and HITL naturally recedes. This closes - for DECISIONS - the same loop DPF already runs for WORK (backlog -> build -> evidence -> learning): decide -> evidence -> outcome -> tune the scope. It is the maturation engine for WWMD/WWWD/WSID, fed by their own use.

### 14.4 What this means for the build (safe by construction)

The responder is therefore built HITL-FIRST: it ships with the dial low - propose-and-review for any consequential outcome - and earns autonomy per decision-class only as its WWMD/WWWD/WSID calls prove correct, never losing the evidenced record or the operator's ability to drill in. Building it is not deploying an unsupervised agent; it is deploying a governed one whose leash lengthens only as the evidence earns it. The trust dial, the decision record, the overview-with-drill-in, and the tuning loop are first-class acceptance criteria for the responder slices, not later polish.

This model is a kernel-candidate in its own right (graduated autonomy via evidenced decisions); it generalizes `do-the-work-dont-task-the-operator`, `decisions-belong-to-their-scope`, `human-in-the-loop-at-phase-boundaries`, and the consult-the-scopes-before-asking-a-human directive into one maturation mechanism.
