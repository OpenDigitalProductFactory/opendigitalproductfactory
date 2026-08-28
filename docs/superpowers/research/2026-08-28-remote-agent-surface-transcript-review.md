---
status: active
---

# Transcript Review — remote agent surfaces, verification, and the trust curve

- **Date:** 2026-08-28
- **Scope:** platform — delivery surfaces, coworker routing, skill catalogue, capacity telemetry, workroom gates
- **Type:** external-input review of **two** sources. Not a spec. Produces candidate backlog items, one explicit rejection list, and one design (§8).

## 1. Source A — provenance

| Field | Value |
| --- | --- |
| Video | *My Friend Walks Me Through T3 Code on Mac and iPhone* |
| Channel | Ray Fernando (`@RayFernando1337`) |
| URL | `https://www.youtube.com/live/AAw5r0e-ozM` |
| Format | ~1h52m unscripted live stream, two speakers plus live chat |
| Transcript | YouTube auto-generated captions, retrieved 2026-08-28 |

**Reliability caveat, stated up front.** The transcript is machine captions of an unscripted
stream. Proper nouns are corrupted throughout — "clawed"/"cloud" for Claude, "codeex" for Codex,
"Grock" for Grok, "Pstack"/"potato mode" for a third-party skill pack, "Moshi" for an iOS terminal
app, "Pi" for a harness fork. Product names, version numbers and model identifiers in this document
are therefore **reported, not verified**. Nothing here may be cited as evidence under
[`never-fabricate`](../../founder-kernel/wiki/principles/never-fabricate.md) without independent
confirmation. The stream also carries unverified performance anecdotes — one participant's claim
that a particular Gemini Flash model outperformed three larger models at PR review across ~50 PRs,
and a claim of $12,000 of subscription-covered usage in seven days. Those are a single person's
uncontrolled observations. They are recorded below as **hypotheses worth testing**, never as findings.

## 2. What the video is actually about

Two practitioners walk through **T3 Code**, a free open-source desktop/phone client that fronts
whatever coding CLIs are already authenticated on a machine (Claude Code, Codex, Grok, Cursor), and
lets a phone drive sessions running on remote machines the user owns. The through-line is not the
tool. It is a set of operating assumptions that this segment of the market now treats as settled:

1. The operator is **away from the desk**. Value accrues to whatever lets them start, inspect and
   unblock work from a phone.
2. Model choice is **per task, not per session** — one family implements, a different family
   verifies, a cheap local model does bulk reads and documentation.
3. Harness capability is **modular through skill files**, and the scarce resource is curation, not
   quantity.
4. Cost and cache-hit telemetry are **first-class UI**, not an afterthought.

Items 2, 3 and 4 are directly relevant to DPF. Item 1 is the largest gap.

## 3. Findings

Each row was checked against existing DPF substrate before being classified.

| # | Idea from source | DPF status | Recommendation |
| --- | --- | --- | --- |
| F1 | Phone-shaped surface for starting and unblocking agent work | **Gap.** All four peer surfaces are desk-bound | Candidate backlog item — §4.1 |
| F2 | ACP as the universal harness adapter boundary | **Partially anticipated.** Flagged as "the standard to track", never decided | Run `tool-evaluation`, then a kernel decision — §4.2 |
| F3 | Different model family verifies the family that implemented | **Gap.** Judge independence is not constrained | Capture kernel gap, then decide — §4.3 |
| F4 | Per-session token spend and cache-hit rate as visible telemetry | **Gap.** A doctrine principle exists with no measurement behind it | Candidate backlog item — §4.4 |
| F5 | "Do it more than twice, make a skill" — encode working style | **Partially covered.** Capture exists; the repetition trigger does not | Small extension — §4.5 |
| F6 | Cherry-pick skills per project; big packs are mostly filler | **Already covered** | No action. External corroboration — §5.1 |
| F7 | Stream intermediate harness output to catch agent drift early | **Deliberately excluded** by the observation contract | No change to the contract; see §5.2 |
| F8 | Fan out one setup instruction across every connected machine | **Partially covered** by the bootstrap script | Low-priority extension — §4.6 |
| F9 | Vector/graph index for multi-million-line codebases | **Out of scope now** | Watch item — §5.3 |
| F10 | Symlink `CLAUDE.md` to `AGENTS.md` | **Already solved differently, better** | Reject — §6.1 |
| F11 | Tunnel a local dev port to the public internet for phone preview | **Actively hazardous here** | Reject, and harden doctrine — §6.2 |

## 4. Candidates worth acting on

### 4.1 An away-from-desk operator surface (F1)

The stream's premise is that the operator is at a beach, in a Starbucks, or making dinner, and the
phone is the only device present. DPF's four peer surfaces — Claude Code, Codex CLI, Grok and the
embedded Build Studio — all assume a keyboard and a terminal or a desktop browser.

This is a gap, but a shallow one, because the substrate that makes it feasible already exists:

- **MCP is the coordination plane.** Work, claims and gate evidence already live outside any
  surface's local state, so a thin surface needs no new source of truth
  ([`mcp-is-the-coordination-plane`](../../founder-kernel/wiki/principles/mcp-is-the-coordination-plane.md)).
- **The Workroom is already the unit of WIP**, so the phone view has an obvious primary object.
- **`background-operation-observation-contract`** already specifies exactly how a page observes
  durable work without owning it — cheap projection, events invalidate rather than carry authority,
  reconnect rehydrates. A phone on intermittent mobile data is the contract's ideal test case, not a
  new problem for it.
- **"Hide complexity from layman users"** is already a delivery-surfaces invariant. A small screen
  forces that discipline rather than fighting it.

What the source suggests is worth copying, specifically:

- **One unified list across every machine and provider**, not a per-machine list. The complaint that
  drove the whole stream was having to remember which host a session was on.
- **Settle and snooze** as first-class verbs, so the active list stays short. This maps cleanly onto
  workroom status rather than needing a new concept.
- **Notification that deep-links to the exact work item**, on gate transition and on completion.

Suggested framing for the backlog item: a read-and-unblock workroom view, not a mobile IDE. Starting
new work, approving a gate, and answering a blocked coworker are the three actions worth having.
Editing files on a phone is not.

### 4.2 Decide on ACP as the surface adapter boundary (F2)

The unified-delivery-surfaces spec makes **"surfaces are thin, swappable adapters behind a stable
contract"** its fourth invariant, precisely because the CLIs ship updates daily. Separately,
`2026-06-10-local-llm-build-agent-design.md` already identified Zed's **Agent Client Protocol** —
Apache-2.0, JSON-RPC over stdio, backed by Zed and JetBrains — as "exactly the shape of our dispatch
pipe and the standard to track for a future adapter abstraction."

The video is market evidence that this tracking should now become a decision. ACP was named
repeatedly as the feature that would make every harness interchangeable, including forks nobody has
heard of yet, and was reported as imminent in the client under discussion. The argument made on
stream — "ACP basically gives you everything" — is the same argument DPF's own fourth invariant
makes, arrived at independently.

Recommended sequence, per doctrine rather than improvised:

1. Run the `tool-evaluation` skill against ACP — security, architecture fit, compliance, integration.
2. If it clears, route the adopt/reject through `principle_decide` as a WWMD decision, since it
   changes where the surface boundary sits.
3. Record the outcome with `dpf-record-decision-outcome` whichever way it goes, so the next agent
   that asks does not re-litigate it.

This is the highest-leverage item in this review. It is also the one most likely to be *rejected* on
inspection — a JSON-RPC editor protocol may be a poor fit for a headless governed dispatch pipe —
and a recorded rejection is a good outcome.

### 4.3 Judge independence from the implementer (F3)

The sharpest engineering claim in the stream, made twice and unprompted:

> "A normal dev doesn't test his own work. They usually have a dev team and a test team, a QA team.
> It's different people and it's done that way for a reason. AI follows the same suit. Get one
> family to implement, another family to validate."

DPF has a deliberate and correct principle that a gate reads evidence and never asks which surface
produced it
([`governance-approves-evidence-not-provenance`](../../founder-kernel/wiki/principles/governance-approves-evidence-not-provenance.md)).
That principle is about **surfaces**. It says nothing about whether the model that produced an
artifact may also be the model that judges it. Those are different questions, and the second one is
currently unconstrained.

The adjacent substrate confirms the concern is live rather than theoretical. The demand-aware model
escalation design already establishes `OBJ-DAME-005`: *a judging or approving role never
self-downgrades, because a weak judge manufactures a governance receipt indistinguishable from a
real one.* The failure mode being guarded there — a receipt that looks valid and is not — is exactly
the failure mode of self-review, reached from a different direction. The same spec records the
originating incident: a model handed 49 tools made zero tool calls and returned a fabricated
"59/60 done" against a live truth of 710 items.

Proposed constraint, for decision rather than for immediate implementation: **where more than one
model family is reachable, a verifying or approving coworker must not be the same family as the
implementer, and the gate records which family judged.** Where only one family is reachable, that
fact is recorded as a known weakness of the receipt rather than silently ignored — which is the same
shape as `OBJ-DAME-006`, surfacing an unsatisfiable floor as a finding before it strands a gate.

This should go through `dpf-capture-kernel-gap` first. It is a governance rule, and inventing one in
a research note would be the wrong altitude.

### 4.4 Make responsible capacity use measurable (F4)

The client in the video shows, per session: tokens consumed, cost by model, and **cache-hit rate** —
with the reading that a high cache rate indicates a well-structured prompt, so cost and prompt
quality are read off the same number.

DPF has the kernel principle
[`responsible-capacity-utilization`](../../founder-kernel/wiki/principles/responsible-capacity-utilization.md)
and `budgetClass` on the model config. A search of the repository found no token-spend or cache-rate
telemetry anywhere: no `costUsd`, no `cached_tokens`, no cache-rate projection. The principle is
currently unfalsifiable. No agent can tell whether it is obeying it, and no operator can tell whether
the estate is.

A cheap projection — spend and cache-hit rate per workroom, written by the same path that already
writes gate evidence, observed under the existing observation contract — would turn a piece of
doctrine into something measurable. It also pairs naturally with §4.1: cost is one of the few numbers
that reads well on a phone.

Scope discipline matters here. The useful artifact is a projection an operator glances at, not a
billing subsystem.

### 4.5 A repetition trigger for skill capture (F5)

> "My rule of thumb is quite simple. If I do something more than twice, I create a skill for it."

DPF has the capture machinery: `dpf-elicit-tacit-knowledge`, `dpf-route-learning-to-commons`,
`dpf-writing-skills`, and the commandment that
[learnings belong in the shared commons](../../founder-kernel/wiki/principles/learnings-belong-in-the-shared-commons.md).
What it does not have is the **trigger**. Existing doctrine routes a *finding* — something learned,
usually from a failure. A repeated *procedure* that never failed produces no finding, so it never
routes, and it stays in whichever session happened to work it out.

The stream also describes a variant worth noting: a skill that captures *the operator's own working
style* by watching them do the thing once and encoding the flow, so later agents follow it. That is
`dpf-elicit-tacit-knowledge` pointed at procedure rather than rationale.

Cheapest useful change: add the twice-is-a-pattern trigger to the routing skill's applicability
conditions. This is a small edit to one skill, not a spec.

### 4.6 Estate-wide convergence (F8)

The stream's recurring correction was "you only set up one machine — you should have told it to set
up all your connected environments." DPF's `scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}` is the
single convergence point for a client, and it is idempotent and covers all four CLI surfaces — but
it converges **the client it is run from**. With `installation-estate-identity` already modelling the
estate, an estate-wide convergence pass is a natural extension rather than new substrate.

Low priority. Real, but it solves a problem an operator hits a handful of times.

## 5. Corroboration and watch items — no action

### 5.1 Skill catalogue curation (F6)

The stream independently arrives at DPF's existing position: a widely-recommended pack may hold a
hundred skills of which five are worth installing; cherry-pick per project; scope skills to the
project when they are language-specific. DPF already encodes this — DPF skills take precedence over
generic packs, upstream packs are installed only in local or user scope for a documented gap and
never seeded to in-portal coworkers, and `2026-08-26-skill-catalog-cap-local-presence-design.md`
addresses catalogue size directly.

Worth recording only as external corroboration that the existing rule is the market-standard one.
Notably, one participant named DPF's own upstream neighbour — a widely-used public skills repo — as
an example of a pack with a few excellent skills and "an awful lot of bad ones." That is the exact
reasoning behind the existing precedence rule.

### 5.2 Mid-run visibility versus the observation contract (F7)

A participant's stated top feature request was live streaming of the harness's intermediate output
"purely so you can see when the agents are going to drift."

The operator need is real. The implementation implied by it conflicts with
`background-operation-observation-contract` items 2 and 4 — the ledger is truth, and events
invalidate rather than carry authority. Streaming raw harness chatter as the observed state would
reconstruct durable state from transient events, which the contract forbids for good reasons that
predate this video.

The contract does not, however, forbid a **bounded, explicitly non-authoritative activity view** read
from a projection. If drift detection is wanted later, that is the shape it must take. No change is
recommended now; this is recorded so a future proposal starts from the right constraint instead of
rediscovering it.

### 5.3 Retrieval for very large codebases (F9)

An extended segment argues that beyond roughly five million lines, agent context and sub-agent
summarisation stop working and a vector or graph index becomes necessary. The claim is plausible and
the participant reports a working PG-vector setup, but it is not a DPF problem today at DPF's own
scale, and adopting an index would be substrate addition without a proven need — which
[`verify-substrate-before-proposing-new`](../../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md)
rules out. The one angle worth remembering is customer-facing: an archetype owner with a large legacy
estate would hit this before DPF does.

Watch item. No work.

## 6. Explicit rejections

Recorded so they are not re-proposed.

### 6.1 Symlinking `CLAUDE.md` to `AGENTS.md` (F10)

Proposed on stream as a way to keep one rulebook across harnesses. DPF already solves this, and
better: `CLAUDE.md` is a pointer that imports `@AGENTS.md`, so there is exactly one rulebook and no
filesystem trick. A symlink would additionally be fragile on Windows checkouts, which DPF supports.
Reject.

### 6.2 Tunnelling a local port for remote preview (F11)

The stream describes having an agent stand up a Cloudflare tunnel so a phone can reach
`localhost:3000` on a home machine, and treats this as a convenience feature.

In DPF this would be a serious defect, not a convenience. The Contributor preview on `:3001` is a
single shared container, bind-mounted to one worktree at a time, **writing to the live database**,
and it is lease-gated for exactly that reason. Publishing it to the internet would expose an
unauthenticated write path to production data. Reject unconditionally.

**Verified and closed, 2026-08-28.** The doctrine did not say so. `runtime-gates-via-shared-lease`
governed *which thread may bind* the shared runtime and forbade silent re-bind, but its threat model
was thread-vs-thread contention and live-DB mutation — not reachability. A search across every kernel
principle, `docs/architecture/*.md` and `AGENTS.md` for tunnel, ngrok, port exposure or public
reachability returned nothing. So an agent legitimately holding the lease could satisfy every written
rule and still publish an unauthenticated write path to the live database.

The principle and `AGENTS.md` §12 now carry the clause: a lease-gated runtime is never reachable from
beyond the host, by any mechanism, and **holding the lease authorises use, never exposure.**

## 7. Suggested next steps (Source A)

In priority order. None of these are done by this document.

1. **F2** — `tool-evaluation` on ACP, then a `principle_decide` call, then record the outcome either way.
2. **F3** — `dpf-capture-kernel-gap` for judge-implementer independence, then a decision.
3. **F4** — file a backlog item for spend and cache-rate projection.
4. **F1** — file a backlog item for the away-from-desk workroom view; check epic overlap against the delivery-surfaces epics first.
5. **F11** — confirm whether the lease doctrine already forbids external exposure; if not, extend it.
6. **F5**, **F8** — small extensions, batch with adjacent work rather than filing separately.

**Priority note added after Source B (§8).** The order above is Source A's. Read against Source B,
**F12 (§8.4) precedes all of them** — it is the constraint the others are downstream of, and F1 in
particular should not start before it. F3 is no longer a proposal awaiting evidence; the evidence
arrived with Source B.

**Backlog items are not filed.** The DPF MCP server was unreachable for this session
(`DPF_MCP_BEARER_TOKEN` unset; connection refused), so live backlog state could not be queried and
nothing could be written to it. Per
[`live-state-over-seed-data`](../../professions/data-architect/wiki/live-state-over-seed-data.md),
the epic-overlap check in step 4 must run against the live database before any of these become
items — this document must not be treated as having done it.

## 8. Source B — the trust curve and verification

Added 2026-08-28, after the first review was written. The two sources are directly connected:
Source A is practitioners spending an hour installing this speaker's skill pack; Source B is the
author explaining the reasoning behind it. Source B is the more rigorous of the two and carries
first-party authority, so it is reviewed at greater depth.

### 8.1 Provenance

| Field | Value |
| --- | --- |
| Speaker | Lauren Tan — Cursor (~5 months at time of recording); previously React compiler team at Meta, tech lead then engineering manager at Netflix |
| Format | ~60m recorded talk plus live Q&A, one interviewer |
| URL | `https://www.tiktok.com/@sarutalksai/video/7678050436489743638` |
| Transcript | **None published** — the platform reports `captionInfos: []`. Transcribed locally from the video's audio with Whisper (`base.en`) on 2026-08-28 |

**Reliability caveat.** A local speech-to-text pass on a screen-shared talk mangles proper nouns
worse than platform captions do: "PStack" appears as "P stack"/"piece that"/"PSAC", "Grokbot" as
"Grockbot"/"graph bot"/"Crockbot", "evals" consistently as "emails", "Dune" as "doing"/"dune".
Quotations below are lightly repaired for these known substitutions and for disfluency; the
argument is unaltered. Anything load-bearing was read in context rather than from a keyword match.
As with Source A, the speaker's productivity figures (~1000 PRs landed in a month; ~800 by the 12th
of the next; ~600 PRs to refactor one application) are self-reported and uncontrolled, and she
volunteers the relevant confound — she works at an AI lab with effectively unmetered tokens.

### 8.2 The argument

1. **Parallelism is gated by trust, and trust is not willed into existence.** *"You can't go to 100 agents, spawn 100 agents, when you don't even trust the output of one agent."* She plots her own year as a curve and is explicit that there is no shortcut along it.
2. **Verification is the load-bearing skill.** Verification means the agent actually runs the thing — traces, heap snapshots, a simulator, the real UI — not that it reasons about whether it works. *"If you don't have a verification skill, you are the verifier. You're the bottleneck... so there's really no way to parallelize."* It does not make an agent write *good* code; it makes it write *correct* code, which is the precondition for trusting it at all.
3. **Enforcement has ranked layers.** Architecture and conventions are strongest (agents copy surrounding patterns); then CI hard failures; then static analysis; then rules, skills and review bots. Her warning about stopping at the last tier: *"if you only have rules and bugbot and skills and a style guide for your code, it's only a matter of time before your codebase looks like complete trash."*
4. **A rule a human enforces by reading is an anti-pattern.** *"If you are stuck in code review land where you enforce all of the invariants by literally the human person reading the code — every time you have to do that, you should consider that an anti-pattern. Instead of me commenting on the PR, how do I turn this into a hard rule? A lint rule? A CI failure? Or how do I categorically eliminate this problem entirely?"*
5. **The feature map.** A verification skill is useless if the agent cannot navigate. Her fix is an artifact mapping each user-visible feature to how a user reaches it — routes, keyboard shortcuts, DOM selectors — which turns a screenshot-plus-"???" bug report into a reproducible one.
6. **Evals are unit tests for skills.** Sub-agents run in deliberately neutrally-named directories, *"to not let the sub agent know that it's being evaluated, because agents can actually tell — and when they do, they change their behavior."* A judge agent **of a different model** cross-references so the first model's bias does not go unchecked. Scores are hill-climbed.
7. **The economics.** Constraints cost tokens up front and pay back by letting non-experts contribute safely: *"designers and PMs are just able to ship features directly."*

### 8.3 What this changes about the first review

- **F3 (judge–implementer independence) is corroborated, not merely proposed.** §4.3 argued it from DPF's own DAME objectives. Source B is someone running it in production for exactly the stated reason — the judging model's bias. F3 moves from "worth deciding" to "the evidence is in; decide it."
- **F4 (capacity telemetry) gains its business case.** Her ROI argument — spend tokens on constraints, recover them in unsupervised throughput — is unarguable either way at DPF today, because `responsible-capacity-utilization` has no measurement behind it.
- **F1 (away-from-desk surface) drops in relative priority.** Source A treats the phone as the unlock. Source B implies the phone is worthless until verification is trustworthy, because an operator on a beach approving unverified work is strictly worse than the same operator at a desk. Mobility is a *consequence* of trust, not a route to it.
- **A new finding, F12, outranks all of them.** Below.

### 8.4 F12 — the workroom gate does not prove the thing ran

Checking Source B's thesis against DPF's own gate produced the sharpest finding in either review.

DPF runs **93 non-test guard scripts** under `scripts/check-*`. Every one protects the repository
that builds the factory. At the workroom runtime tier, the build lifecycle gate has exactly one
hard check — the code compiles. Tests are informational, UX verification is advisory by an
operator decision, acceptance is self-reported, and `verificationDepth` is derived, tightened and
rendered as a chip that no gate reads.

**DPF has hard gates on the code that builds the factory and soft gates on the work the factory
does.** By Source B's argument, that is precisely what caps how many coworkers can safely run at
once — the human remains the verifier.

This is now a design in its own right, with the findings code-verified against the gate
implementation:

- Design: [`2026-08-28-verification-first-workroom-gates-design.md`](../specs/2026-08-28-verification-first-workroom-gates-design.md)
- Plan: [`2026-08-28-verification-first-workroom-gates.md`](../plans/2026-08-28-verification-first-workroom-gates.md)

### 8.5 Rejected from Source B

- **Auto-merge on agent verdict.** Her endpoint is agents merging unattended, reviewed later on `main`. DPF forbids an agent approving or merging anything. The upstream practice transfers; the merge decision does not — DPF's endpoint is higher concurrency *under* gates.
- **Banning code comments in CI.** Her reason is sound (agents narrate irrelevant history) but DPF handles it at the right layer with `dpf-unslop`, and DPF's doctrine deliberately encodes contingency markers in prose. A ban would delete a governance mechanism to fix a style problem.
- **Rewriting for architectural strictness.** She argues greenfield vibe-coded apps are the biggest risk and may deserve a rewrite. By her own analysis DPF is in the good position already — brownfield with guardrails.

### 8.6 Corroborated, no action

Her skill-maintenance practice — evals as unit tests, cross-model judging, hill-climbing a rubric —
is the same shape as DPF's certification sweep with its five mechanical oracles, arrived at
independently. It corroborates the existing substrate rather than suggesting a change to it.
