# DPF Architecture Patterns — what the code already knows the models don't

**Audience:** the Software Engineer route coworker ([prompts/route-persona/build-specialist.prompt.md](../../prompts/route-persona/build-specialist.prompt.md)) and the Build Studio sub-agents ([prompts/specialist/software-engineer.prompt.md](../../prompts/specialist/software-engineer.prompt.md), [data-architect.prompt.md](../../prompts/specialist/data-architect.prompt.md), [frontend-engineer.prompt.md](../../prompts/specialist/frontend-engineer.prompt.md)). Also: external coding agents working against this repo.

**Scope:** DPF-novel patterns, DPF anti-patterns that the founder kernel forbids, and restraint rules for when *not* to apply otherwise-standard textbook patterns inside this codebase.

**Out of scope:** textbook material (MVC, GoF, DI, repository, hexagonal, CQRS, event-sourcing, saga, Next.js / React / Prisma idioms). Frontier models reliably know these from training; re-teaching them here is noise. This doc deliberately omits them.

**Companion:** [`docs/architecture/ai-coworker-development-principles.md`](ai-coworker-development-principles.md) describes how DPF coworker agents are *designed* (specialization, orchestrator-worker, structured handoffs, diversity-of-thought). This doc describes the patterns those agents *apply* when building features.

---

## When to read this

Re-read on every Ideate phase, and before any decomposition gate proposal in Plan. Skip when patching a known bug in an existing path that already follows the patterns.

The trigger is: *am I about to propose new structure?* New entity / table / column, new orchestration flow, new MCP tool surface, new component family, new state machine, new background job, new substrate. If yes — read §1 (does a DPF-novel pattern apply?), §2 (am I about to violate a kernel anti-pattern?), §3 (am I over-patterning when none is needed?).

If the change is a 5-line bug fix inside an existing well-patterned path, skip the doc. Pattern reuse is the existing path.

---

## §1. DPF-novel patterns

These are not in any training corpus. They are how DPF expresses itself.

### 1.1 GearInterface — canonical observation envelope at every ring boundary

**What.** DPF's runtime is modelled as a five-ring reduction-gear train (see [2026-05-24-reduction-gear-architecture-design.md](../superpowers/specs/2026-05-24-reduction-gear-architecture-design.md)). Every boundary between rings — Coworker → Workflow → Archetype → Sandbox→Prod → Hive — emits a `GearInterface` record. It is the canonical *read* substrate for cross-ring evidence, calibration, and visualization. Existing tables (`ToolExecution`, `RuntimeVerification`, `BuildPhaseRun`, `BacklogItemActivity`, `WorkCapsuleActivity`, `DecisionInteraction`) remain authoritative for their own writes; GearInterface dual-emits *near* them, not *instead of* them.

**When to use.** When you are adding evidence emission at a ring boundary (e.g., a new Build Studio phase outcome, a new runtime verification class, a new hive contribution event). The Cockpit and cross-ring queries should read GearInterface, not the producer-local table directly.

**When NOT to use.** Do not migrate an existing producer table to GearInterface as a first move. Phase 0 of the gear-architecture spec is explicit: one narrow producer (Build Studio Ring 1→2) is instrumented first, GearInterface stays additive, command/write models stay on existing tables. Never invent a second verification ledger when `RuntimeVerification` already exists for the surface.

**Shape.** Bidirectional (ring numbers stay canonical; direction is a field). Outward = work compounding inner → outer. Inward = outer-ring evidence / hive priors flowing back into the install.

**Kernel:** [`verify-substrate-before-proposing-new`](../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md), [`one-data-model`](../professions/data-architect/wiki/one-data-model.md), [`single-source-of-truth`](../founder-kernel/wiki/principles/single-source-of-truth.md).

---

### 1.2 WWMD consultation — `principle_decide` against the founder kernel

**What.** Any non-trivial decision with two or more options is scored against the in-scope founder-kernel principles via the `principle_decide` MCP tool ([apps/web/lib/mcp-tools.ts:2929](../../apps/web/lib/mcp-tools.ts:2929)). It is **advisory only** — it returns a recommendation plus a per-principle contribution ledger so callers can render the *why*, not just the *what*. The caller retains authority and is free to override; overrides become training signal for future kernel-weight calibration.

**When to use.** Spec sign-off questions with multiple plausible answers. Build Studio phase-advance gates where principles pull in different directions. Anywhere an operator decision should be made traceable to which principles supported or opposed it. The Build Studio plan-advancement gate at [apps/web/lib/decision-perspective/build-studio-gate.ts:33](../../apps/web/lib/decision-perspective/build-studio-gate.ts:33) is the canonical end-to-end example.

**When NOT to use.** Single-option decisions (no scoring needed). Pure mechanical decisions ("does this file exist?"). Decisions inside a tight loop — `principle_decide` is a Postgres + Qdrant retrieval call, not a microsecond operation. Decisions where the answer is already encoded in a hard runtime invariant.

**Shape.**
```
principle_decide({
  context: "short prose describing the decision",
  options: [
    { id, description, features?: { dimensionKey: 0..1, ... } },
    ...
  ],
  callingPopulation: "in_platform_coworker" | "external_coding_agent" | "human",
  ringScope?: ["ring-2-workflow", ...] | ["universal-ring"],
  tieMargin?: number,   // confidence flips to "low" below this
  callingSurface?: string,
})
```
Result is `{ recommendation, confidence, perPrincipleLedger, ... }`. Persist the consultation as a `DecisionInteraction` row so overrides become auditable training signal. PR [#1115](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1115) §12a is a worked example for spec-level sign-off.

**Kernel:** [`consult-specs-first`](../founder-kernel/wiki/principles/consult-specs-first.md), [`human-in-the-loop-at-phase-boundaries`](../founder-kernel/wiki/principles/human-in-the-loop-at-phase-boundaries.md), [`diversity-of-thought`](../founder-kernel/wiki/principles/diversity-of-thought.md).

---

### 1.3 Workroom vs FeatureBuild vs Sandbox vs RuntimeTarget — pick the right substrate

**What.** Four overlapping-but-distinct primitives. Choosing the wrong one creates a parallel substrate that must be reconciled forever.

| Primitive | Schema | What it represents | Owner of writes |
|---|---|---|---|
| `WorkCapsule` ([work-coordination.prisma](../../packages/db/prisma/schema/work-coordination.prisma)) | Soft lease on a body of work; tracks heartbeat, claim, release | Concurrency coordination — "who is working on this right now" | Whoever claims the workroom (PAR — see §1.4) |
| `FeatureBuild` ([build-delivery.prisma](../../packages/db/prisma/schema/build-delivery.prisma)) | A Build Studio build through Ideate → Plan → Build → Review → Ship; owns `designDoc`, `buildPlan`, `phaseRuns`, `dispatchAttempts`, `phaseHandoffs` | Procedural workflow state for one feature | Build Studio orchestrator + sub-agents |
| `Sandbox` ([build-delivery.prisma](../../packages/db/prisma/schema/build-delivery.prisma)) | Isolated container + workspace where code is actually authored and tested | Ephemeral execution environment for a FeatureBuild | Sandbox lifecycle controller |
| `RuntimeTarget` ([build-delivery.prisma](../../packages/db/prisma/schema/build-delivery.prisma)) + `RuntimeVerification` ([build-delivery.prisma](../../packages/db/prisma/schema/build-delivery.prisma)) | Deployment / runtime status of a long-lived service; verification events attach here | Operational truth — "is this thing running and verified" | Deploy + verification pipelines |

**When to use which.**
- Long-running mutable body of work multiple sessions might pick up → `WorkCapsule`.
- A feature moving through the five build phases → `FeatureBuild`.
- A container with `/workspace` mounted for code authoring → `Sandbox`.
- A deployed surface whose health and verification status need ongoing tracking → `RuntimeTarget` + `RuntimeVerification`.

**When NOT to use.**
- Do not create a `FeatureBuild` for a 5-line bugfix; use the existing path.
- Do not store deployment status on `FeatureBuild`; that belongs on `RuntimeTarget`.
- Do not coordinate concurrency by spinning a second `FeatureBuild` row; that is what `WorkCapsule` exists for.
- Do not invent a fifth primitive. Per [`verify-substrate-before-proposing-new`](../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md), the four above already cover the design space.

**Kernel:** [`verify-substrate-before-proposing-new`](../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md), [`one-data-model`](../professions/data-architect/wiki/one-data-model.md), [`schema-honesty-over-aspirational-naming`](../founder-kernel/wiki/principles/schema-honesty-over-aspirational-naming.md).

---

### 1.4 Propose-Acknowledge-Reassign (PAR) — concurrent-session ownership protocol

**What.** Either side (operator or coworker) may **propose** that the other take a body of work. The named owner must **acknowledge** explicitly before mutation begins. Reassignment back — preserve / abandon / complete / escalate / defer — is also explicit, never implicit. Acknowledgement is recorded as state, not chat.

**When to use.** Any time more than one session could touch the same body of work (multiple Claude sessions, operator + coworker, two coworkers in different value streams). `WorkCapsule` is the substrate; PAR is the protocol on top of it.

**When NOT to use.** Single-session, single-actor work inside one phase of a `FeatureBuild`. The phase boundary itself is the acknowledgement; no separate PAR exchange needed mid-phase.

**Failure mode it prevents.** Two sessions silently working the same surface, one sweeping the other's staged files into its commit, overlapping PRs, lost work. Empirically documented in memory across multiple incidents in 2026-05 (`feedback_git_commit_only_for_concurrent_sessions`, `feedback_worktree_per_session`, `feedback_pr_overlap_check_before_pushing`, `feedback_continuous_overlap_check`).

**Kernel:** [`propose-acknowledge-reassign`](../founder-kernel/wiki/principles/propose-acknowledge-reassign.md) (commandment-tier). Related: [`worktree-per-session`](../founder-kernel/wiki/principles/worktree-per-session.md), [`worktree-base-origin-main`](../founder-kernel/wiki/principles/worktree-base-origin-main.md), [`sweep-main-before-trusting-worktree-specs`](../founder-kernel/wiki/principles/sweep-main-before-trusting-worktree-specs.md), [`mention-uncommitted-changes`](../founder-kernel/wiki/principles/mention-uncommitted-changes.md).

---

### 1.5 Governance approves evidence, not provenance

**What.** Phase-gate decisions, plan reviews, design reviews, and ship gates are made on the *quality of evidence* presented, not on *who produced it*. A human-authored design doc and a coworker-authored design doc go through the same `reviewDesignDoc` gate. There is no shortcut path that lets a Mark-authored artifact skip the gates that a coworker-authored artifact would pass through.

**When to use.** Always. Every gate handler reads the artifact, not the author.

**When NOT to use.** Never. The standing operator rule is: *do not propose "mark complete and skip the gates" as a shortcut for any reason*.

**Why this exists.** Asymmetric trust by provenance compounds: once "Mark's stuff skips review," the platform stops detecting Mark's mistakes; once "the coworker's stuff is suspect by default," the coworker can never accumulate trust. Both failure modes erode the autonomy ladder the platform is built around.

**Kernel:** [`governance-approves-evidence-not-provenance`](../founder-kernel/wiki/principles/governance-approves-evidence-not-provenance.md) (core-tier). Related: [`human-in-the-loop-at-phase-boundaries`](../founder-kernel/wiki/principles/human-in-the-loop-at-phase-boundaries.md), [`evidence-before-diagnosis`](../founder-kernel/wiki/principles/evidence-before-diagnosis.md), [`structural-verification-is-not-functional`](../founder-kernel/wiki/principles/structural-verification-is-not-functional.md).

---

### 1.6 Host-heavy work uses durable resource leases, not waiting processes

**What.** TypeScript compilation, Vitest, Next builds, Docker builds, previews, local inference, and semantic review compete for the same finite host memory. Each heavyweight invocation declares a closed `resourceClass` and expected memory floor, then claims the singleton `host-heavy-resource` lane through `NonProductionEnvironmentLease`. The lease is durable coordination state; the Node process is only the current executor.

**When to use.** Any host-local command whose memory floor is large enough to destabilize concurrent development work. The canonical profiles live in [`host-resource-profiles.json`](../../apps/web/lib/nonprod/host-resource-profiles.json), the admission decision in [`host-resource-policy.ts`](../../apps/web/lib/nonprod/host-resource-policy.ts), and command supervision in [`host-resource-runner.mjs`](../../scripts/host-resource-runner.mjs).

**Execution contract.** Cheap guards bypass admission. Heavy commands fail closed when host memory cannot be measured, preserve a host reserve plus the resident inference reserve, and serialize inference. A denied invocation records bounded queue diagnostics and exits with code 75; it does not leave a waiting Node process alive. The caller may retry or, once durable wait/resume is available, suspend and wake from a lease event. Only the process identified by the lease's PID plus operating-system process-start identity is supervised. Stray processes are evidence, never kill targets.

**When NOT to use.** Do not add a second resource queue or scheduler. Do not hold a thread or shell open while waiting for admission. Do not kill a process merely because its command resembles a known tool. Do not promote a queued claim using stale memory evidence after another lease releases.

**Why this exists.** Process-count limits alone cannot protect a 64 GiB developer host when inference is already resident. Durable, memory-aware admission turns invisible RAM contention into explicit capacity state and prevents dozens of idle waiters from consuming memory and tokens around one bottleneck.

**Kernel:** [`verify-substrate-before-proposing-new`](../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md), [`evidence-before-diagnosis`](../founder-kernel/wiki/principles/evidence-before-diagnosis.md), [`single-source-of-truth`](../founder-kernel/wiki/principles/single-source-of-truth.md).

---

## §2. DPF anti-patterns — defaults the kernel forbids

Models reach for these because they look like reasonable defaults from training data. In DPF they are wrong, and the kernel says so.

### 2.1 Wiping DB volumes to "fix" a code bug

**Default reflex:** "the data looks weird, let me start fresh." `docker compose down -v` and re-seed.

**Why wrong in DPF:** volumes hold operator credentials, provider configs, brand profiles, and accumulated calibration data. Wiping them to debug a code path destroys hours of operator work and resets every dynamic-discovery loop the platform has run. The same code bug exists either way; only the operator's data is gone.

**Do instead:** rebuild the *image*, restart the *container*. Leave the *volume* alone. If the data really is corrupt, target the specific rows.

**Kernel:** [`never-wipe-db-for-code-fixes`](../founder-kernel/wiki/principles/never-wipe-db-for-code-fixes.md) (commandment-tier).

---

### 2.2 Hardcoding a provider in the seed or AgentModelConfig

**Default reflex:** "I'll seed `provider: 'anthropic'` so the agent has a known good model."

**Why wrong in DPF:** routing picks the right LLM dynamically by capability tier + task type. Hard pins in seeds, `AgentModelConfig`, or override tables defeat the routing layer and freeze the platform on whichever provider the seed-author happened to have credentials for. The same agent will fail on a fresh install with a different provider mix.

**Do instead:** seed `minimumCapabilities` (the floor the agent needs). Let the runtime resolve. If a specific provider is the only one that works for a task, that is a *capability* gap to declare, not a *pin* to hardcode.

**Kernel:** memory feedback `feedback_no_provider_pinning`. Related: [`live-state-over-seed-data`](../professions/data-architect/wiki/live-state-over-seed-data.md), [`specialization-over-generalization`](../founder-kernel/wiki/principles/specialization-over-generalization.md).

---

### 2.3 Patching the runtime path when the seed is wrong

**Default reflex:** the agent has a missing field at runtime; add a default in the consuming code.

**Why wrong in DPF:** the field is missing because the *seed* didn't populate it. Patching the consumer makes the next ten consumers each invent their own default, drift apart, and obscure the source of truth. Every fresh install rediscovers the same bug.

**Do instead:** fix `packages/db/src/seed.ts`. Add an invariant guard ([scripts/audit-routing-spec-boot-invariants.ts](../../scripts/audit-routing-spec-boot-invariants.ts) pattern) that fails the boot if the field is missing.

**Kernel:** [`fix-the-seed-not-the-runtime`](../professions/data-architect/wiki/fix-the-seed-not-the-runtime.md), [`live-state-over-seed-data`](../professions/data-architect/wiki/live-state-over-seed-data.md), [`schema-audit-before-features`](../professions/data-architect/wiki/schema-audit-before-features.md).

---

### 2.4 Calling "tests pass" or "route returns 4xx" structural verification "complete"

**Default reflex:** typecheck green + unit tests green + route returns 400 to malformed input → done.

**Why wrong in DPF:** none of that proves the operator can complete the happy path on the live install. Voice/STT was declared "complete and live" four times before an operator clicked the mic and discovered the sidecar had never been started. Every "complete" claim was based on structural evidence.

**Do instead:** drive the happy path on the live install (Chrome MCP / computer-use / curl-with-real-payload), observe the user-visible result, screenshot the receipt. If the path can't be driven, *say so explicitly* in the status report — do not elide.

**Kernel:** [`structural-verification-is-not-functional`](../founder-kernel/wiki/principles/structural-verification-is-not-functional.md) (commandment-tier).

---

### 2.5 Diagnosing without checking the data

**Default reflex:** a log line says "X failed because Y"; report Y to the operator.

**Why wrong in DPF:** the log's suggested cause is often wrong (intermediate-layer error message, not root cause). Reporting it propagates a false diagnosis the operator then acts on.

**Do instead:** confirm the log's claim by querying the DB / inspecting the status field / reading the actual response payload before naming a cause. "I see Y in the log, and confirmed by querying `Provider.status` that the credential is in fact expired."

**Kernel:** [`evidence-before-diagnosis`](../founder-kernel/wiki/principles/evidence-before-diagnosis.md), [`check-tool-signals-first`](../founder-kernel/wiki/principles/check-tool-signals-first.md).

---

### 2.6 Telling the operator to run a command

**Default reflex:** "you can verify this by running `psql ...` or `docker logs ...`."

**Why wrong in DPF:** DPF operators are non-technical by design. They make decisions; the agent runs the system. Asking the operator to copy-paste a shell command violates the platform's reason for existing.

**Do instead:** run the command yourself and report the result. If the operator-facing surface needs the data, the missing surface is the bug — file it.

**Kernel:** [`never-ask-user-to-run-commands`](../founder-kernel/wiki/principles/never-ask-user-to-run-commands.md) (commandment-tier), [`do-the-work-dont-task-the-operator`](../founder-kernel/wiki/principles/do-the-work-dont-task-the-operator.md).

---

### 2.7 Adding a new table / type / epic without grepping first

**Default reflex:** "we'll need a new `WorkItem` table for this." Draft the migration.

**Why wrong in DPF:** the architecture is denser than first reads suggest. `BacklogItem` already exists with the needed fields; `JobStatus` is already an enum value on `Job`; the epic was already created last week. Parallel substrates are expensive forever; naming churn on a single substrate is cheap.

**Do instead:** grep Prisma schema, type unions, capability registry, backlog (`mcp__dpf__query_backlog`), and spec frontmatter for the candidate noun *before* writing the spec. Note the closest existing fit in the spec — even when rejecting it, the reader needs to know why a new substrate is warranted.

**Kernel:** [`verify-substrate-before-proposing-new`](../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md), [`one-data-model`](../professions/data-architect/wiki/one-data-model.md), [`sweep-main-before-trusting-worktree-specs`](../founder-kernel/wiki/principles/sweep-main-before-trusting-worktree-specs.md).

---

## §3. When NOT to apply a textbook pattern

Models reach for textbook patterns whenever they sense complexity, even when the complexity isn't there yet. The cost of premature pattern application is real: extra indirection, ceremony around tiny code, and abstractions that pin the design before the constraints are known.

The rule of thumb DPF uses: **pattern when the code asks for it, not when the topic suggests it might.**

### 3.1 Restraint thresholds

| Pattern | Reach for it when | Skip when |
|---|---|---|
| Singleton / dedicated service module | Cross-module shared mutable state with lifecycle (DB pool, queue client, model cache) | Module-level `const config = { ... }` or a 30-line file used in one place |
| Factory | Three or more concrete implementations of a common interface with conditional construction | A two-option enum (`if x then A else B`) — just write the conditional |
| Strategy / pluggable behavior | Behavior varies along an axis that is expected to grow (provider, adapter, transport) | Two cases that the spec lists as the only two there will ever be |
| Repository layer | Mixed persistence (Postgres + cache + vector + graph) behind a single business operation | A single Prisma call in a single action; Prisma *is* the repository |
| Dedicated DI container | Many cross-cutting dependencies wired into many entrypoints with test substitution needs | Module imports; Next.js server-action context |
| Custom state machine library | Five or more states with non-trivial guarded transitions | The Build Studio `BuildPhase` union (`ideate / plan / build / review / ship / complete / failed`) — a string union + advance function is enough |
| Event bus / pub-sub | Producers and consumers are genuinely decoupled across module boundaries with multiple consumers per event | One producer, one consumer, one event — just call the function |
| Generic abstraction (template / generic class hierarchy) | At least three real concrete uses already exist or are imminent | Speculation that "we might need this for X later" |

### 3.2 Specific over-engineering reflexes to skip

- **Wrapping Prisma in a custom repository for "testability."** Prisma + a test DB or a mocked client is the DPF pattern. New abstractions over Prisma are usually a tax, not a win.
- **Creating a "service layer" for a single CRUD endpoint.** Next.js server actions are the service layer. Inline.
- **Adding a feature flag for a change that is shipping in this PR.** Backwards-compatibility shims for code you can just change are noise. The kernel's worktree-per-session model means you are already isolated.
- **Adding `try/catch` "just in case" around code that has no documented failure mode.** Per [`fail-fast-explain-clearly`](../founder-kernel/wiki/principles/fail-fast-explain-clearly.md), let it fail; the surrounding harness will surface it.
- **Refactoring three similar lines into a helper.** Three similar lines is fine. The fourth is the signal to extract — and even then, only if the duplication has the same *meaning*, not just the same shape.

---

## How this doc evolves

When a new DPF-novel pattern emerges (post-Phase-0 GearInterface adoption, post-PAR-kernel-promotion, new substrate primitive), add a §1 entry citing the spec or kernel page that introduces it. When a new anti-pattern is named in operator feedback or kernel memory, add a §2 entry citing the source. Restraint rules in §3 evolve when the platform actually trips on a missing one — not preemptively.

Cross-link to specific kernel principle pages, specs, and source files. The point of this doc is to let an agent jump *into* the canonical source, not to summarize it forever.
