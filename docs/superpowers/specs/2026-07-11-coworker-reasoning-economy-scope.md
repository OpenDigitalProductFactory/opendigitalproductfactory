# AI Coworker Reasoning Economy — program scope

- **Epic:** EP-27FD96BC
- **Kernel ledger (structure):** DI-A30D9C7D31C5 — `principle_decide` scored 3 structures; **single umbrella epic, cross-linked** to the existing epics (high confidence, margin 0.97) over a multi-epic program or extending-existing-only.
- **Date:** 2026-07-11
- **Status:** Scoped — 12 BIs filed + triaged `build`. Kickoff goal below.
- **Composes with (does not duplicate):** EP-CTX-001 (context arbitrator / token economy), EP-8C706944 (coworker memory — completed), EP-CLAUDE-INSIDE-OUT (harness parity, subagent fan-out), EP-0AF96937 (decision-governance / page-perception).

## 1. Problem

An AI coworker should get its job done **appropriately and efficiently**: draw on the right information plane, load the minimum tokens, surface only the tools and skills that fit the task, take on the right altitude of work (delegate or escalate what shouldn't be tackled inline), and run an agentic loop tuned to all of that — with ambiguity and operator cognitive load removed. Today each of those is handled by a separate mechanism, and the mechanisms don't talk to each other.

## 2. Substrate audit — what already exists (grounded, two parallel audits)

DPF is **not green-field here**. It has rich measurement and several *active* size-bounding mechanisms:

| Area | Exists | Active or measured-only |
|---|---|---|
| Context-injection arbitrator (EP-CTX-001) | `context-arbitrator.ts` — priority L0/L1/L2, drops/compresses sources | **Active**, but governs only a ~1–6k slice and is decoupled from the real ~24,576-token window; budget is route-derived, `chars/4` estimated |
| Context pressure / economy telemetry | `context-pressure.ts`, `context-economy-metrics.ts` (surfaceZone, toolAccuracy, cliff=15) | **Measured-only** — logged, nothing acts on it |
| Tool-result clamp (P6) | `tool-result-budget.ts` | **Active / enforced** (window-proportional) |
| Per-agent daily spend gate (EP-COST-001) | `budget-gate.ts` + `ai-inference.ts` | **Active hard-reject at 100%**, but coarse (daily, per-agent); the promised **95% model downgrade is unimplemented** |
| Tool-surface right-sizing | `coworker-tool-budget.ts` (attachment budget + `load_tools` deferred load + auto-load-on-direct-call), `coworker-tool-filter.ts` (build-phase + advise/act) | **Active**, but cap targets **window-fit (~38–48)**, not the ~15-tool accuracy cliff; tiering is **static per agent + build-phase**, never task-intent |
| Skills | progressive disclosure (summaries resident, bodies on invoke), `skills/runtime.ts` | **Active**; eligibility **not relevance-ranked** → growing summary tax |
| Loop effort | `classifyTask.reasoningDepth` → model tier/effort + reasoning budget | **Active for model only**; iterations **fixed at 200**, duration by tool-presence proxy, tools by window |
| Delegation | `request_coworker`, `summon_coworker`, `spawn_work_thread`, `subagent-fanout-pack`, `DelegationChain`, authority gates, depth caps | Primitives **active**; **no decision layer** chooses among them; `hitlTierDefault` is inert metadata |
| Corpus enrichment | `enrichOrgCorpus` façade (sources: onboarding + AI research), vectorized `wiki-pages` | **Active**, but **not fed from memory** |
| Operational-record tools | `list/get/create` for CustomerAccount / Opportunity / Quote + 1 finance aggregate | **Active but ~3 of ~19 models**; page-data injection is a hand-maintained 17-prefix allow-list |

**The diagnosis both audits reach:** the pieces exist, but they're driven by *unrelated inputs*, almost no telemetry feeds back into behavior, and three real greenfields remain (delegation decision, record coverage, memory→corpus promotion).

## 3. The six pillars (→ 12 filed BIs, all EP-27FD96BC)

- **P1 — Unified effort-warrant signal (spine).** `BI-DA26BF90` — one per-turn complexity/altitude signal (extend `classifyTask`) that co-tunes model + iterations + duration + tool-budget + the delegation decision. Replaces "three knobs, three unrelated inputs."
- **P2 — Close the measure→act loops (token economy made active).** `BI-E8BCA547` spend-aware loop + activate the dead 95% downgrade · `BI-3C8220ED` overload→trim / accuracy→act feedback · `BI-2B2F59EB` accuracy-cliff-aware tool cap · `BI-9893614D` activate dark savings (`run_tool_script` 37–98% cut, programmatic tool calling).
- **P3 — Task-driven tool & skill right-sizing.** `BI-ACE1EBA4` task-intent tool prioritization · `BI-2435BD7F` relevance-ranked skill eligibility.
- **P4 — Delegation & altitude decision layer (greenfield).** `BI-8167C9CD` — classifier + policy mapping altitude/complexity/HITL-tier → {inline, request_coworker, spawn fan-out, escalate to human}; wire `hitlTierDefault` as a runtime gate; make the loop *choose*.
- **P5 — Information-plane completeness (3 planes + 2 bridges).** `BI-BC37727B` memory→corpus automatic promotion (enrichOrgCorpus memory-source adapter) · `BI-97BF837B` system-of-record→coworker read/act tool + route-context convention/generator (~3/19 → systematic) · `BI-223E55DA` JIT-retrieval discipline (pointers not copies; never memorize/vectorize live records).
- **P6 — Cognitive-load removal & ambiguity reduction.** `BI-0806FFF5` — kernel-routed clarify-vs-proceed, ask-less / act-on-recommendation, progressive disclosure.

## 4. Research & Benchmarking (AGENTS.md §10)

Anchored to the same body used for EP-8C706944 plus the context-engineering work: Anthropic **context engineering** (attention budget, just-in-time retrieval, compaction, sub-agent fan-out for context hygiene), Anthropic **memory + context-editing** (84% token savings), **programmatic / code-mode tool calling** (the P7 `run_tool_script` 37–98% cut this epic activates), and the agent-memory literature (mem0 consolidation, Letta sleep-time compute). The DPF-specific gap vs. that body is not *mechanism* (mostly built) but **a unified control signal + feedback loops** — which is this epic's spine.

## 5. Guardrails for the kickoff thread

- **Substrate-verify-first on every BI** — the audit shows most mechanisms exist; the work is wiring/ranking/deciding, not green-field. Do not add a new classifier/store/table where the existing seam carries it (the two audits already name the reuse target per BI).
- **One concern per PR**, DCO, plan doc per BI, UX-Fit-Decision on any UI-impacting BI (P6, parts of P5), kernel-route any work-scope/altitude sub-decision.
- **Beware stale checkouts** — cut worktrees from `origin/main`; the second audit ran a stale branch and false-reported merged files as absent.

## 6. Verification (program-level, post-delivery)

Each BI carries its own build-gate evidence. Program proof points: a trivial turn uses fewer iterations + a cheaper model + a smaller tool set than a complex one from *one* signal (P1); a turn nearing budget downgrades instead of rejecting (P2); a coworker delegates a cross-capability task instead of flailing inline (P4); an org-durable fact learned in chat appears in the WWWD corpus next day (P5-A); a coworker on an invoice page can read that invoice via a tool (P5-B).
