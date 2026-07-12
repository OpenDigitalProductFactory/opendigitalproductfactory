# Research-before-spec — a governed deep-research step for ideate

- **Status:** implemented (opt-in, default off)
- **Date:** 2026-07-12
- **BI:** BI-F8C5E01C · **Epic:** EP-F7E35344 (AI Coworker Capability Inputs — Perplexity-lessons gap closure)
- **Strategy:** [`2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md`](2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md) §5

## Problem

Build Studio's ideate phase researches the **codebase** (internal) and never the **world**: standards, prior art, common pitfalls, market context. The 2026 evidence (Anthropic's multi-agent research system; brownfield studies) is that a short, *cited*, *verified* pre-spec research pass is one of the cheapest levers on spec quality — but only when it is **right-size triggered** (not run on every one-line fix), **source-cited**, and **adversarially verified** so an unsupported claim is flagged rather than laundered into the design. The web substrate already exists (`searchPublicWeb`, `fetchPublicWebsiteEvidence` — Brave-backed) and `routed-inference`; nothing composed them into a research-before-spec step.

## Design

`apps/web/lib/build/pre-spec-research.ts`:

- **`shouldRunPreSpecResearch(input)` — pure trigger.** Runs only for a *feature* that is medium+ size **or** carries elevated/high deliverable sensitivity; skips small features and all fix/chore/doc work.
- **`conductPreSpecResearch(topic, deps)`** — plan 3-5 queries → fan-out `search` (deduped by URL, capped) → `fetchSource` the top distinct sources → `synthesize` cited findings → `verifyFinding` each against its cited source. Unverifiable findings move to `caveats` (surfaced, never presented as fact). Per-step robust: a failing search/fetch is skipped, not fatal; no reachable sources → an honest empty report. Every external call is dependency-injected.
- **`makeInferenceResearchDeps({ llm, search, fetchSource })`** owns the prompt construction + JSON parsing for plan/synthesize/verify, so the caller stays thin and the parsing is unit-testable with a fake `llm`.
- **`formatResearchReportMarkdown`** renders a compact cited block for the evidence trail.

## Wiring & flag

Gated by `DPF_BUILD_PRE_SPEC_RESEARCH` (`isPreSpecResearchEnabled`, default **off** — inert, zero web-search spend until enabled and a Brave key is configured). Wired in `ideate-on-approval.ts` **after** the designDoc is persist-verified, and **strictly fail-open**: research is advisory and never fails or delays ideate (any throw is swallowed to a non-fatal `BuildActivity` note). When the trigger fires, the cited report is attached to the build's ideate evidence via `logBuildActivity`. Deliverable sensitivity is derived from the BI text with the existing `deriveDeliverableSensitivity`.

## Verification

`pre-spec-research.test.ts` (18 tests): the pure trigger matrix; the pipeline (cited/verified findings, URL dedup, unverifiable→caveats, out-of-range citations dropped, empty-sources honesty, search-throws robustness, source cap); markdown rendering; and the inference-deps JSON parsing (plan array, unparseable→[], empty-claim filter, citation-range guard, grounded verdict).

## Non-goals

Not a research *product* surface (no UI); the report is evidence, not a gate. Does not change ideate when the flag is off. Capturing research into the WWMD/WWWD wiki corpus stays with `research-capture.ts` (a different concern). The natural follow-ups are attaching the report as a first-class `designDoc.preSpecResearch` field (migration) and a design-review lens that checks the spec against the cited findings.
