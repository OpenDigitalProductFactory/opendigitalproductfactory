# Grok Build & Cursor — external agent-harness lessons for DPF

**Date:** 2026-08-16
**Author:** research synthesis (Claude session, operator-directed)
**Status:** advisory — research findings + filed backlog items; not a build plan
**Related BIs:** BI-5FAF3C88, BI-BD96F740, BI-E99753F9

## Why this exists

Operator ask: investigate xAI's Grok coding agent ("grokbot") and Cursor's integration/reviews, and mine their harness, behaviour, and user-interaction design for anything worth incorporating into DPF. DPF already integrates Grok as a first-class external executor (device-OAuth sign-in, `grok-desktop` capsule executor, its own hook plane at `~/.grok/hooks/`), so this is "learn from a surface we already depend on," not greenfield.

Sources were primary where possible (docs.x.ai, the open-source `xai-org/grok-build` harness, docs.cursor.com) plus independent developer bake-offs (a 146-PR / 4-bot study, indie-hacker bot comparisons, HN launch threads, Cline/Roo-Code issues). Vendor precision numbers are discounted; rumor (e.g. Grok's unpublished parameter count) is excluded.

## What "grokbot" and "Cursor" actually are

- **Grok Build** (`xai-org/grok-build`, Apache-2.0, Rust) — xAI's open-source terminal coding harness + TUI; models are `grok-code-fast-1` → `grok-4.6`. This is the artifact with transferable harness mechanics.
- **Cursor** — ships its own model (Composer 2.x) **and** co-trained Grok 4.5 on its own interaction data, reselling it first-party. Its Agent/Composer harness, run-modes, and Bugbot are the interaction-design reference.

## The transferable mechanics

### 1. The harness is a cache-optimization machine (NET-NEW to DPF)
Grok Build's speed is downstream of cache hits, not raw FLOPs. Cached input is ~10× cheaper; the docs enumerate exactly which mutations (shorten / delete / reorder any earlier message) cause a miss; every request in a session is pinned to a stable cache key (`prompt_cache_key` / `x-grok-conv-id`) so it routes to the server holding the cache. The load-bearing rule: **the conversation prefix is immutable — only append.**
→ DPF already fixed *one* violation (BI-56804810, the `enrichToolDescriptions` tools-block mutation) but has no enforced invariant against the next one, and no explicit per-capsule stable cache key. **Filed: BI-5FAF3C88.**

### 2. Three orthogonal safety planes + non-overridable hard guardrails (NET-NEW to DPF)
Both Grok Build and Cursor independently converged on separating:
- **permission** — may this call run? (Grok: Ask / Auto-classifier / Always-approve; Cursor: allowlist-instant → sandbox → cheap fast-model classifier → escalate)
- **sandbox** — what may an approved call touch? (OS-level Seatbelt/Landlock profiles, orthogonal to permission)
- **plan/edit-gate + hard guardrails** — a small fixed set (delete, external-file write, browser; Grok's plan-mode edit lockout) that **no autonomy mode can bypass**.

Plus two idioms worth lifting verbatim into DPF's gate: **"one approval is not a blank check"** (per-action, per-situation) and **weigh actions by reversibility × reach; investigate unexpected state before overwriting — it may be the user's in-progress work** (which is literally DPF's worktree-reaping scar).
→ DPF's governance gate (EP-1C37C089) currently gates on WWWD×WSID *alignment* (on-mission?) and blends "tool available" with "action safe" in the grant model. The *structural* plane is missing. **Filed: BI-BD96F740** (with BI-B54D5B65, the untriaged-reversibility-of-~180-tools gap, as a direct input to the hard-guardrail set).

### 3. Review-bot trust is calibration, not coverage (VALIDATION + tuning recipe)
Field evidence on Bugbot / CodeRabbit / Greptile / Seer:
- **Predictive severity beats volume** — trust came from a top tier whose label *meant* something (Seer "critical" = 0 FP), not from catching the most issues.
- **Quiet by default** — CodeRabbit was abandoned despite catching real bugs (2× volume, 68% mechanical noise). Noise destroys trust faster than finds build it.
- **Dismissal must feed back** — Bugbot "learned rules" + inline "remember this" durably suppress a finding-class.
- **Caveat** — 93% of findings were caught by exactly one of four reviewers; agreement is not a consensus signal. Instrument your own per-workload precision.
→ DPF's `review_semantic_change` already runs shadow-mode with outcome correlation (`record_semantic_review_outcome`, `semantic-review-enforcement.ts`) — exactly the right posture. The missing piece is the calibration layer that lets a tier responsibly flip shadow→enforce. **Filed: BI-E99753F9.**

### 4. Completion must be verified, never self-reported (VALIDATION)
Grok's most-reported failure is "getthereitis" — under load it declares partial success and stops ("solved 200/400 tests, rest later"). Overconfident + fast is the dangerous combination: it burns consequential actions before a human intervenes. This externally validates DPF's structural≠functional commandment and the pregate-evidence-guard's deny-on-positive posture: **an agent's own "done" is not evidence.**

### 5. Reasoning-effort as a per-phase dial (VALIDATION — unblocks a dormant epic)
Grok ships `reasoning_effort: low|medium|high|xhigh` with an explicit rec: `low` = agentic tool-calling, high/xhigh = hard reasoning. That is precisely DPF's dormant reasoning-economy effort-warrant lever — map build phases to effort (low for mechanical edit/grep/test loops, high for design/architecture review). External proof the knob is worth wiring.

### 6. Right-size the model: fast implementer under a strong planner (VALIDATION)
The consensus Grok workflow is a cheap-fast implementer driven by an Opus/GPT-5 planner that sets scope + acceptance criteria. Confirms DPF's build-studio right-sizing matrix; worth encoding explicitly rather than handing broad autonomy to the cheap model.

## Lower-priority / strategic notes
- **Attempted-vs-successful tool-call accounting** — Grok bills only *successful* calls; failed calls are free trajectory noise. Clean observability split for `analyze_mcp_call_efficiency`.
- **Cursor's UX regression as an anti-pattern** — its agent-centric 2.0 UI *lost* granular per-change diff review → "it changed files it didn't tell me about" distrust. As Build Studio gets more autonomous, preserve per-change reject + an accurate "what I actually changed" ledger (execution-evidence records are well-positioned).
- **The Grok-4.5 / Cursor data flywheel** — Cursor turned proprietary interaction traces into a co-trained frontier model. DPF — and the Customer 0 organization running it — sits on comparable cross-install governed-decision data; instrument it as a curatable corpus, but the privacy model must lead (Cursor's "paths encrypted, code never stored plaintext, decrypt client-side" as the hard constraint before any cross-install learning ships).

## Net assessment
Most findings **validate DPF's existing direction and supply tuning recipes for already-half-built work** (shadow-mode review, dormant reasoning-economy, right-sizing, structural≠functional). The genuinely *net-new* candidates are the two structural refactors filed as BI-5FAF3C88 (cache invariant) and BI-BD96F740 (three-plane safety), plus the review-calibration BI-E99753F9.
