# Local LLM Grading & Incremental Calibration — Design

**Status:** Draft
**Owner:** Mark Bodman (CEO) + AI platform
**Created:** 2026-04-26
**Related specs:**
- `2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md` (TAK substrate)
- Inferred: AI routing system (root-level draft files, per `project_routing_files` memory)

## 1. Problem

DPF runs all inference through an OpenAI-compatible `/v1/chat/completions` layer and routes by capability tier + task type (no provider pinning). The scaffolding is in place — `task-router.ts` enforces tier gates, `golden-tests.ts` defines dimension test fixtures, `eval-background.ts` runs as an Inngest job, `ModelProfile` carries per-dimension scores — but the grading loop has three holes that compound on local LLMs specifically:

1. **Scores are seeded, not measured.** A cold-start install never triggers eval; `ModelProfile` rows keep seed defaults (reasoning:50, codegen:50) forever. This is the root of "fresh install AI provider pain" — routing decisions are made on guesses.
2. **The orchestrator scorer is stubbed.** `eval-runner.ts:88` returns a hardcoded 5 for any LLM-graded ("orchestrator") dimension (the documented gap is right there in the comment block at `eval-runner.ts:80-88`). Conversational quality, instruction-following nuance, and creative tasks are effectively un-scored.
3. **Operational metrics aren't graded.** Tokens/sec, time-to-first-token, VRAM peak, and context-length-at-which-quality-degrades are invisible to the router. For local models on a single consumer GPU these are first-order constraints, not nice-to-haves.

Recent third-party benchmarking of 11 consumer-GPU local models (15–35B, Q4, RTX 3090) reinforced two methodology points worth adopting: (a) **hidden-trap prompts** (e.g., "dolphins aren't fish", strict word counts) separate models far better than open-ended questions, and (b) **isolated sessions with temp=0 + top_p=1.0** make rankings reproducible. Our `golden-tests.ts` fixtures today are too thin to discriminate models reliably and don't tag failure types diagnostically.

## 2. Goals

- A grading loop that produces measured `ModelProfile` scores for every active local model within minutes of provider activation, not "eventually via production drift."
- Diagnostic failure data — when a model fails dimension X, we know *which trap* it fell into, not just that it scored poorly.
- Operational metrics (tokens/sec, TTFT, VRAM, context-degradation cliff) graded alongside quality so the router can pick "fast enough + good enough" for the task tier.
- Quantization-aware grading — same prompt set across Q4/Q5/Q8 so the admin sees the actual quality/VRAM trade.
- Background-job execution end-to-end (per `feedback_background_eval_probes`).

## 3. Non-goals

- A general-purpose LLM leaderboard. We grade against DPF's dispatched task types, not against MMLU/HumanEval.
- Replacing the existing routing pipeline. This spec feeds `ModelProfile`/`EndpointTaskPerformance`; routing logic in `task-router.ts` is unchanged.
- Cloud model grading as a primary focus. Cloud providers (Anthropic, OpenAI) are graded by the same eval runner today; this spec narrows scope to local model gaps. Improvements to the orchestrator scorer (Phase 1) benefit both.
- Human-in-the-loop creative-writing scoring. Out of scope; the orchestrator scorer is the substitute.

## 4. Mental model

Treat the LLM lifecycle inside DPF as four states, each with a grading event:

| State | Trigger | Grading event |
| --- | --- | --- |
| Discovered | `/v1/models` returns a new model | Capability probe (tool-call works? structured output works?) — fast, ~30s |
| Calibrated | Provider transitions to `active` | Full dimension eval across all task types — minutes, async |
| Drifted | Production fitness score drops > 15 pts vs profile | Re-run dimension eval; alert if confirmed |
| Retired | Admin disables, or grading fails repeatedly | Excluded from routing; profile preserved for history |

Existing code already implements drift detection (`detectDrift()` in eval-runner.ts) and has the schema fields. What's missing is **the calibration trigger** and **the prompts that make grading meaningful**.

## 5. Phased delivery

Phases are independently shippable; each delivers measurable improvement without blocking later work.

### Phase 1 — Make the existing graders actually grade

Smallest, highest-leverage. Affects all models, not just local.

- **Implement the orchestrator scorer.** Replace the hardcoded `return 5` stub in `apps/web/lib/routing/eval-runner.ts:88` (`case "orchestrator"` of the `score()` switch) with a real grading call: send `{prompt, expected_traits, model_response}` to a designated grader model (frontier tier, e.g., Claude Sonnet 4.6 if available, else best local) and parse a 0–10 score with reason. The `ScoringMethod` union in `golden-tests.ts:8-15` already declares `"orchestrator"` as "LLM-graded 1-5, scaled to 0-100" — keep that contract. Cache by `(prompt_hash, response_hash)` to avoid re-grading identical outputs.
- **3× repetition at temp=0.** If outputs differ across runs at temp=0, the model is quantization-unstable — surface as a new `ModelProfile.stabilityScore` field. Catches the case where Q4 quantization makes a model non-deterministic.
- **Operational metrics during eval.** Capture `tokensPerSecond`, `timeToFirstTokenMs`, `peakVramMb` on every eval call; persist to `EndpointTaskPerformance`. Wire `peakVramMb` from Docker Model Runner / Ollama API where available, fall back to "unknown."
- **Selection-by-id query mode for golden-tests.** Today fixtures are arrays; add an indexed lookup so we can re-grade a single prompt without re-running the suite.

**Acceptance:** A cloud or local model run through eval-runner produces non-stub orchestrator scores, a stability score, and operational metrics, all visible on `/platform/ai/operations`.

**Files touched:** `golden-tests.ts`, `eval-runner.ts`, `eval-background.ts`, `ModelProfile` migration (add `stabilityScore`, `lastStabilityCheckAt`).

### Phase 2 — Hidden-trap prompt suite

Replaces the thin existing fixtures with discriminating ones. Mostly content work, no schema change.

- **10–20 prompts per dimension**, each tagged with a `trapType` enum: `category-confusion`, `numeric-threshold`, `forbidden-token`, `word-count-exact`, `format-strict`, `multi-constraint`, `factual-trap`, `reasoning-loop-bait`. Failure data becomes diagnostic.
- **Dimensions to cover** (aligned to dispatched task types, not generic categories):
  - `reasoning` — counting/threshold traps (the "fish weighing under 5 lb" pattern)
  - `instruction-following` — exact word counts, forbidden-letter constraints, multi-rule prompts
  - `structured-output` — JSON schema match, MCP tool-arg shape, no extraneous prose
  - `tool-calling` — call the right tool with the right args; don't narrate; don't hallucinate tools
  - `factual-accuracy` — true/false statement batteries (the "10 statements" pattern)
  - `coding` — single-file vanilla-JS / single-file Python tasks with verifiable behavior (run in sandbox, check output)
  - `creative` — atmospheric short-form with measurable constraints (length, mandatory elements)
- **Prompt fixtures live as files**, not inline arrays — `apps/web/lib/routing/prompts/<dimension>/<slug>.eval.md` with frontmatter (`dimension`, `trapType`, `expectedTraits`, `scoringMethod`). Mirrors the existing `.skill.md` / `.prompt.md` pattern. Seeded to a new `EvalPrompt` table with override-via-Admin parity.
- **Scoring per trap type** so admin sees: "Qwen3.5-27B passes 4/5 numeric-threshold traps but fails 0/5 forbidden-token traps." This is the diagnostic data that makes routing decisions explainable.

**Acceptance:** Eval results in `EndpointTaskPerformance` carry per-trap-type pass/fail counts, queryable in admin UI.

**Files touched:** `golden-tests.ts` (loader rewrite), new `prompts/eval/` directory, new `EvalPrompt` model + seed, `eval-runner.ts` (per-trap aggregation).

### Phase 3 — Cold-start calibration

Closes the "fresh install AI provider pain" loop.

- **Provider activation hook.** When `ModelProvider.status` transitions to `active`, fire `ai/calibration.run` Inngest event scoped to that provider's discovered models.
- **Two-tier calibration**: a fast "smoke" suite (~5 prompts per dimension, < 2 min) blocks initial routing eligibility; the full suite (~20 prompts × 7 dimensions) runs async and refines scores over the next ~10 min.
- **Confidence flag.** `ModelProfile.profileConfidence` (schema.prisma line ~1244) is the calibration signal of record (`low|medium|high`). Note: `profileConfidence` also exists on `ModelProvider`, `EndpointTaskPerformance`, and `AgentTaskInstruction`; this spec only writes to `ModelProfile.profileConfidence`. Set to `low` until smoke suite completes, `medium` after smoke, `high` after full. Router can prefer `high`-confidence models when multiple candidates tie.
- **Local-first surface in admin UI.** New `/platform/ai/calibration` page shows progress per provider during cold start: "Calibrating Ollama: 3/7 dimensions complete, ETA 4 min." This is the user-visible payoff for `feedback_zero_click_provider_setup`.
- **Recalibration on model file change.** For local providers, hash the model digest from `/v1/models` and recalibrate when it changes (covers user upgrading from Q4 to Q5 of the same model).

**Acceptance:** A fresh install with a freshly-pulled local model has measured scores in `ModelProfile` within 10 minutes of provider activation, with no admin action.

**Files touched:** New `calibration-orchestrator.ts`, new Inngest function `calibration-background.ts`, provider status change hook in `inference/ai-provider-data.ts`, new admin page.

### Phase 4 — Quantization + context-length grading

Highest-effort, narrowest audience (advanced local LLM tuning).

- **Quantization matrix.** When the local runner exposes multiple quantizations of the same base model, run the eval suite across each. Persist as separate `ModelProfile` rows tagged with `quantization` field. Admin sees a comparison table: same model, three quantizations, three sets of scores + VRAM costs.
- **Context-length sweep.** Run a subset of prompts at 1K / 8K / 32K context (padded with realistic preamble). Find the cliff where quality drops. Persist as `ModelProfile.contextDegradationProfile` (JSON array of `{ctxLength, qualityDelta}`).
- **Surface in routing.** Router gets a new candidate filter: `if request.estimatedContextTokens > model.contextDegradationProfile.cliffAt, exclude`. Directly addresses thread-accumulation token-burn (per `project_build_studio_token_optimization`).

**Acceptance:** Admin can see per-quantization scores for any local model that exposes multiple quants; router excludes models when prompt length crosses their measured cliff.

**Files touched:** `ModelProfile` schema (add `quantization`, `contextDegradationProfile`), `task-router.ts` (new filter stage), eval-runner extensions.

## 6. Schema changes (cumulative across phases)

```prisma
model ModelProfile {
  // existing fields ...
  stabilityScore              Int?      // Phase 1: 0-100, deterministic-output rate at temp=0
  lastStabilityCheckAt        DateTime? // Phase 1
  quantization                String?   // Phase 4: "Q4_K_M", "Q5_K_M", "Q8_0", null = unknown/cloud
  contextDegradationProfile   Json?     // Phase 4: [{ctxLength: 8192, qualityDelta: -3}, ...]
  modelDigest                 String?   // Phase 3: hash from /v1/models for change detection
}

model EvalPrompt {              // Phase 2
  id              String   @id @default(cuid())
  dimension       String   // reasoning | instruction-following | structured-output | tool-calling | factual-accuracy | coding | creative
  trapType        String   // category-confusion | numeric-threshold | forbidden-token | ...
  slug            String   @unique
  promptText      String
  expectedTraits  Json     // grading rubric for orchestrator scorer
  scoringMethod   String   // exact | partial | schema | tool_call | structural | orchestrator
  filePath        String   // source-of-truth path for sync
  enabled         Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model EndpointTaskPerformance {
  // existing fields ...
  trapTypeBreakdown   Json?     // Phase 2: { "numeric-threshold": {pass: 4, fail: 1}, ... }
  tokensPerSecondAvg  Float?    // Phase 1
  ttftMsAvg           Float?    // Phase 1
  peakVramMbAvg       Float?    // Phase 1, nullable for cloud models
}
```

## 7. Risks and trade-offs

- **Grader-model bias.** Using an LLM to grade LLM outputs introduces a preference loop — Claude grading Qwen may systematically favor Claude-like answers. Mitigation: use a fixed "grader of record" per dimension, document the bias openly in the admin UI, and prefer rule-based scoring (`exact`, `schema`, `tool_call`) wherever possible.
- **Eval cost.** Calibrating every discovered model on every install adds inference load. For cloud providers this costs API tokens; for local it costs GPU time during onboarding. Mitigation: smoke suite runs in < 2 min; full suite is incremental and pause-able.
- **Prompt suite rot.** Hidden-trap prompts get less effective once they're in training data. Mitigation: rotate the suite quarterly; treat the prompt files as living documents; track per-prompt discrimination power (does this prompt actually separate models?) and retire prompts that everyone passes.
- **Quantization grading combinatorics.** Cross-quantization × cross-context grading is N×M evals per model. Mitigation: Phase 4 only triggers when admin explicitly opts a model into "deep profile" — not part of cold-start.
- **Trust in the calibration UI.** If admin sees a "calibrating" spinner that never resolves, that's worse than no calibration. Mitigation: every Phase 3 calibration job has a hard timeout and writes a definite `ModelProfile.profileSource` value (`evaluated` or `eval-failed`) — no indefinite "in progress" states. (`profileSource` exists on both `ModelProvider` and `ModelProfile`; this spec writes to the `ModelProfile` field.)

## 8. How this aligns with platform principles

- **No provider pinning** (`feedback_no_provider_pinning`): grading produces dimension scores; routing picks dynamically. No phase introduces hard pins.
- **Background eval/probes** (`feedback_background_eval_probes`): all grading runs as Inngest jobs; UI is read-only against persisted scores.
- **Fix the seed, not the runtime path** (`feedback_fix_seed_not_runtime`): EvalPrompt fixtures are seeded from files, with admin overrides matching the existing `.skill.md` / `.prompt.md` precedent.
- **Zero-click provider setup** (`feedback_zero_click_provider_setup`): Phase 3 calibration is automatic on provider activation; admin sees progress, takes no action.
- **Recursive self-improvement** (`project_recursive_self_improvement`): grading data is itself a sellable artifact — DPF installs producing real-world local-model fitness data feeds the hive mind.

## 9. Open questions

1. **Grader-of-record selection.** Does the grader rotate, or stay fixed per dimension? Fixed is reproducible; rotating reduces bias loop.
2. **Sandbox for code-eval.** Phase 2 coding tasks need to actually run generated code. Reuse the existing browser-use sandbox, or spin up a separate code-runner container?
3. **Prompt sourcing.** Hand-author all eval prompts, or seed from a public benchmark (BIG-Bench-Hard subset, MT-Bench) and add DPF-specific traps?
4. **Visibility into routing decisions.** Should the routing log surface "model X excluded because contextDegradationProfile cliff at 8K, request was 12K"? Useful for debugging, but adds log volume.

## 10. Suggested next step

Phase 1 in isolation: implement the orchestrator scorer + 3× repetition + operational metrics. ~2–3 days, no schema-blocking dependencies, immediate improvement to all model grades (cloud and local). Phases 2–4 follow once Phase 1 is in production and we have real grading data to compare against.
