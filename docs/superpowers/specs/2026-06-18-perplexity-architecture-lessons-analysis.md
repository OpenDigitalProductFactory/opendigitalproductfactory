---
title: Perplexity Architecture Lessons — Closing the DPF Coworker Capability Gap
date: 2026-06-18
status: analysis (not yet a design)
author: investigation per /goal
indexes: search_specs_and_plans
---

# Perplexity Architecture Lessons — Closing the DPF Coworker Capability Gap

## Why this exists

The DPF AI-coworker thesis is: **weave specific LLMs and processes together to complete
large, comprehensive tasks — with more formality and rigor than a general chatbot.** The
machinery to do this exists and is, in places, more elaborate than Perplexity's. Yet usability
is not there, and model selection/tuning is not dialed in. This document investigates how
Perplexity achieves comparable "weaving" capability and maps the lessons to concrete DPF gaps.

**Headline finding:** DPF has *over-built the formal machinery* (two routers, execution recipes,
dimension evals, champion/challenger exploration, kernel-scored decisions) and *under-built the
three things that make Perplexity's far simpler architecture actually work in production*:

1. a **query/task classifier** that infers what a task needs (Perplexity's "Best" auto-router),
2. a **persistent plan/state object** that separates planning from execution and survives context
   compaction, and
3. **populated eval/feedback data** so the scoring sophistication rides on measurements, not
   family-tier guesses.

Plus a fourth, product-level gap: DPF **exposes orchestration internals** to users where
Perplexity hides all of it behind one input, an auto-router, and a cited answer.

Sourcing: Perplexity claims are tagged `[OFFICIAL]` / `[REPORTED]` / `[INFERRED]` with the
research appendix at the end. DPF claims cite `file:line` from the current tree.

---

## 1. The two architectures, side by side

### Perplexity's core answer engine is a *narrow, fixed pipeline*
Query → (LLM) understand/reformulate → retrieve (own crawler/index) → rerank/filter → (LLM)
synthesize with one citation per sentence → stream. `[OFFICIAL]` (Lex Fridman transcript;
LangChain BreakoutAgents case study). The "weaving" is **a small number of well-defined stages,
each served by a model chosen/tuned for that stage** — not one open-ended agent. Planning is
*separated from execution*: for Pro/Deep-Research, an LLM first emits a plan (objectives + a dozen+
sub-queries), then a loop executes it, "refining its research plan as it learns." `[OFFICIAL]`

### DPF's core is *one open-ended agentic loop*
`runAgenticLoop` ([apps/web/lib/tak/agentic-loop.ts](apps/web/lib/tak/agentic-loop.ts)) calls
`routeAndCall` **every iteration** (`:1286`), the model decides each turn, and "done" = a
**text-only reply** (`:1341`, the Anthropic `end_turn` pattern). `MAX_ITERATIONS = 200` is an
explicit *safety ceiling, not a behavioral limit* (`:34`). Critically, there is **no cross-iteration
plan/state object** — comprehensiveness rests entirely on the model re-reading a compacted 24-message
window each turn (`compactAgenticMessages`, `:873`; `MAX_AGENTIC_HISTORY_MESSAGES = 24`). Tool
outputs are truncated to 1500 chars, text to 4000.

**This is the central structural difference.** Perplexity completes a comprehensive task because
the *task shape is fixed and the plan is an explicit artifact*. DPF attempts comprehensiveness by
asking a general model to keep its bearings across up to 200 turns through a sliding window. That
is the architecture most exposed to drift, repetition, and "lost the thread" failures — and indeed
the loop is ringed with breakers that exist precisely to catch those failure modes (repetition
detector `:1223`, local-spin guard `:1197`, fabrication guard `:1545`, phase duration ceilings
`:1179`).

---

## 2. Lesson-by-lesson gap analysis

### Lesson A — A query/task classifier is the missing front door
**Perplexity:** the "Best" auto-router classifies every query by type/complexity and dispatches to
the right model; Pro Search has a documented classifier that auto-routes complex/comparative
queries. `[OFFICIAL]` (Pro Search docs) / `[REPORTED]` (Best router internals).

**DPF today:** task complexity/tier is **caller-declared, never inferred from prompt content.**
`task-router.ts` reads `taskRequirement.minimumTier` off a `TaskRequirement` row
([apps/web/lib/routing/task-router.ts:103](apps/web/lib/routing/task-router.ts)); the live path
([routed-inference.ts](apps/web/lib/inference/routed-inference.ts)) defaults `taskType` to
`"conversation"` (`:203`), which has **no entry in any reasoning-depth, tier, or dimension map**,
so it falls to neutral 50 everywhere and the quality floor never bites. In effect, most live
traffic is routed by provider-tier preference + failure-rate, not by what the task actually needs.

**Close the gap:** add a cheap, fast classification step — a single local/Haiku-class call, or a
deterministic heuristic — that infers `{archetype, complexity, requiresTools, reasoningDepth,
residency}` and writes it onto the `RequestContract` before ranking. This is the one piece of
Perplexity's router DPF is missing; the rest of the ranking machinery already exists and is more
sophisticated than Perplexity's. Cheapest first version: a rules+keyword classifier feeding the
existing `inferContract` ([request-contract.ts](apps/web/lib/routing/request-contract.ts)).

### Lesson B — Separate planning from execution with a persisted plan object
**Perplexity:** plan = explicit artifact (objectives + sub-queries); execution loop refines it.
`[OFFICIAL]`. Deep Research runs "dozens of searches, hundreds of sources," typically <3 min,
HLE 21.1% / SimpleQA 93.9%. `[OFFICIAL]`

**DPF today:** Build Studio *does* have decomposition (`decomposition.ts`,
`task-dependency-graph.ts`) and a phase state machine — but the **agentic execution loop itself**
has no durable plan; it is memoryless beyond the 24-message window. The two layers don't share a
living plan object the loop reasons against.

**Close the gap:** introduce a first-class, persisted `ExecutionPlan` (objectives → steps →
status) that (1) the loop reads at the top of every iteration *outside* the compacted window, and
(2) it updates as steps complete. This is the single highest-leverage change for "large,
comprehensive tasks." It converts the loop from "remember what you were doing" to "execute the
next open step," exactly as Perplexity's plan/execute split does.

### Lesson C — Eval/feedback data must actually be populated; cold-start is the silent killer
**Perplexity:** continuous, first-class eval — SimpleQA F-scores (Sonar Pro 0.858 / base 0.773),
human A/B testing, golden sets, human+LLM judges for R1-1776. `[OFFICIAL]`

**DPF today:** the substrate is excellent (`eval-runner.ts`, `golden-tests.ts`,
`production-feedback.ts`, `champion-challenger.ts`) — but on a real install the data is **empty**,
so every scoring decision rides `TIER_DIMENSION_BASELINES` seeded from family tier
([quality-tiers.ts:107](apps/web/lib/routing/quality-tiers.ts)), not measurements:
- Pricing metadata missing on fresh installs → `estimateCost` returns `null` → paid providers
  ranked at *half* score; this is why the crude Stage-5b `user_configured > bundled` hard tier-sort
  override exists at all ([pipeline-v2.ts:415](apps/web/lib/routing/pipeline-v2.ts)).
- `production-feedback.ts` only propagates after **5 observations** and only for
  `profileSource === "seed"` (`:42`, `:126`) → zero-traffic installs never leave baselines.
- This is the *same cold-start emptiness* as the `SkillUsageEvent` false-positive incident
  ([memory: stale-skill-curator-false-positives]) and the eval-churn GPU storm
  ([memory: eval-churn-burns-local-gpu], BI-C8164664).

**Close the gap:** (1) ship *seeded* dimension scores + pricing for the bundled/known model set so
day-1 routing isn't guessing; (2) make per-archetype golden eval sets (not just the 7 generic
dimension golden tests) so quality is tied to the task the way SimpleQA ties to factuality; (3) the
recent BI-C8164664 cooldown/in-flight guards are the right instinct — evals must run *enough to
populate scores* without the GPU storm, which the cooldown now balances.

### Lesson D — "Fine-tune the proper LLM" = tune for the job *or* make grounding mandatory
**Perplexity:** Sonar is **Llama 3.3 70B fine-tuned for factuality, citation-grounding, snippet
use, readability** `[OFFICIAL]`; Sonar Reasoning Pro is DeepSeek-R1-based `[OFFICIAL]`. Srinivas:
hallucination "is not just a problem that will be solved by a smarter model" — **the
retrieval/grounding layer carries the quality**, not just model size. `[OFFICIAL]`

**DPF today:** uses general models via routing; no task-tuned models, and grounding (kernel +
codebase RAG) is *available* (`wiki_query`, kernel embeddings, `search_design_intelligence`) but
**not mandatory inside the loop.** The agentic-loop enriches tool descriptions with failure
warnings (`enrichToolDescriptions`, `:813`) but does not force a grounding/retrieval step.

**Close the gap (two tracks):**
- *Near-term, cheap:* make grounding a **mandatory first step** for DPF-shaped tasks — retrieve
  relevant kernel principles + codebase context into the contract before the loop runs, the way
  Perplexity always retrieves before it synthesizes. This is the higher-ROI move and matches
  Srinivas's own thesis.
- *Longer-term:* fine-tune a **local model (qwen3 family, already tier=strong**,
  [quality-tiers.ts:32](apps/web/lib/routing/quality-tiers.ts)) on DPF-specific tasks (code-gen in
  DPF idioms, kernel-grounded decisions). This is the literal "fine-tuning of proper LLM" from the
  goal — but it is the *second* priority; grounding first.

### Lesson E — Usability: hide the orchestration, lead with one input + verifiable output
**Perplexity:** one input box → cited answer; "the mind hates clutter… as minimal as possible…
a better product lets you be more lazy, not less." `[OFFICIAL]`. Model choice is **auto** ("Best");
manual model pick and focus modes are *advanced affordances*, not the default. Inline citations +
a Sources panel are the trust mechanism. `[OFFICIAL]`

**DPF today:** AGENTS.md §17 already states the doctrine ("hide complexity from layman users… never
worktree names, container ids, evidence JSON"), and the UX-Fit Gate (§12) now enforces it in CI —
*because* it was violated (the #2004 raw "Context window: 22000 tokens" input). The gap is that
DPF still leads users toward orchestration concepts (model tiers, local/cloud, context windows)
where Perplexity auto-derives all of it.

**Close the gap:** (1) default to **fully automatic model selection** (DPF's `routeAndCall`
already does this — the product surface should *stop asking*); make manual override an advanced
toggle, mirroring "Best." (2) Surface **evidence as the trust artifact** the way Perplexity
surfaces sources: DPF records `record_execution_evidence` but doesn't present it to the user as a
verifiable "here's what I did and how I know it worked" panel. That is DPF's citation equivalent.
(3) **Stream the plan as it executes** (Lesson B's plan object makes this trivial) — Perplexity's
streamed step-by-step is a large part of its perceived competence and trust.

### Lesson F — DPF is *architecturally ahead* on the 2026 frontier (don't rebuild it)
Perplexity's stated 2026 direction is a **hybrid local/cloud orchestrator** ("orchestration is the
product") and a parallel "Model Council." `[OFFICIAL]` (Computex 2026). DPF *already has* the
local/cloud routing substrate (`bundled` vs `user_configured`, `local-only.ts`, the fallback
chain, champion/challenger). The gap here is **intelligence, not structure** — the local/cloud
decision is currently a crude hard tier-sort override, not a learned/measured decision. Feed it the
classifier (Lesson A) and eval data (Lesson C) and DPF's existing structure becomes the thing
Perplexity is only now building.

---

## 3. Synthesis — what "closing the gap" actually means

The instinct that DPF needs "more formality and rigor" has already been satisfied *structurally* —
arguably over-satisfied. The gap is not missing architecture. It is **four missing inputs/outputs
to the architecture that already exists**:

| # | Gap | Perplexity analogue | DPF lever (exists) | What's missing |
|---|-----|--------------------|--------------------|----------------|
| A | No task classifier | "Best" auto-router | `inferContract` / `RequestContract` | the classification step itself |
| B | No persistent plan in the loop | plan/execute split | Build Studio decomposition | a living `ExecutionPlan` the loop reads each turn |
| C | Empty eval/feedback data | SimpleQA + human A/B + golden | `eval-runner` / `production-feedback` | seeded day-1 scores + per-archetype golden sets |
| D | Grounding optional, no task-tuned model | Sonar fine-tune + always-retrieve | `wiki_query` / kernel embeddings | mandatory grounding step (then optional local fine-tune) |
| E | Orchestration exposed to users | one input + auto-router + sources | UX-Fit Gate, evidence tools | auto-default model pick + evidence-as-citation UI + streamed plan |

**Recommended priority order** (highest leverage first):
1. **B — persistent ExecutionPlan in the loop** (biggest unlock for comprehensive tasks).
2. **A — task classifier feeding the contract** (makes all existing routing actually fire).
3. **C — seed eval/pricing data + per-archetype golden sets** (stops routing from guessing).
4. **E — usability: auto-model-default + evidence-as-citation + streamed plan** (the usability gap proper).
5. **D — mandatory grounding step now; local fine-tune later** (the "tune the LLM" goal, sequenced correctly).

The through-line: **Perplexity wins with a simpler architecture because it spends its complexity
on the *inputs* (classification, planning, grounding, eval) rather than the *machinery*. DPF spent
its complexity on machinery. Closing the gap is redirecting effort to the four inputs above.**

---

## Appendix — research sourcing

Perplexity facts are corroborated across multiple independent fetches. Key `[OFFICIAL]` sources:
- Answer-engine pipeline + citation philosophy: Lex Fridman / Aravind Srinivas transcript
  (https://lexfridman.com/aravind-srinivas-transcript/).
- Plan/execute split + multi-model prompt customization: LangChain BreakoutAgents case study,
  co-produced with Perplexity (https://www.langchain.com/breakoutagents/perplexity).
- Sonar = Llama 3.3 70B fine-tuned; benchmark axes; 10× decode claim
  (https://www.perplexity.ai/hub/blog/meet-new-sonar); Cerebras 1,200 tok/s
  (https://www.cerebras.ai/press-release/cerebras-powers-perplexity-sonar-with-industrys-fastest-ai-inference).
- Sonar Reasoning Pro = DeepSeek-R1 (https://docs.perplexity.ai/getting-started/models/models/sonar-reasoning-pro).
- Deep Research loop + scale + HLE 21.1% / SimpleQA 93.9% / <3 min
  (https://www.perplexity.ai/hub/blog/introducing-perplexity-deep-research).
- pplx-embed contextual chunking models (https://research.perplexity.ai/articles/pplx-embed-state-of-the-art-embedding-models-for-web-scale-retrieval).
- SimpleQA F-scores 0.858 / 0.773 + human A/B (https://techcrunch.com/2025/01/21/perplexity-launches-sonar-an-api-for-ai-search/).
- "Orchestration is the product" / hybrid local-cloud (Computex 2026)
  (https://venturebeat.com/technology/perplexity-ai-unveils-hybrid-local-cloud-inference-system-at-computex-2026).

`[INFERRED / UNCONFIRMED]` — flag in any design doc that builds on these:
- The specific "small models route, big models synthesize" division (analysts infer it; Perplexity
  has not confirmed the routing mechanism).
- Which model powers Deep Research; exact `sonar-pro` base; "Best" router internals.

**Counter-evidence to weigh:** a Columbia Journalism Review audit reported a ~37% citation
error rate — citation *intent* ≠ measured grounding accuracy. Relevant to Lesson D/E: do not
assume grounding is free; it must be measured (Lesson C).

---

## Appendix B — Proposed epic + BI breakdown (ready to file)

Overlap check (2026-06-18, live MCP): 82 backlog items (mostly deferred stale-skill BIs +
unrelated bugs `BI-C8164664`, `BI-145214F0`); only open epic is `EP-661D395E` (Skill Verification
& Remediation, unrelated). Routing `EP-INF-*` epics are closed. **No overlap — new epic warranted.**

**Epic:** *AI Coworker Capability Inputs (Perplexity-lessons gap closure)*
- source: `user-request`; specPath: this doc.
- Rationale: Perplexity completes comprehensive tasks with a *simpler* architecture by spending
  complexity on inputs (classification, explicit planning, grounding, populated eval data) rather
  than machinery. DPF has more machinery but starves it of these inputs.

| Seq | BI title | type/workType/size | Touches | Acceptance |
|-----|----------|--------------------|---------|------------|
| 1 | Persistent ExecutionPlan object in the agentic loop | portfolio / feature / large | `agentic-loop.ts` (read plan outside compacted window each iteration; update on step completion) | loop reasons over a durable objectives→steps→status object that survives compaction; "done" = all steps closed, not just a text-only reply |
| 2 | Task/query classifier feeding the RequestContract | portfolio / feature / medium | `request-contract.ts` / `inferContract`, `routed-inference.ts` | a cheap classification step (heuristic or Haiku-class call) infers `{archetype, complexity, requiresTools, reasoningDepth, residency}` so default `taskType="conversation"` no longer bypasses all quality floors |
| 3 | Seed day-1 eval + pricing data; per-archetype golden sets | portfolio / feature / medium | `quality-tiers.ts` baselines, pricing seed, `golden-tests.ts`, `production-feedback.ts` | fresh installs route on seeded measurements, not family-tier guesses; removes the reason the crude Stage-5b `user_configured > bundled` hard override exists |
| 4 | Usability: auto-default model selection + evidence-as-citation + streamed plan | portfolio / feature / large | product surface + `record_execution_evidence` UI; consumes BI #1's plan object | users never pick a model/tier/context-window by default; evidence shown as a verifiable "what I did + how I know" panel (DPF's citation equivalent); plan streams as it executes |

Sequencing: 1 → 2 → 3 → 4 (BI #4 depends on BI #1's plan object). "Tune the proper LLM" =
mandatory-grounding-first (fold into BI #2/#3 scope), local qwen3 fine-tune as a later follow-on,
not in this epic.

*Status: NOT yet filed to the live backlog — the MCP write was gated by the permission classifier
pending explicit operator authorization to publish.*
