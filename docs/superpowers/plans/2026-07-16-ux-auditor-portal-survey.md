# Plan: UX Auditor — comprehensive portal survey (EP-UX-AUDITOR)

**Epic:** EP-UX-AUDITOR · **Spec:** docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md
**Origin:** founder directive (2026-07-16) — the coworker button-decision (BI-3237B5D6) must be validated inside a comprehensive portal survey, not spot-checked. Kernel (`principle_decide`, surface `portal-survey-approach`) recommended the FULL reusable auditor over a one-time script or thin hybrid: composite 11.51 vs 10.20 vs 4.19, high confidence, no commandment conflict. Founder ratified.

## Substrate (verified — build ON, do not reinvent)

| Concern | Existing | Path |
| --- | --- | --- |
| Route enumeration | 582-route manifest (337 pages) | `apps/web/lib/ea/route-manifest.json` |
| Per-page evaluation | `evaluate_page` MCP tool → browser-use + axe + visual-cognitive-load | `apps/web/lib/mcp-tools.ts` |
| Finding shape | `UxFinding` (severity critical\|important\|minor) | `apps/web/lib/tak/page-evaluator.ts` |
| Coworker driving | `askCoworker` / `expectRouteCoworker` | `e2e/helpers/coworker.ts` |
| Findings → backlog | `record_functional_failure_evidence` | `apps/web/lib/testing/functional-evidence.ts` |
| WCAG lens (shipped) | `AGT-903 ux-accessibility-agent` | `packages/db/data/agent_registry.json` |

The **gap** = the orchestrator that walks routes, runs evaluators per route, aggregates verdicts into one report, files findings. Verdict grammar `pass \| pass-with-minor \| concerns \| fail` (distinct from finding severity, spec §0.2).

## Phases

- **P1 — Orchestrator core (BI-A01DC56C, THIS PR).** `apps/web/lib/ux-audit/portal-survey.ts`: `planSurvey` (surveyable filter = page kind, no dynamic params, redirects folded; stable order; sample cap; page lenses to all routes, behavioral lenses to coworker routes), `runSurvey` (injected evaluators; per-route try/catch → error entry, never aborts), `verdictForFindings` (worst-severity rollup), `dedupeFindings` ({route,element,category,lens}), `aggregateReport` (portal verdict + counts). The `BUTTON_DECISION_LENS` is defined here (executed in P2). Pure + unit-tested; no coworker, no Prisma model yet.
- **P2 — First-mission run (BI-C3768478).** Wire the real evaluators: `page` = evaluate_page; `behavioral` = askCoworker, including the button-decision lens (drive coworker to a proceed/choice closeout, assert recommended-first buttons render — validates BI-3237B5D6 + the P1.5 prose fallback live). Run against the portal shell (/workspace, /business, /products, /platform, /knowledge — spec Goal 7). File findings via `record_functional_failure_evidence`. Live-verify (needs browser-use service).
- **P3 — AGT-906 ux-design-critic.** Establish the coworker (heuristic-law + agentic-AI + enterprise-density lenses) via the establish_coworker paved road; run as a deliberation pair with AGT-903. Its lenses become behavioral/page lens specs the orchestrator plans.
- **P4 — Persistence + surfacing.** `UxAuditReport` / `UxAuditFinding` Prisma models (the new-model CI gauntlet applies) + Operations Map surfacing; each run lands as a `TaskRun`.
- **P5 — AGT-907 ux-test-automator + gate + schedule.** Convert findings to browser-use regression tests (`tests/ux/`), integrate the `build/review.verify` ship gate, and schedule the weekly portal audit.

## Verification

- P1: unit tests for planner (filter/sample/lens-assignment) + aggregator (severity→verdict rollup, dedup, portal rollup) against the real transpiled source; esbuild transform-clean.
- P2+: functional — a real survey run against the live portal produces a report and files findings (structural≠functional).

## Design grounding

- Existing specs/plans reviewed: `docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md` (architect-reviewed; AGT-906/907, 22-lens rubric, deliberation-pair, first-mission) and `docs/superpowers/specs/2026-05-11-ai-routing-ux-verification-test-architecture-design.md` (5-layer verification model). No existing orchestrator walks all routes — confirmed via substrate map.
- Current code substrate reviewed: `apps/web/lib/ea/route-manifest.json`, `apps/web/lib/tak/page-evaluator.ts` (`UxFinding`/`PageEvaluation`), `e2e/helpers/coworker.ts`, `apps/web/lib/testing/functional-evidence.ts`.
- Source of truth: EP-UX-AUDITOR under the EP-UX-SYSTEM enforced-quality program.
- Decision: build the full auditor incrementally (kernel pick); P1 is the pure orchestrator core with injected evaluators so the logic is tested before the browser-use/coworker runtime is wired.
