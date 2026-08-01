---
title: Build Studio Owner Change Experience
status: approved direction - current-main refresh applied 2026-07-31
date: 2026-06-12
updated: 2026-07-31
owner: platform
specKind: design
relatedSpecs:
  - docs/superpowers/specs/2026-06-22-build-studio-overseer-ux-design.md
  - docs/superpowers/specs/2026-06-23-human-attention-surface-design.md
  - docs/superpowers/specs/2026-06-27-work-management-architecture-design.md
  - docs/superpowers/specs/2026-07-05-build-studio-dual-work-intake-differentiation-design.md
  - docs/superpowers/specs/2026-06-19-unified-build-studio-tracking-all-surfaces-design.md
  - docs/superpowers/specs/2026-06-14-native-mobile-archetype-apps-design.md
  - docs/superpowers/specs/2026-06-05-human-experience-closed-loop-design.md
  - docs/superpowers/specs/2026-04-05-continuous-improvement-flywheel-design.md
canonicalSubstrate:
  - packages/db/prisma/schema.prisma#BusinessBuildBrief
  - packages/db/prisma/schema.prisma#FeatureBuild
  - packages/db/prisma/schema.prisma#WorkCapsule
  - packages/db/prisma/schema.prisma#DecisionInteraction
  - packages/db/prisma/schema.prisma#ExternalEvidenceRecord
  - apps/web/components/build/BuildStudio.tsx
  - apps/web/lib/attention/aggregate.ts
  - apps/mobile
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md
  - docs/founder-kernel/wiki/principles/single-source-of-truth.md
  - docs/founder-kernel/wiki/principles/human-in-the-loop-at-phase-boundaries.md
  - docs/founder-kernel/wiki/principles/governance-approves-evidence-not-provenance.md
  - docs/founder-kernel/wiki/principles/no-hardcoded-colors.md
---

# Build Studio Owner Change Experience

## 0. Refresh Decision

This document supersedes its June 12 draft while preserving the original goal: make governed software change feel natural to a small-business owner. It was refreshed against `origin/main` and the live backlog on July 31, 2026 because the platform changed materially after the first review.

The refreshed decision is **convergence, not another product shell**:

- Ask the owner for the desired **Outcome**.
- Call the tracked delivery object a **Change**.
- Keep **Build Studio** as the product name under Delivery.
- Use Workspace and a coworker as the normal owner entry point.
- Use `/workspace/inbox` as the only cross-platform **Needs You** queue.
- Use `/build` as the owner-readable Change detail for progress, preview, proof, and release.
- Keep `/build/work` and technical disclosure for operators with the relevant authority.
- Do not create `/improvements`, a second inbox, a second evidence ledger, or a new persisted `Improvement` model.

Three kernel consultations support this direction:

| Question | Recommendation | Result |
| --- | --- | --- |
| Owner noun | `outcome-change` | Composite 10.359, margin 5.957, high confidence, no commandment conflict (`DI-DE45EB7841D6`) |
| Route architecture | `workspace-first-build-detail` | Composite 10.439, margin 6.840, high confidence, no commandment conflict (`DI-2D164CC7A6C2`) |
| Needs You source | `decision-interaction-first` | Composite 10.313, margin 3.318, high confidence, no commandment conflict (`DI-A3CBA1CDA98C`) |

The former draft's assertion that `BuildStudioV2` was already a live owner shell was wrong. It loads a real `BusinessBuildBrief`, but the surrounding build, conversation, steps, approvals, sandbox, and actions are demo data or no-ops. It is a prototype to absorb and retire, not a second production path.

## 1. Intended Experience

A small-business owner should be able to say:

> Make quotes easier to send from a phone.

The platform should then:

1. Confirm the business outcome and who is affected.
2. Shape the request into a brief without asking technical questions.
3. Explain the proposed change in plain language.
4. Work in the background with visible, honest progress.
5. Interrupt only when business judgment, authority, or risk requires it.
6. Provide a working preview and a short proof packet.
7. Ask for release approval only when the change is ready.
8. Follow up on whether the business outcome improved.

The interaction grammar borrows the strongest parts of Lovable-style building: conversational intent, a distinct planning step, visible agent activity, visual preview, focused correction, and reversible change. DPF adds the controls a business operator needs: durable evidence, explicit authority, phase-boundary HITL, a canonical attention queue, verified release, rollback, and outcome follow-up.

## 2. Current Platform Audit

### 2.1 Delivered

| Capability | Current evidence | Design consequence |
| --- | --- | --- |
| Outcome-first intake | Default `BuildStudio` presents a business outcome intake and governed start path | Extend this path; do not replace it with a new Improvements home |
| Owner status | `BuildOperatorOverview` and the customer-status projection explain outcome, Now, Next, and Needs You | Keep as the top altitude |
| Progressive disclosure | Process graph, branches, IDs, evidence internals, and operator controls are behind Technical details | Preserve the owner/operator boundary |
| Owner summaries | Solution, change, decision-ledger, work-warrant, and customer-status projections exist | Compose them into one owner proof packet rather than duplicating data |
| Unified tracking | `WorkCapsule` and its timeline join Build Studio, external contributor, runtime, and PR evidence | The Change detail reads this projection |
| Cross-process attention | `/workspace/inbox` projects `AttentionItem` from canonical source adapters | Build Studio must feed this inbox, not create another |
| Native mobile base | `apps/mobile` has install discovery, field/customer surfaces, offline queueing, push, approvals, theming, and release infrastructure | Add the same owner attention projection; do not create a mobile-only Build Studio |
| Improvement substrate | `ImprovementSignal` can link to a backlog item | Outcome follow-up joins the existing HX/flywheel loop |

### 2.2 Partially delivered

| Capability | Current limitation | Required convergence |
| --- | --- | --- |
| Persistent business brief | `BusinessBuildBrief` exists and is editable only through `/build?v=2`; the default route still relies on the legacy `FeatureBuild.brief` presentation | Load and edit the canonical brief in the default Change detail |
| Evidence packet | Evidence and summary components exist, but important summaries are mostly inside Technical details | Add a concise owner proof packet above technical disclosure |
| HITL | Escalations and `DecisionInteraction` residue reach Needs You, while derived Build Studio workflow actions can remain local to `/build` | Persist every owner-required phase gate as a `DecisionInteraction` and reuse the existing attention adapter |
| Mobile attention | Push, notifications, and approvals exist, but not as one first-viewport Today / Needs You experience for Changes | Project the same Attention API and deep links into mobile |
| Outcome follow-up | HX and flywheel substrate exists, but a completed Change does not yet close the business-outcome loop | Schedule a lightweight follow-up and emit an `ImprovementSignal` when evidence warrants it |

### 2.3 Not production capability

`BuildStudioV2` is an exploratory shell. Its default build, conversation, step tracker, approvals, sandbox URL, and actions come from `apps/web/lib/build-studio-demo.ts` or empty handlers. Only the supplied `BusinessBuildBrief` can be real. Production work must not expand this demo path.

## 3. Owner Mental Model

The owner should understand three concepts, not the Build Studio state machine:

| Owner concept | Meaning | Canonical substrate |
| --- | --- | --- |
| Outcome | What should be different for the business | `BusinessBuildBrief.businessOutcome` plus success signals |
| Change | The governed work intended to produce that outcome | `FeatureBuild` joined to its `BacklogItem` and `WorkCapsule` |
| Needs You | A decision only the owner or assigned human can make | `DecisionInteraction` projected to `AttentionItem` |

Owner-facing lifecycle copy is a projection, never a persisted second status machine:

| Engine state | Owner language |
| --- | --- |
| `ideate` | Shaping the change |
| `plan` | Preparing the approach |
| `build` | Making the change |
| `review` | Checking the result |
| `ship` | Ready to go live |
| complete | Live |
| blocked or failed | Needs attention |

Do not use **Improvement** as the durable delivery noun. That word already names evidence and proposals in the continuous-improvement substrate. Archetype-specific copy may describe the business outcome, but it must not rename the canonical object per industry.

## 4. Information Architecture

### 4.1 Canonical surfaces

| Surface | Owner job | Rule |
| --- | --- | --- |
| Workspace / coworker | Describe an outcome, review active work, ask what is happening | Normal front door for a nontechnical owner |
| `/workspace/inbox` | Decide everything that Needs You across the business | One queue, ordered by urgency and risk |
| `/delivery` | See delivery activity across Changes | Portfolio-level delivery overview |
| `/build` | Understand one or more Changes, inspect proof, preview, and release | Owner-readable detail; not a developer-only console |
| `/build/work` | Manage backlog/build operations | Authority-gated operator surface |

### 4.2 Explicitly rejected

- No `/improvements` route.
- No Build Studio-specific Needs You inbox.
- No owner homepage that duplicates Workspace work management.
- No direct mobile route to raw Build Studio internals.
- No requirement that an owner understand branches, worktrees, MCP, containers, CI, schemas, or PR mechanics.

## 5. End-to-End Journey

### 5.1 Ask for an outcome

Intake begins with one multiline field and optional supporting evidence:

> What should be different for your business?

The owner may add a screenshot, customer message, document, or voice note. The platform should derive technical scope later. The initial screen must not ask for work type, repository, architecture, acceptance-test syntax, or implementation approach.

### 5.2 Shape the brief

The coworker converts the request into the existing `BusinessBuildBrief`:

- business outcome;
- affected people and workflow;
- source evidence;
- success signals;
- constraints;
- business interpretation;
- risk profile;
- open questions and confidence;
- hidden technical interpretation.

Ask at most one short clarification at a time, and only when the answer changes scope, business behavior, authority, risk, or success. Present the resulting brief as editable business language before governed execution starts.

### 5.3 Explain the approach

The plan view answers:

- What will change?
- Why should that improve the stated outcome?
- What will stay unchanged?
- What could go wrong?
- What will prove it worked?
- Will the owner need to decide anything later?

Technical artifacts remain accessible to authorized operators, but they are not the default review surface.

### 5.4 Work in the background

During execution, the owner sees:

- a current plain-language step;
- the next expected step;
- recent meaningful activity;
- whether work is healthy, waiting, or blocked;
- an honest progress signal for long-running analysis;
- a pause or stop path where safe.

Do not render synthetic percent-complete values. Progress is milestone-based and evidence-backed.

### 5.5 Ask only when judgment is required

Phase-boundary questions become `DecisionInteraction` rows. The existing `ai-decision` Attention adapter projects them into `/workspace/inbox`; mobile and push consume the same item. The decision card contains:

- situation;
- why it matters;
- recommendation;
- two or three business-language choices;
- consequence of waiting;
- risk and urgency;
- deep link to the relevant Change context.

Choosing an option updates the canonical decision and resumes the workflow. A local `/build` action and an inbox card must resolve the same decision ID and cannot create two decisions.

### 5.6 Preview and correct

Use the shared live preview posture already adopted by Build Studio. The Change detail makes the currently driven preview obvious and supports focused feedback:

- select or identify the affected area;
- describe what should be different;
- attach a screenshot where useful;
- convert the correction into auditable build evidence;
- show whether the correction is queued, in progress, or reflected.

Do not promise per-build isolated preview infrastructure where the platform uses one shared sandbox. The UI must name which Change is driving the preview.

### 5.7 Review proof

Before release, show a compact proof packet:

1. **Requested outcome** - the approved business brief.
2. **What changed** - owner-readable change narrative.
3. **Why it matters** - link to the outcome and affected workflow.
4. **Checks performed** - acceptance, tests, UX, migration, security, and runtime evidence as applicable.
5. **Open risks** - unresolved questions or explicit none.
6. **Release choice** - recommended action, rollback posture, and authority required.

The packet is a projection over canonical evidence. It is not a new evidence table and must not say a check passed unless a corresponding evidence record proves it.

### 5.8 Go live and follow up

Outbound or irreversible release remains an explicit-go decision. After release:

- show the deployed state and recovery point;
- retain the proof packet and decision history;
- schedule the agreed outcome check;
- record the observation through the product-outcome/HX substrate;
- emit or touch an `ImprovementSignal` when the observation identifies repeatable friction or unmet value.

## 6. Data And Projection Contract

### 6.1 No new owner-domain table in the convergence release

Use the existing canonical records:

| Concern | Source of truth |
| --- | --- |
| Business intent | `BusinessBuildBrief` |
| Delivery lifecycle | `FeatureBuild` |
| Governed demand | `BacklogItem` and `Epic` |
| Cross-surface work identity | `WorkCapsule` |
| Human decision | `DecisionInteraction` |
| Unified activity/evidence | Work Capsule activity/timeline, runtime verification, Build evidence, `ExternalEvidenceRecord`, PR and release facts |
| Owner attention | `AttentionItem` projection, not persistence |
| Follow-up learning | outcome observation and `ImprovementSignal` |
| Channel policy | `CommunicationChannelBinding` and delivery attempts |
| Device token | `PushDeviceRegistration` only |

### 6.2 Owner Change projection

Implement a pure server-side projection rather than persisted duplicate state:

```ts
type OwnerChangeView = {
  changeId: string;
  title: string;
  outcome: string;
  now: string;
  next: string;
  health: "working" | "waiting" | "needs-you" | "blocked" | "ready" | "live";
  brief: BusinessBuildBrief | null;
  proof: OwnerProofPacket;
  pendingDecisionId: string | null;
  preview: { available: boolean; drivingThisChange: boolean };
  technicalDetailsAvailable: boolean;
};
```

The projection must be deterministic from canonical records and safe to recompute. Missing evidence produces `not recorded` or `not applicable`, never an inferred pass.

### 6.3 Business brief convergence

The default `/build` data loader must resolve the brief associated with the selected `FeatureBuild`, not the most recently edited brief for a user. Add a proper Prisma relation if the schema audit confirms the current string FK still lacks one, then use that relation consistently. The legacy `FeatureBuild.brief` remains a compatibility input only until callers and historical rows are migrated.

### 6.4 Decision convergence

Every owner-required Build Studio workflow gate must create or resolve one `DecisionInteraction` before presentation. Add Build Studio context to that record's supported metadata rather than minting a new table. The existing attention adapter then projects it to web and mobile.

Deduplication key:

```text
(featureBuildId, gateKind, gateVersion)
```

An escalation may describe a blocked decision, but it must not produce a second actionable choice for the same key.

## 7. HITL Policy

### 7.1 Interrupt at boundaries, not during normal execution

Interrupt when one of these is true:

- the owner must choose business behavior;
- legal, financial, privacy, safety, employment, or customer-impact authority is required;
- scope or cost crosses the approved boundary;
- evidence contradicts the approved brief;
- release or another irreversible action needs explicit go;
- execution is blocked and the platform cannot safely resolve it.

Do not interrupt for implementation detail, ordinary recoverable errors, tool selection, or evidence the platform can gather itself.

### 7.2 Channel behavior

The decision source supplies risk, urgency, deadline, and audience. Communication policy chooses ambient inbox, push, or other allowed channel using principal bindings, quiet hours, and verification state. Build Studio never writes directly to a device token.

Push notifications carry summary and deep link only. High-risk decisions require authenticated in-app context; they are never approved directly from an unauthenticated notification action.

### 7.3 Failure states

- If an attention adapter fails, `/workspace/inbox` reports that source as unavailable rather than showing a false empty state.
- If the owner lacks authority, show who can decide and route the item appropriately.
- If a decision is stale or already resolved, deep links show the outcome and current Change state instead of a dead action.
- If mobile is offline, queue only safe local acknowledgements; decisions requiring current server state wait for reconnection.

## 8. Evidence Standard

Owner proof has three altitudes:

| Altitude | Audience | Content |
| --- | --- | --- |
| Summary | Owner | outcome, what changed, checks, open risks, recommendation |
| Inspect | Owner or manager | evidence categories, timestamps, decision history, preview, release state |
| Technical | Authorized operator | commands, files, checksums, logs, worktree, PR, model/tool receipts |

The summary must remain comprehensible without hiding adverse evidence. Technical provenance is available but does not substitute for a clear claim and result.

Evidence states are closed and explicit:

- `passed`
- `failed`
- `not-applicable` with reason
- `not-recorded`
- `stale`

Do not collapse failed, missing, and not-applicable into one neutral badge.

## 9. UI Design Standard

### 9.1 Default Change detail

The first viewport should answer, in order:

1. What outcome are we trying to improve?
2. What is happening now?
3. What happens next?
4. Does anything need me?
5. Can I preview or review proof?

Recommended structure:

```text
Outcome header
Now / Next status
Needs You action, only when present
Preview and proof actions
Recent meaningful activity
Technical details disclosure
```

### 9.2 Interaction rules

- One dominant action per state.
- Business copy before system copy.
- No raw identifiers in owner view.
- No phase rail as the primary status explanation.
- No fake chat turns or demo approvals in production routes.
- Long-running work exposes current milestone and recent activity.
- Use DPF theme tokens only.
- Use report-kit primitives for proof statuses, evidence lists, filters, and exports.
- Meet WCAG 2.2 AA, semantic HTML, keyboard access, and reduced-motion expectations.
- Design mobile decisions for a 44px minimum target and one-handed scanning.

### 9.3 Empty states

| State | Required behavior |
| --- | --- |
| No Changes | Ask what should be different and offer coworker-guided intake |
| No Needs You items | Say the platform is continuing; do not show a celebratory dead end |
| No proof yet | Explain which stage will produce proof |
| Preview unavailable | Explain whether work is not ready, another Change is driving the sandbox, or the environment is unhealthy |
| Permission denied | Explain the owner-visible status and who can perform the restricted action |

## 10. Research And Benchmarking

Research was refreshed from official product documentation on July 31, 2026.

### 10.1 Commercial patterns

| Product | Pattern | DPF decision |
| --- | --- | --- |
| Lovable | Separate Plan and Agent modes; visible current tasks, files, tools, queue, pause/stop, diffs, browser verification, visual edits, and preview-before-build design directions | Adopt the plan/build grammar, visible milestones, focused correction, and preview. Add governed evidence and authority rather than copying direct-project mutation as the trust model. Sources: `https://docs.lovable.dev/features/agent-mode`, `https://docs.lovable.dev/features/design-guidance`, `https://docs.lovable.dev/features/code-mode` |
| Replit Agent | Automatic checkpoints, full-state rollback, visible history, preview, testing, and user correction | Adopt explicit recovery posture and checkpoint-like release evidence. DPF recovery remains governed through branches, PRs, runtime verification, recovery points, and self-upgrade. Sources: `https://docs.replit.com/references/version-control/checkpoints-and-rollbacks`, `https://docs.replit.com/learn/build-with-agent` |
| GitHub | Reviewable diffs, automated checks, approvals, and protected merge conditions | Keep PR/check evidence as technical provenance while translating it into an owner proof packet. Sources: `https://docs.github.com/en/pull-requests/get-started/about-pull-requests`, `https://docs.github.com/en/pull-requests/reference/managing-and-standardizing-pull-requests` |

### 10.2 Open-source and internal patterns

- Git and pull-request workflows provide durable history, review boundaries, and rollback primitives.
- DPF's `WorkCapsule` timeline provides the cross-executor identity missing from a prompt-only builder.
- DPF's Attention Surface provides one deduplicated human queue rather than per-agent notification silos.
- The native mobile app already proves shared install discovery, channel policy, offline behavior, and archetype-driven surfaces.

### 10.3 Adopted

- Natural-language outcome intake.
- Plan before mutation for nontrivial work.
- Visible execution milestones and queued corrections.
- Visual preview and focused feedback.
- Reversible checkpoints and clear release boundaries.
- Progressive disclosure of code and infrastructure.

### 10.4 Rejected

- Prompt history as the only durable specification.
- A preview that is treated as verification.
- Direct publish without authority and evidence gates.
- A separate project shell for every workflow or archetype.
- A second inbox or evidence ledger owned by Build Studio.
- Demo content on a production route.

### 10.5 DPF differentiation

The target experience is not merely easier code generation. It is **governed outcome delivery**: a nontechnical owner can request, understand, decide, verify, release, and later evaluate a Change without becoming the project manager or software engineer.

## 11. Refactoring And Convergence

Refactoring is part of the product work, not cleanup after it.

1. Move the persistent `BusinessBriefPanel` capability into the production `BuildStudio` composition.
2. Resolve briefs by selected Change, not by latest user brief.
3. Extract the owner Change projection so web, inbox deep links, and mobile consume the same language and state mapping.
4. Move owner proof summaries above Technical details while retaining technical receipts below.
5. Persist owner-required workflow actions as `DecisionInteraction` and remove duplicate local action identity.
6. Remove the `?v=2` route branch, demo-only shell, and dead action handlers after parity tests pass.
7. Keep `build-studio-demo.ts` only if another explicit Storybook/test fixture owner remains; otherwise delete it.

The production `BuildStudio` is the convergence target because it owns real lifecycle actions, customer-status projection, unified evidence, preview posture, and authority gates. Styling from the prototype may be reused selectively, but the prototype is not the architectural base.

## 12. Delivery Slices

### Slice A - Canonical brief and owner projection

- Load the selected Change's `BusinessBuildBrief` in default `/build`.
- Port editable business-brief behavior into production composition.
- Add the pure `OwnerChangeView` projection and tests.
- Keep legacy brief conversion for historical data, with a measured retirement path.
- Move outcome, status, and concise proof into the owner altitude.

### Slice B - DecisionInteraction-first Needs You

- Inventory every owner-required Build Studio workflow gate.
- Persist or resolve one `DecisionInteraction` per deduplication key.
- Reuse the existing `ai-decision` Attention adapter and owner decision projection.
- Add Change deep links, stale/resolved behavior, authority checks, and duplicate suppression.
- Verify that acting from `/build` or `/workspace/inbox` resolves the same decision.

### Slice C - Retire the prototype path

- Remove `?v=2` routing.
- Remove or relocate demo data and no-op handlers.
- Preserve any visual patterns that pass the current theme, accessibility, and mobile standards.
- Add a regression test proving production routes cannot render demo build or approval content.

### Slice D - Mobile Today / Needs You

- Add an owner first-viewport projection over the same Attention API.
- Render Change decisions with situation, recommendation, consequence, risk, and deep link.
- Respect channel bindings, quiet hours, multi-space identity, offline policy, and current auth state.
- Require authenticated in-app review for high-risk choices.

### Slice E - Outcome follow-up

- Schedule an outcome check from the approved success signals.
- Record observations through the existing product-outcome/HX contract.
- Link unmet or repeatable findings to `ImprovementSignal` and the existing flywheel.
- Keep this slice dependent on the HX loop rather than reimplementing analytics in Build Studio.

## 13. Acceptance Criteria

The design is delivered only when all of the following are proven on the canonical runtime or shared convergence sandbox:

1. An owner can start a Change from a plain-language outcome without supplying technical fields.
2. The selected Change shows and edits its own persistent `BusinessBuildBrief`; switching Changes cannot display another brief.
3. The first viewport explains outcome, Now, Next, Needs You, preview, and proof without internal IDs or engineering vocabulary.
4. Long-running work exposes honest milestone/activity progress and never fabricates percent complete.
5. Every owner-required Build Studio gate has one canonical `DecisionInteraction` and at most one actionable Needs You card.
6. The same decision can be opened from `/build`, `/workspace/inbox`, and mobile, subject to authority and authentication.
7. Resolving a decision on one surface removes or updates it on the others.
8. The proof packet distinguishes passed, failed, not applicable, not recorded, and stale evidence.
9. Release remains explicit-go and shows recovery posture before execution.
10. Technical details remain available to authorized operators but are not required for owner comprehension.
11. `/build?v=2` no longer selects a demo shell, and no production route renders demo build, conversation, step, approval, or sandbox data.
12. Mobile respects channel policy, quiet hours, offline behavior, multi-space scope, and high-risk authenticated review.
13. A completed Change can schedule and record an outcome follow-up without creating a second improvement ledger.
14. Targeted unit tests, web typecheck, production build, mobile tests when affected, accessibility checks, and UX verification pass.
15. UI evidence includes desktop and mobile screenshots of intake, working, Needs You, proof, permission, empty, and failure states.

## 14. Architecture And UX Fit

**Result: fits with guardrails.**

- **Product area:** Workspace for owner intake and attention; Delivery/Build Studio for Change detail.
- **Route fit:** existing routes only; no new top-level navigation.
- **Persona:** small-business owner first, authorized operator second.
- **Data fit:** projection over existing canonical records; no new owner-domain table in the convergence release.
- **Evidence fit:** Work Capsule and existing evidence records remain authoritative.
- **HITL fit:** phase-boundary `DecisionInteraction` feeding the one Attention Surface.
- **Mobile fit:** downstream projection over the same API and channel policy.

The guardrails are: no demo path expansion, no latest-user brief lookup, no duplicated inbox, no direct device-token routing, no inferred evidence pass, and no release action from an unauthenticated notification.

## 15. Non-Goals

- Replacing the Build Studio execution engine.
- Making owners review source code or PRs.
- Creating a no-code page builder.
- Providing one native app or one workflow per archetype.
- Building a second work-management system.
- Adding a general analytics platform inside Build Studio.
- Treating all Changes as low risk or fully autonomous.
- Removing technical evidence from authorized operators.

## 16. Open Dependencies

- `BI-78499309` covers honest progress for long-running Build Studio work.
- `BI-950FE085` covers intake affordance hardening.
- `BI-62075FF9` covers remaining status-strip technical leakage.
- `BI-8F83933B` covers live capsule/build updates and derived-status reconciliation.
- `BI-3F455757` covers generic proactive human-assist capability.
- `BI-MOBAPP-SCREENS` and the mobile auth/multi-space items govern renderer and identity prerequisites.
- `BI-96812FC2` owns HX loop closure through `ImprovementSignal`, proposals, backlog, and re-measurement.

These dependencies are reused where they own the work. The implementation plan must file only uncovered convergence deliverables and record live backlog coverage before source implementation.

## 17. Next Step

Create the governed convergence plan with one independently reviewable BI per delivery slice. Implement Slice A first because it removes the split source of truth between the real Build Studio and the only persistent brief editor; then implement decision convergence before mobile so every surface consumes one canonical HITL contract.
