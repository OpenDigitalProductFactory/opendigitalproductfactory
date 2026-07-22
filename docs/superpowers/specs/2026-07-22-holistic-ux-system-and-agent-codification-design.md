# Holistic UX System — design system, agent codification, and enforced UX quality across all development surfaces

- **Status:** draft (research-backed; implementation phased via epic)
- **Date:** 2026-07-22
- **Epic:** EP-UX-SYSTEM (created with this spec) · tactical sibling: EP-UX-COGLOAD
- **Capsule:** WC-B895C366 · Epic-shape decision: `principle_decide` DI-14897C4D0792 (new-epic-two-track, high confidence, margin 2.59)
- **Related:** [`2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md`](2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md) §8/R8 · [`2026-07-12-ux-design-capability-stage-design.md`](2026-07-12-ux-design-capability-stage-design.md) · [`2026-05-16-ux-auditor-coworker-design.md`](2026-05-16-ux-auditor-coworker-design.md) (unbuilt) · [`2026-03-20-ux-usability-standards-design.md`](2026-03-20-ux-usability-standards-design.md) · `docs/platform-usability-standards.md`

## 1. Problem

Every iteration on the platform tends to add **more wall-of-text**, not a better human experience. The recent EP-UX-COGLOAD sweep fixed usability at the *functional* level (40 tactical per-surface items), but nothing prevents the next 40: UX design, consistency, and elegance have no holistic, systematic owner. The founder's framing, which this spec adopts as the acceptance bar:

> AI agents are notoriously not great at human interface design. We need a systematic approach so that this concern is effectively met by **any development surface**, and **tested in the system** once we have a target.

This is not a prompt problem to be patched with more prose. It is a missing **system**: the platform lacks (a) a design system that can express density/hierarchy/disclosure at all, (b) a codified, machine-readable definition of "good" that generation can be constrained by, and (c) evaluation that actually runs and actually blocks.

## 2. Live-state evidence (verified 2026-07-22 on the canonical install)

Three independent mechanisms in the existing UX-quality chain are **dark or toothless in production, silently**:

1. **The design brain is dark.** `search_design_intelligence` / `generate_design_system` return empty for *every* query (verified live: "dashboard" over the 99-row ux-guidelines domain → no results). Root cause: `apps/web/lib/design-intelligence.ts` reads CSVs from `join(process.cwd(), "apps/web/data/design-intelligence")`; the production image copies only the Next standalone output (no `outputFileTracingIncludes`, no Dockerfile COPY of `apps/web/data/`), and `loadDomain()` swallows the read failure with `catch { return [] }`. Build Studio's FRONTEND_ENGINEER prompt makes calling these tools **mandatory STEP 0 before writing any UI** — that step has been a silent no-op for every production build. Filed: **BI-018AE129**.
2. **Runtime UX evaluation is dark.** `evaluate_page` against the live login page returned `{findings: [], screenshot: null, visualCognitiveLoad: null}` with no error, while the healthy-looking `dpf-browser-use-1` sidecar logged its agent aborting (`BrowserStateRequestEvent` → None 6/6, "Stopping due to 5 consecutive failures") and **still returned 200 OK**. The screenshot LLM-judge (`visual-cognitive-load.ts`) and axe categorizer (`page-evaluator.ts`) exist in code but can never fire. The ship-gating `run_ux_test` rides the same sidecar. Filed: **BI-1BAA177C**.
3. **The named "UX" gates verify prose, not properties.** `check-ux-fit-decision.mjs` and `check-design-grounding-decision.mjs` pass on the *presence of a trailer/grounding text* (the UX-Fit script's own header calls it a "conscious-attestation MVP"). The Build Studio static UI scan (`runUiQualityGate` → `scanUiSource`) is real but **warn-never-block**, covers color/a11y smells only, and runs on the embedded surface only — external Claude/Codex/Grok builds never execute it.

The systemic pattern across all three: **UX quality signals degrade to "no findings" instead of failing loud.** The platform currently cannot distinguish "the UX is fine" from "UX checking is off." (`structural-verification-is-not-functional` applies to the checkers themselves.)

## 3. Current substrate — what exists, honestly classified

Enforcement legend: **prose** · **attestation** (trailer exists) · **static** (regex/diff scan) · **runtime** (executes against a rendered page).

| Layer | What exists | Level | Reality check |
|---|---|---|---|
| Color tokens | `--dpf-*` roles in `globals.css` (~174 lines: color, font-family, tap-target, loading keyframes) | static (ratchet guards) | Solid — but it is a **color system, not a design system**: no spacing scale, no type scale, no density tokens, no layout/grid primitives, no elevation |
| Status semantics | `statusColors.ts` intent registry (~60 domains → 6 intents) | static (`check-no-local-status-color`) | Genuinely centralized and enforced |
| Components | `report-kit/` (badges, KPI/stat cards, tables, filters, charts, empty states), `ui/form/` (a11y submit contract), `Dialog` | static-adjacent (guards ban the alternatives) | Real primitives, all tested; coverage stops at reporting/forms/dialogs |
| Hygiene guards | hex/status-map/hand-rolled-loading/native-dialog/dialog-in-transition ratchets via `check-guards.mjs` | static, blocking | Narrow, code-shaped invariants; nothing measures density/hierarchy/text mass |
| Standards | `platform-usability-standards.md` (contrast, forms, loading, disclosure constructs, readability tiers w/ Flesch-Kincaid policy, shell action-result contract) | prose | Comprehensive and current — and a document |
| Wall-of-text metric | `owner-first/ux-audit.ts`: `countWords/countControls/countSmallControls/countGenericDecisionLabels/hasOwnerFirstNextAction` + `OWNER_FIRST_SUMMARY_THRESHOLDS` (≤160 words, ≤12 controls, 0 tiny text, 0 generic labels, next-action required) | exercised by **2 unit tests** | **Exactly the metric the founder wants — orphaned.** Measures one summary band; no route sweep, no gate |
| Screenshot judge | `visual-cognitive-load.ts` (vision-LLM, 0–1 cognitiveLoad/visualDensity/controlCount; spike-verified 0.10 clean vs 0.75 dense) | runtime, best-effort | Gates nothing; currently can't run at all (BI-1BAA177C) |
| Design knowledge | design-intelligence CSVs (67 styles, 99 UX guidelines, 161 reasoning rules) + `ui-ux-pro-max` skill | prose/advisory | Dark in production (BI-018AE129); guidance partly **contradicts** the enforced guards (teaches `animate-pulse`, `bg-primary`, undefined `shadow-dpf-*` tokens) |
| UX auditor coworker | AGT-906 `ux-design-critic` + AGT-907 `ux-test-automator` spec (Hick/Fitts/Miller/Doherty + density lenses, deliberation pair, weekly shell audit) | prose | **Designed 2026-05-16, zero implementation**; AGT-903's specialist prompt was removed 2026-04-20 |
| Pipeline stage | `ui-quality-checks.ts` + `design-directions.ts` (propose-N) per the 2026-07-12 capability-stage spec | static, advisory | Warn-never-block; directions primitive unwired to ideate; **its epic/BI (EP-F7E35344/BI-66656F61) were never created in the live backlog — the R8 thread is orphaned** |
| Gating UX check | `run_ux_test` (browser-use, screenshots, blocks ship) | runtime, blocking | Verifies **acceptance criteria**, not design quality; rides the broken sidecar |
| Visual regression / axe in CI | — | — | **None** (explicit non-goal of the 2026-03-20 spec; never revisited) |

**Summary:** mature bottom layer (color/status/form/dialog hygiene, mechanically enforced), empty top layer (no codified, testable definition of good UX), and a middle layer that is either advisory, attestation-only, orphaned, or dark.

## 4. Root causes — why iterations add wall-of-text

- **RC1 — Nothing penalizes text mass.** Generation optimizes for completeness; no budget (words, choices, sections, actions) exists per screen, so prose accretes monotonically. The one threshold set that exists (`OWNER_FIRST_SUMMARY_THRESHOLDS`) is wired to two unit tests.
- **RC2 — The design system cannot express the problem.** Density, hierarchy, spacing, type scale, and disclosure have no tokens or primitives; "wall of text" is literally inexpressible in the enforced vocabulary, so no ratchet can catch it.
- **RC3 — Gates read attestations, not artifacts.** A PR carries a `UX-Fit-Decision:` trailer regardless of what the UI looks like; the only real scan is advisory and single-surface.
- **RC4 — No one looks at the screen before merge.** Review is code-diff-shaped; screenshots, visual regression, and the LLM judge are absent from the PR plane.
- **RC5 — The knowledge substrate is dark and self-contradictory.** The mandatory design-guidance call returns empty in production; where prose guidance exists it partly conflicts with the enforced guards (prompt-vs-reality drift).
- **RC6 — Fixes stay bespoke.** The owner-first/progressive-disclosure wave produced per-surface modules, not platform primitives with defaults, so every net-new surface regresses to the model's house style by default.
- **RC7 — Improvement threads lose their owner.** The R8 capability stage and the AGT-906 auditor were both designed and then orphaned (no live epic/BI, no implementation) — process evidence that UX quality work needs a durable epic home, not one-off specs.

## 5. Research & Benchmarking

*(Cited findings from the adversarially-verified deep-research pass — integrated below; full report attached to the epic as evidence.)*

<!-- RESEARCH-SECTION: filled from deep-research report -->

## 6. Target architecture

<!-- TARGET-SECTION: layered architecture L0–L6, filled with research grounding -->

## 7. Scoped redesign going forward

<!-- REDESIGN-SECTION -->

## 8. Phasing & backlog coverage

<!-- PHASING-SECTION: BIs under EP-UX-SYSTEM -->

## 9. Non-goals

<!-- NON-GOALS -->

## 10. Verification

<!-- VERIFICATION: how the system itself is tested, incl. fail-loud capability probes -->
