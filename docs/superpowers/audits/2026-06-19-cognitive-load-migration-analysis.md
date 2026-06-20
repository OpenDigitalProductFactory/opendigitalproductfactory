# Cognitive Load Migration Analysis — Human → AI Agent → Code

- **Date:** 2026-06-19
- **Author:** Operator `/goal` session (Claude, with 4-agent substrate sweep)
- **Status:** Analysis / strategy input (not a build spec). Proposes one candidate epic (§6) and maps the rest to existing epics/BIs. The three code→AI "ascent" BIs (§5 #6) are filed under EP-FULL-OBS: `BI-A1FC3EBB`, `BI-12E646D3`, `BI-93FE150F`.
- **Scope:** Where work and decisions sit on the Human → AI Agent → Code spectrum across the platform, the mechanisms that move them, and ranked migration opportunities across the four named loci: Build Studio, AI Coworkers, scheduled activity, and user surfaces.

---

## 1. Executive summary

DPF is, structurally, a **cognitive-load migration machine**. Its reason for existing is to move work off humans — first onto AI agents, then, where the pattern stabilizes, onto deterministic code. Build Studio is that machine pointed at *platform development*; the AI coworkers and surfaces are the same machine pointed at the *customer's business*; the self-upgrade loop makes it recursive.

Three findings frame the opportunity set:

1. **Migration is real and already ~60% done inside the coworker runtime** — intent classification, prompt assembly, tool filtering, agentic-loop bounds, and grant expansion are all deterministic code today. The canonical mechanism is **tool-ification**: repeated agent reasoning becomes an MCP tool (240+ tools = 240+ codified capabilities).
2. **The migration is human-initiated and ad-hoc.** Someone notices "this should be codified," files a BI, and Build Studio writes it. The *observation substrate* to do this automatically already exists (`ToolExecution`, `BuildActivity`, `SkillMetric`, `coworker-regression-detect`, `log-signature-scanner`, `skill-metrics-aggregator`) but is **not wired to nominate migration candidates**. This is the keystone gap (§6).
3. **The highest customer-felt load is on the surfaces, not the runtime.** Onboarding, business-context capture, and provider/config interpretation still put 8-field forms and status-matrix reading on a non-technical user — directly against the "hide complexity from layman users" doctrine. `agent-form-assist.ts` already proves the human→AI path; it is under-applied.

A fourth, structural point: migration is **not** one-directional. There is a real **counter-migration (code → AI)** where deterministic jobs use naive thresholds that misfire, and an **irreducible human floor** (governance, sovereignty, irreversible outbound acts, taste/values) that must *not* migrate. A correct strategy moves load to its *right* tier, not always *down*.

---

## 2. The structure: the cognitive-load stack

### 2.1 Three tiers

| Tier | Cost / call | Determinism | Ambiguity tolerance | Auditability | Best for |
|------|-------------|-------------|---------------------|--------------|----------|
| **Human** | Highest (scarce, slow) | n/a | Highest | Low (intent in a head) | Irreducible judgment, taste, authority, irreversible/unbounded-risk acts |
| **AI Agent** | Tokens (metered, fast-ish, can err) | Low (stochastic) | High | Medium (`ToolExecution`, traces) | Repeatable judgment under ambiguity; *learning* a pattern before it is codified |
| **Code** | ~0 (cheap, instant) | Total | None | Total (tests, types, logs) | Stable, crisp-boundary, high-volume, must-be-correct work |

### 2.2 Four forces acting on load

1. **Descent (the main migration): human → AI → code.** Driven by *repeatability* and *stabilization*. The desired default direction.
2. **The bridge (AI is the learning tier).** You do not jump human → code. The AI tier is where an ambiguous pattern is *handled and observed* until its decision boundary becomes crisp enough to codify. Codifying too early produces brittle code; never codifying wastes tokens forever on a solved pattern.
3. **Ascent (the counter-migration): code → AI.** When deterministic code uses guessed thresholds or context-blind rules and therefore misfires (false positives, missed signals), the fix is to push *judgment up* to the AI tier, not to tune the magic number again.
4. **The floor (irreducible human).** Governance/kernel veto, decision-scope authority (WWMD/WWWD/WSID), data sovereignty, irreversible outbound actions, and genuine values/taste calls. The platform's job near the floor is **not** to remove the human but to *concentrate* the human's attention on the one irreducible decision while migrating everything around it down.

### 2.3 Load is not monolithic — it decomposes

A single "decision" is really a chain: **gather context → generate options → decide → execute → verify.** These migrate at *different rates*. The most common and most valuable pattern is: **keep `decide` at the human tier, migrate `gather`/`generate`/`execute`/`verify` down.** This is exactly progressive disclosure (the enforced UX-Fit gate, AGENTS.md §12): auto-derive everything computable, surface only 3–5 plain choices. Treating "load" as decomposable is what makes the floor compatible with aggressive migration.

---

## 3. The process: how DPF migrates load

### 3.1 The five mechanisms (all already present)

1. **Observation.** Every AI action is recorded (`ToolExecution` → `/platform/ai/authority`; `BuildActivity`; `SkillMetric`; `coworker-regression-detect.ts`; `log-signature-scanner.ts`; `skill-metrics-aggregator.ts`). This is the raw material for spotting "this reasoning has stabilized."
2. **Tool-ification (AI → code).** Repeated agent reasoning is frozen into an MCP tool. The 240+ tool surface is the accumulated record of this migration.
3. **The build pipeline as migration *executor*.** A migration is just a BI ("codify X") → promote → Build Studio writes the deterministic version → ships. DPF can *execute its own migrations* — almost unique among platforms.
4. **The hive / commons.** A migration learned on one install propagates to all (`contribute_to_hive`, `hive-scout-ingest.ts`). Migration is a team/fleet asset, not a per-install one.
5. **The governance brake (deliberate non-migration).** Kernel veto, `decisions-belong-to-their-scope`, the UX-Fit gate, and the outbound-send kernel veto intentionally *hold* certain load at the human tier. This is a feature, not a gap.

### 3.2 DPF as a self-migration machine

- **Build Studio** = the human→AI→code engine for *platform development*. Its reliability series (plan-fix loop, verify→fix loop, watchdog quiescing-reap, escalate-to-human) is the descent happening in real time.
- **AI coworkers + surfaces** = the same engine for the *customer's business*.
- **Self-upgrade** makes it recursive: the platform migrates its own load and ships the result to itself.

### 3.3 The decision framework — when to migrate, and when not

| Move | Trigger conditions | Anti-conditions (do NOT) |
|------|--------------------|--------------------------|
| **Human → AI** | Done repeatedly; needs judgment but not irreducible authority; error is recoverable/bounded | The act is irreversible/unbounded-risk; it is a values/authority call |
| **AI → code** | Pattern stabilized (low variance across runs); decision boundary now crisp/expressible as rules; determinism, audit, cost, or latency matter; enough AI runs observed to *know* the rule | Boundary still fuzzy; long tail of exceptions; codifying would freeze a guess |
| **Code → AI (ascent)** | Deterministic rule misfires (false +/−); a guessed threshold; context the rule can't see actually matters | The rule is correct and cheap; adding a model adds cost/latency for no accuracy gain |
| **Keep at human (floor)** | Irreducible authority (kernel/governance/sovereignty); irreversible outbound act; genuine taste/values; catastrophic unbounded error cost | (n/a — but still migrate the *gather/generate/execute/verify* around it) |

The single most useful habit this framework encodes: **before tuning a magic number a second time, ask whether the judgment belongs at the AI tier; before letting an agent re-derive the same procedure a tenth time, ask whether it belongs in code.**

---

## 4. Substrate findings by locus

### 4.1 Build Studio (platform self-build)
- Pipeline: file BI → ideate → plan → (decompose) → build/codegen → review → ship → complete.
- **Tier today:** ideate = human+AI; plan = AI+code (policy matrix gates); build = code (deterministic checkpoint pipeline + watchdog); review = AI + code merge + human escalation; ship = human intent + code validation; complete = code.
- **Human floor:** ideate reusability answer; ship fork decision (PR upstream vs promote); escalation when review won't converge.
- **Descent already shipping:** plan-fix loop (`plan-on-approval.ts`), oscillation/convergence detection (`build-exec-types.ts`, feature-build types), watchdog quiescing-reap (`taskrun-watchdog.ts`), escalate-to-human (`escalate-build-to-human`), checkpoint self-heal.
- **Top AI→code candidates:** (a) escalate at the *convergence boundary* instead of after a fixed N revision rounds; (b) **pre-review structure linting** before spending an LLM reviewer; (c) watchdog **auto-recovery before escalation**; (d) pre-sandbox preflight (bundle/import-cycle) to catch ~30% of codegen failures cheaply.

### 4.2 AI Coworkers (customer + platform runtime)
- Flow: intent classification → prompt assembly (ordered context blocks, static/dynamic cache boundary) → unified agent resolve (persona/skills/grants) → tool filtering → bounded agentic loop → optional delegation.
- **Already code (~60%):** `conversation-intent.ts`, `prompt-assembler.ts`, `agent-routing.ts`, `coworker-tool-filter.ts`, `agentic-loop.ts`, `agent-grants.ts`.
- **Human floor:** triggering/steering prompts; choosing among surfaced options; verifying output; the decisions a coworker escalates.
- **Remaining AI→code candidates are mostly latency/cost optimizations** (pre-compute grant closure, static delegation manifest, cache portal-context normalization) — real but *not* the strategic story; the user does not feel a 10ms handoff. **Strategic note:** the coworker tier's biggest lever is not shrinking itself but *being the bridge* — i.e. instrumenting which agent reasoning has stabilized enough to tool-ify (→ §6).

### 4.3 Scheduled activity (reliability + the ascent direction)
- **Pure code (correct tier):** `data-retention-sweep.ts`, edge-node `heartbeat`, `discovery sweep`, `postgres-daily-backup.ts`.
- **AI-in-the-loop:** `issue-report-triage.ts` (LLM enhance), `skill-curator.ts`, `governed-backlog-tee-up.ts`.
- **The richest vein here is *ascent* (code → AI):** `taskrun-watchdog.ts` fixed per-phase timeouts → learned phase-duration quantiles (outlier detection); `code-graph-reconcile.ts` silent-stale → AI staleness escalation (it once went 13 days stale unnoticed); `skill-curator.ts` hand-coded `sourceType` classification → learned classification. These are brittle deterministic rules that *should* carry judgment.

### 4.4 Surfaces (highest customer-felt load)
- **High-load surfaces:** account bootstrap; **business-context form (8 fields)**; AI provider configuration (status-matrix interpretation); storefront archetype selection (15+ templates, no activation preview); operating-hours grid; brand extraction (async, accept/reject).
- **Already migrated (precedents):** setup-overlay COO message is context-aware LLM not static; financial-profile one-click derivation; brand pre-fill "from website" hints; **`agent-form-assist.ts` exists** (AI fills forms) — the proven human→AI path.
- **Top opportunities:** (a) auto-derive business context from brand scrape + archetype, surface only diffs; (b) provider config — auto-enable eligible, surface only *blocking* states; (c) archetype — auto-suggest with confidence + show activation profile inline; (d) operating hours — industry-aware smart defaults + timezone auto-detect.

---

## 5. Ranked opportunities (cross-locus)

| # | Opportunity | Locus | Direction | Target tier | Maps to |
|---|-------------|-------|-----------|-------------|---------|
| 1 | **Self-driving migration loop** — telemetry nominates AI→code candidates → human approves → BS codifies | Process/meta | — | new loop | Candidate epic (§6); reuses observation substrate |
| 2 | **Onboarding/business-context auto-derivation** — scrape+archetype pre-fill, diff-only review | Surfaces | H→code/AI | code+AI | extends `agent-form-assist.ts`, brand-extract |
| 3 | **Provider/config eligibility auto-resolution** — auto-enable eligible, surface only blockers | Surfaces | H→code | code | provider page rework |
| 4 | **Convergence-boundary escalation + pre-review linting** | Build Studio | AI→code | code | EP-9FC5D2FD (self-iterate/adversarial), plan-fix loop |
| 5 | **Watchdog auto-recovery before escalation** | Build Studio / Scheduled | AI→code | code | reliability series |
| 6 | **Ascent: brittle thresholds → learned/AI judgment** (watchdog timeouts, graph staleness, curator classification) | Scheduled | code→AI | AI | EP-FULL-OBS: `BI-A1FC3EBB` / `BI-12E646D3` / `BI-93FE150F` |
| 7 | **Archetype auto-suggest + activation preview** | Surfaces | H→AI | AI | storefront setup |
| 8 | **Coworker tool-ification cleanup** (grant closure, delegation manifest, context cache) | Coworkers | AI→code | code | latency/cost only — lowest strategic priority |

**Strategic ordering:** the customer feels #2/#3/#7 (surfaces); the platform compounds on #1 (the loop) and #4/#5 (self-build); #6 is the under-appreciated correctness lever. #8 is real but low-felt.

---

## 6. The keystone opportunity — a self-driving migration loop

Today migration is human-spotted. But DPF already records every AI action and already has the engine (Build Studio) to write the deterministic replacement. The missing piece is the *nomination* step.

**Proposed loop:**
1. **Observe** — a scheduled analyzer reads `ToolExecution` / `BuildActivity` / `SkillMetric` for agent reasoning sequences that recur with low variance (same tool chain, same inputs→outputs, stable across N runs).
2. **Nominate** — auto-file a `tool`/`refactor` BI ("codify X; here is the evidence: N occurrences, variance V, est. token/latency saving"). This is the *evidence-before-diagnosis* discipline applied to migration.
3. **Decide (human floor)** — operator approves the migration. This is the irreducible decision; everything around it is automated.
4. **Codify** — promote to Build Studio; it writes the deterministic tool/flow, gated by the normal evidence lifecycle.
5. **Verify & propagate** — ship; `contribute_to_hive` so every install inherits it.

The same analyzer runs **in reverse** for ascent: a deterministic job whose false-positive/defer rate exceeds a threshold is nominated for code→AI judgment.

This converts migration from a thing humans remember to do into a **standing platform capability** — and it is buildable almost entirely from existing substrate. Suggested home: a new epic (e.g. `EP-COGLOAD-MIGRATION`) or an extension of the cost epic **EP-COST-001** (token spend is the most legible migration signal) and the agent-architecture epic **EP-9FC5D2FD**.

---

## 7. What must NOT migrate (the floor — stated explicitly)

- **Kernel/governance veto** and decision-scope authority (`decisions-belong-to-their-scope`; WWMD/WWWD/WSID).
- **Irreversible outbound acts** (the outbound-send kernel veto — autonomous marketing email / LinkedIn refused by construction).
- **Data sovereignty** decisions (EP-ESTATE-SOVEREIGNTY; ownership > location).
- **Ship/promote intent** and genuine taste/values calls.

For each, migrate the *gather / generate / execute / verify* around the decision; never the decision itself. The floor is what keeps aggressive migration safe.

---

## 8. Recommended next steps

1. **Decide whether to stand up the migration loop (§6)** as its own epic or fold it into EP-COST-001 / EP-9FC5D2FD. (Founder decision — it defines a new standing capability.)
2. **Pick the first customer-surface migration** (recommend business-context auto-derivation, #2 — highest felt load, strongest existing precedent in `agent-form-assist.ts`).
3. **Ascent BIs filed (2026-06-20)** under EP-FULL-OBS — `BI-A1FC3EBB` (watchdog learned anomaly detection), `BI-12E646D3` (code-graph staleness escalation), `BI-93FE150F` (skill-curator learned classification). All `triaging`; each needs a short design pass before build (do not promote straight to build).
4. Treat §3.3 (the decision framework) as a reusable lens — candidate for promotion to a kernel principle or a `dpf-` skill ("migrate-to-the-right-tier") if it proves out.

> Note: opportunity file:line specifics were gathered by a 4-agent sweep and the cited files are confirmed to exist; exact line numbers and the precise stabilization thresholds in §6 require the normal substrate-verify + design pass before any build.
