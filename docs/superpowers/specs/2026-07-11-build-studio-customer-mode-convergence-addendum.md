---
title: Build Studio Customer-Mode Convergence Addendum
status: accepted-addendum
date: 2026-07-11
owner: platform
relates:
  - docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md
  - docs/superpowers/specs/2026-06-19-unified-build-studio-tracking-all-surfaces-design.md
  - docs/superpowers/specs/2026-06-22-build-studio-overseer-ux-design.md
  - docs/superpowers/specs/2026-06-22-build-studio-model-tier-routing-design.md
  - docs/superpowers/specs/2026-06-19-build-studio-reliability-design.md
live_backlog:
  - BI-D6FA8641
  - BI-5FDBF786

> **Rescue note (2026-08-16).** Recovered from a branch that was pushed and never proposed as a PR, found in the 2026-08-15 never-proposed-branch sweep. **The design landed here; the implementation did not.**
>
> - Tracked by `BI-3B01B725` (recovered tail designs). Read it before acting on this document.
> - Preserved implementation: `doc/build-studio-customer-mode-convergence` @ `acb1e5a4e34bc899cbbd909952a96fe214ae1f59`, pinned at `refs/salvage/2026-08-15/doc/build-studio-customer-mode-convergence` and listed in `~/dpf-deleted-remote-branch-tips-2026-08-15.txt`. Restore with `git push origin acb1e5a4e34bc899cbbd909952a96fe214ae1f59:refs/heads/doc/build-studio-customer-mode-convergence`.
> - All backlog ids cited below resolve in this install.
> - No coverage receipt is recorded and none should be until a thread actually starts — a receipt bound to unstarted work would be fiction. This document is deliberately outside the plan-backlog-coverage gate (it carries no bolded backlog-item metadata line).

  - BI-A443B9CC
  - BI-BB13B599
---

# Build Studio Customer-Mode Convergence Addendum

## 1. Decision

Build Studio should not split into a second interaction surface for non-developers. The customer-facing experience remains the existing AI coworker paradigm: a business user describes the capability they want, answers business questions, sees a plain-language status, reviews a prototype or screenshot, and approves, revises, or rejects the outcome.

The platform should split only by disclosure level:

| Audience | Default surface | What they see | What stays hidden |
| --- | --- | --- | --- |
| Business user | Build Studio AI coworker / custodian | Intent, status, questions, preview, screenshot, plain change narrative, approval/revision actions | Terminal output, source code, worktree names, MCP payloads, provider logs, raw diffs |
| Power user | External CLI or local agent client plus optional Engineer view | Worktree, skills, MCP tools, raw evidence, branch/PR details | Nothing essential, but still governed by the same capsule and evidence contract |
| Internal automation | Provider runner adapters | API/SDK calls, sandbox or worktree execution, evidence writes | Customer-facing prose unless the status projector emits it |

This means "customer mode" is the default Build Studio experience, not a new route and not an audience toggle the user must understand. "Power mode" is the already-existing Claude Code / Codex / Grok / opencode path plus the optional Engineer view inside Build Studio.

## 2. Success Test

The product passes when a nontechnical spouse-level user can create new platform functionality without reading code or terminal output.

Acceptance at that altitude:

1. The user can state the desired business capability in plain language.
2. Build Studio asks clarifying business questions before doing risky or ambiguous work.
3. Build Studio shows what is being built, why it matters, current status, and what decision is needed next.
4. The user can inspect a live preview, generated screenshot, or product-language summary before approval.
5. The user can say "this is wrong" or "change this" without knowing git, TypeScript, migrations, MCP, or provider-specific terminology.
6. Raw source, shell logs, and detailed evidence remain available to a power user, but never become the only path to success.

## 3. Current State Reviewed

The current implementation already contains meaningful pieces of this target:

- The overseer UX work has begun: plain "what we are building" and decision-ledger surfaces exist, with engineer detail still one disclosure away.
- The Build Studio custodian pattern exists and is the right product metaphor: quiet while things are moving, proactive when stuck, one safest next action.
- Model-tier routing exists in code, including robust-provider plumbing for Claude, Codex, Grok, opencode, and local models.
- WorkCapsule exists as the executor-agnostic unit of work and already models executor kind, lease holder, feature build link, scope claims, and activity.
- The unified evidence timeline has a Phase 1 read surface, but the write model is not yet unified.

The remaining architectural gap is not a new UX shell. It is binding external work to the same WorkCapsule and deriving a customer-readable progress projection from that capsule.

## 4. Provider Integration Contract

Provider tools are implementation adapters behind the WorkCapsule contract. They must not define the user's product experience.

### 4.1 Claude

Claude Code remains valuable as a power-user development surface. For customer-facing automation, DPF should not route third-party user work through Free, Pro, or Max Claude credentials or present Claude.ai login as DPF's backend. Anthropic's Claude Code legal guidance says developers building products or services around Claude capabilities should use API-key authentication through Claude Console or supported cloud providers, and should not route user requests through consumer plan credentials without approval.

Architecture rule: Claude Code local subscription can remain a first-party operator tool; embedded Build Studio automation uses a commercial/API/provider-backed adapter.

Reference: [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).

### 4.2 Codex

Codex should follow the same shape: local Codex can remain a power-user surface, while product integration should use a supported SDK, app-server, MCP, or API path that DPF can own, audit, and gate. OpenAI's Codex SDK is explicitly intended for programmatically controlling local Codex agents and integrating Codex into internal tools and applications. OpenAI also documents a pattern where Codex CLI is exposed as an MCP server for the Agents SDK.

Architecture rule: do not build the customer product around terminal scraping or one-shot noninteractive prompt execution. Use a controlled runner adapter that can keep session state, stream events to the capsule, and record evidence.

References: [Codex SDK](https://developers.openai.com/codex/sdk), [Use Codex with the Agents SDK](https://developers.openai.com/codex/guides/agents-sdk).

### 4.3 Grok

Grok should be treated as another provider adapter, not another Build Studio mode. xAI's developer surface is API-key based and OpenAI-compatible enough for a DPF runner adapter to converge on the same model-tier routing and WorkCapsule evidence contract.

Architecture rule: Grok gets the same WorkCapsule, lease, evidence, model-tier, and customer-status projection contract as Claude and Codex.

Reference: [xAI API](https://x.ai/api).

### 4.4 Computer Use And Terminal Streaming

Computer use and terminal streaming are useful internal control strategies, but they are not the business-user UX. A streamed terminal is acceptable only as an operator/debug disclosure or an implementation bridge while a provider adapter matures. The customer view must render the derived outcome: progress, questions, preview, screenshot, risks, and next action.

## 5. Multi-Agent Pattern Comparison

Microsoft AutoGen and the newer Microsoft Agent Framework validate the distinction DPF should preserve:

- agents can coordinate as teams;
- control can transfer through a handoff pattern;
- the receiving agent needs the context needed to continue;
- orchestration should be explicit enough to inspect and debug.

DPF should adopt the handoff and durable-context pattern, but not expose the agent conversation as the product surface for nontechnical users. The DPF equivalent of AutoGen's shared team context is the WorkCapsule plus its evidence, documents, lease, activity timeline, and status projection. The customer sees the projection, not the transcript.

References: [AutoGen project](https://www.microsoft.com/en-us/research/project/autogen/), [AutoGen handoffs](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/design-patterns/handoffs.html), [Microsoft Agent Framework handoff orchestration](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff).

## 6. Target Architecture

### 6.1 One Work Unit

The WorkCapsule is the universal work unit for Build Studio, Claude Code, Codex, Grok, opencode, internal coworkers, and human operators.

FeatureBuild remains the Build-Studio-specific lifecycle run. A FeatureBuild may attach to a WorkCapsule, but it is not the universal handoff/evidence anchor. This keeps Build Studio rich without making every external agent pretend to be the in-portal orchestrator.

### 6.2 One Customer Projection

Build Studio reads the WorkCapsule and linked FeatureBuild records through a status projector that emits:

- what is being built;
- where the work is in the lifecycle;
- who or what is currently working, translated into business-safe language;
- what has changed and why it matters;
- what evidence exists;
- whether a preview or screenshot is available;
- what question or approval is needed;
- whether the work is blocked, stale, or waiting.

The projector owns the translation from technical events to business-language status. Raw evidence remains available behind Engineer view.

### 6.3 One Evidence Contract

Every runner adapter writes the same categories of governed evidence:

- capsule claim or adoption at work start;
- phase or milestone activity;
- documents and design/build/review artifacts;
- verification output;
- runtime/screenshot/prototype evidence;
- handoff manifest when another agent should continue;
- release or abandonment on exit.

If MCP is down, the adapter may continue local work, but it must reconcile evidence when MCP returns. Local productivity should degrade gracefully; product truth should converge back to MCP.

### 6.4 One Handoff Protocol

Start-by-one and finish-by-another requires a real handoff protocol:

1. Current executor offers handoff with next action, open risks, evidence digest, branch/worktree, and suggested receiving executor.
2. Receiving executor acknowledges and adopts the capsule.
3. Lease holder and executor fields change.
4. An `executor-changed` activity is written.
5. Build Studio renders the change as a plain status event, not as raw agent plumbing.

This is why the new backlog sequence prioritizes WorkCapsule evidence binding, auto-claim/adopt, executor-change, and status projection.

## 7. Refactor Sequence

The implementation should right-size autonomy by risk:

| Phase | Work | Primary backlog | Notes |
| --- | --- | --- | --- |
| 0 | Keep current Build Studio reliability work moving | Existing `EP-BS-UX-HARDENING` items | If the user cannot start, recover, or inspect a build, customer mode fails regardless of architecture. |
| 1 | Bind external evidence to WorkCapsule | `BI-D6FA8641` | Schema and MCP writer change. This is the write-model hinge. |
| 2 | Auto-claim or adopt capsule at external work start | `BI-5FDBF786` | Makes external sessions visible by default without hard-blocking offline work. |
| 3 | Implement cross-agent handoff and executor-change | `BI-A443B9CC` | Delivers Claude-starts/Codex-or-Grok-finishes. |
| 4 | Render customer-mode capsule status projection | `BI-BB13B599` | Turns the unified substrate into the wife-test UX. |
| 5 | Tighten provider adapters and model-tier operations | Existing model-tier/routing specs | Claude, Codex, Grok, opencode all stay behind the same runner contract. |

The order matters. A prettier customer surface before the write model is unified would still be blind to external work. A powerful handoff protocol before auto-claim would remain optional and underused.

## 8. Existing Specs Reconciled

This addendum does not replace the existing designs. It narrows their shared interpretation:

- Unified Delivery Surfaces supplies the doctrine: peer execution surfaces, one governed process, one MCP coordination plane, complexity hidden from lay users.
- Unified Build Studio Tracking supplies the substrate decision: WorkCapsule is the universal unit; FeatureBuild is an attached Build Studio run.
- Overseer UX supplies the business-user altitude: plain solution, plain change, plain decisions, plain next action.
- Model-Tier Routing supplies the execution policy: local-first where safe, robust/provider-backed where the work requires it.
- Reliability hardening remains a prerequisite because customer mode collapses if the happy path stalls silently.

Any future Build Studio work should cite one of these specs rather than creating a parallel "business mode" process.

## 9. Non-Goals

- No terminal surface as the primary customer UX.
- No new Build Studio route for "business mode."
- No user-facing provider selector for normal business users.
- No wall-of-text transcript as the default progress view.
- No source-code or raw-diff requirement for approval.
- No product integration that depends on repackaging consumer Claude credentials.
- No special Claude/Codex/Grok lifecycle outside WorkCapsule, evidence, lease, and status projection.

## 10. Acceptance Criteria For The Shift

Customer-mode acceptance:

- A business user can start a small capability build and reach a preview/review step without opening Engineer view.
- Build Studio asks business-language questions when ambiguity is high and proceeds autonomously when risk and uncertainty are low.
- The active build pane shows one clear status, one next action, and one preview/screenshot path.
- Provider identity is never the main story; the work outcome is.
- External Claude/Codex/Grok work appears in the same progress and evidence surfaces as in-portal Build Studio work.

Power-user acceptance:

- A developer can still work directly in Claude Code, Codex, Grok, or opencode with skills and MCP.
- The external session claims/adopts a capsule and records evidence without duplicating the Build Studio lifecycle.
- Engineer view exposes raw evidence, branch/PR, logs, and source details when needed.
- Handoff between agents preserves branch, evidence, documents, and status.

Architecture acceptance:

- WorkCapsule is the only durable cross-surface work anchor.
- FeatureBuild remains a linked Build Studio run, not the cross-agent source of truth.
- Provider adapters are swappable and policy-gated.
- The customer projection can be tested independently from provider execution.
