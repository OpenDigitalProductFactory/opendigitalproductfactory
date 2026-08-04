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
- **P2 — First-mission run (BI-C3768478, SHIPPED).** Wire the real evaluators: `page` = evaluate_page; `behavioral` = askCoworker, including the button-decision lens (drive coworker to a proceed/choice closeout, assert recommended-first buttons render — validates BI-3237B5D6 + the P1.5 prose fallback live). Run against the portal shell (spec Goal 7). File findings via `record_functional_failure_evidence`. Live-verify (needs browser-use service). See §P2 delivered below.
- **P3 — AGT-906 ux-design-critic.** Establish the coworker (heuristic-law + agentic-AI + enterprise-density lenses) via the establish_coworker paved road; run as a deliberation pair with AGT-903. Its lenses become behavioral/page lens specs the orchestrator plans.
- **P4 — Persistence + surfacing.** `UxAuditReport` / `UxAuditFinding` Prisma models (the new-model CI gauntlet applies) + Operations Map surfacing; each run lands as a `TaskRun`.
- **P5 — AGT-907 ux-test-automator + gate + schedule.** Convert findings to browser-use regression tests (`tests/ux/`), integrate the `build/review.verify` ship gate, and schedule the weekly portal audit.

## P2 delivered — first-mission run

**Modules.** `apps/web/lib/ux-audit/`:

| Module | Role |
| --- | --- |
| `page-lens.ts` | Adapts the `evaluate_page` MCP tool into `PageLensEvaluator`; normalizes model-produced findings and the 0-1 `visualCognitiveLoad` signal into `UxFinding[]`. Throws on a NOT-RUN so the route reports an error, never a false clean. |
| `button-decision-lens.ts` | Pure verdict logic for `BUTTON_DECISION_LENS`. Given a live observation (reply text, buttons in DOM order, recommended flags) it decides whether a decision closeout produced clickable, recommended-first buttons. |
| `portal-shell.ts` | Derives the survey target set from the shipped navigation model. |
| `dpf-mcp-client.ts` | `tools/call` over HTTP with `${VAR}` placeholder expansion, so the out-of-process auditor stays on the governed tool path. |

The runner is `e2e/ux-audit/portal-survey.spec.ts`, opt-in under `--project=ux-audit`:

```
DPF_RECORD_FUNCTIONAL_FAILURES=1 pnpm test:e2e -- --project=ux-audit
```

**Target-set correction.** Spec Goal 7 names `/workspace`, `/business`, `/products`, `/platform`, `/knowledge`. Those five are the *recommended areas* from the 2026-04-17 portal-nav-consolidation spec §6.2 — section identities, not routes. `/business` and `/products` have never existed as pages, and the shipped model has since split Delivery out as a sixth section. So the survey derives one home per `PORTAL_SHELL_SECTIONS` key (lowest `primaryOrder` shell-nav entry) instead of surveying two 404s. The target set follows the app rail as it evolves.

**Two origins, not one.** Playwright drives the portal from the host (`localhost:3000`); `evaluate_page` runs inside the browser-use container, where `localhost` is the sidecar and the portal answers only as `portal:3000`. Verified on-machine. Pointing the page lens at localhost yields a navigation failure that the tool previously reported as a clean page.

**Defect found and fixed in this phase — `evaluate_page` reported false cleans.** `browse_extract` answers HTTP 200 with `status: "completed"` even when its agent failed every step; the payload is then `AgentHistoryList(all_results=[], all_model_outputs=[])`. The handler's parse swallowed that into `findings = []`, so the tool announced "Found 0 UX/accessibility issues" for a page it had never analyzed. `interpretExtraction` (`lib/tak/page-evaluator.ts`) now separates a genuinely clean page (`[]`) from a run that never happened, and the handler returns the existing NOT-RUN shape. This extends the BI-1BAA177C contract, which only covered the case where browser-use self-reported `degraded`.

### First-mission run — 2026-08-04

The survey ran end to end against the live portal at `localhost:3000` and produced a real
`UxAuditReport`. What the machinery proved, and what it did NOT:

**Proven.** `planSurvey` → `runSurvey` → per-lens isolation → `aggregateReport` → artifact,
against the live portal with a real authenticated session. The page lens correctly reported
`page: evaluate_page did NOT RUN for /workspace: Page evaluation DEGRADED — bad marshal data`
instead of a clean page — the `interpretExtraction` fix working in production. The behavioral
lens drove a real coworker on a real route and read back its rendered turn.

**Not proven — the button-decision lens has not yet observed rendered buttons live.** Two
host-level outages block it, both filed:

| Blocker | Effect | Filed |
| --- | --- | --- |
| browser-use sidecar down (pinned model absent, then `bad marshal data`) | page lens reports NOT-RUN on every route | BI-D26CEBBB |
| Local inference engine unusable — the only chat model is a 30B MoE at 4096 context; a 16-token completion does not return in 180s on a warm model | coworker answers "AI providers are momentarily busy", so no decision closeout is ever produced | BI-32631D86 |

The lens behaved correctly throughout: it emits no finding when the coworker did not close on
a decision, and — after this run exposed the gap — a **critical NOT-RUN** when the reply is an
inference-failure notice, so a saturated engine can never read as "no decision offered,
nothing wrong". Re-run once either blocker clears:

```
DPF_RECORD_FUNCTIONAL_FAILURES=1 pnpm test:e2e -- --project=ux-audit
```

**Operational notes for the next runner.** The survey persists its report after EACH route,
because a long live-inference run is exactly the job an outer process budget cuts short and an
all-at-the-end write loses every route that did complete. `DPF_UX_AUDIT_ROUTES` scopes a run to
a slice. On Windows/Git Bash, pass `MSYS_NO_PATHCONV=1` or the leading slash is rewritten into a
native path (`/workspace` → `C:/Program Files/Git/workspace`) and the survey silently plans zero
routes; the runner also tolerates a missing leading slash.

## Verification

- P1: unit tests for planner (filter/sample/lens-assignment) + aggregator (severity→verdict rollup, dedup, portal rollup) against the real transpiled source; esbuild transform-clean.
- P2: unit tests for the button-decision verdict rules (closeout detection, carrier attribution, recommended-first ordering, unlabeled buttons, panel-absent and empty-reply NOT-RUNs), the evaluate_page normalizer, `interpretExtraction`, the MCP config resolver, and the derived shell target set against the real route manifest. **Functional:** a real survey run against the live portal at localhost:3000 produces a `UxAuditReport` artifact and files findings — structural ≠ functional.
- P3+: as each new lens lands, its verdict logic is unit-tested pure and its live behavior proven by a survey run.

## Design grounding

- Existing specs/plans reviewed: `docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md` (architect-reviewed; AGT-906/907, 22-lens rubric, deliberation-pair, first-mission) and `docs/superpowers/specs/2026-05-11-ai-routing-ux-verification-test-architecture-design.md` (5-layer verification model). No existing orchestrator walks all routes — confirmed via substrate map.
- Current code substrate reviewed: `apps/web/lib/ea/route-manifest.json`, `apps/web/lib/tak/page-evaluator.ts` (`UxFinding`/`PageEvaluation`), `e2e/helpers/coworker.ts`, `apps/web/lib/testing/functional-evidence.ts`.
- Source of truth: EP-UX-AUDITOR under the EP-UX-SYSTEM enforced-quality program.
- Decision: build the full auditor incrementally (kernel pick); P1 is the pure orchestrator core with injected evaluators so the logic is tested before the browser-use/coworker runtime is wired.
