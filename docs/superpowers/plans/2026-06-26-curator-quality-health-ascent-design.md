# Curator quality-health ascent — design pass

- **BI:** BI-93FE150F — "Ascent (code→AI): skill-curator learned signal classification instead of hand-coded sourceType rules"
- **Epic:** EP-FULL-OBS
- **Date:** 2026-06-26
- **Status:** design pass complete; deterministic floor shipped with this doc; learned ascent deferred (conditional — see §5)

## 0. TL;DR

The BI asks to replace a "hand-coded per-sourceType switch over SkillMetric
performance/regression/drift" with a learned classifier. **That switch does not
exist.** The shipped curator classifier (`classifySkillLifecycle`) is a crisp
5-rule function over presence-of-use signals. Per the platform's own
bridge-pattern doctrine — AI ascends only where a boundary is genuinely *fuzzy*,
then re-descends to deterministic code once thresholds stabilise — replacing a
crisp classifier with a learned one would be over-engineering.

There **is** a real gap, but it is the opposite of "too hand-coded": the curator
collects `usage30d.failed` and then **ignores it entirely**. It is blind to
whether the invocations it counts succeed. This pass closes that blind spot
deterministically (`assessSkillQuality`, shipped here) and **re-scopes** the BI
from "make it learned" to "make it see failures; ascend only if the
regression-vs-noise boundary later proves fuzzy."

## 1. What the BI assumed vs. what the code is

| BI premise | Reality in `main` |
|---|---|
| Classifies `SkillMetric` performance/regression/drift | Classifies operational **lifecycle**: `active / stale / pinned / quarantined / archived` |
| Via a "hand-coded per-sourceType switch" | Via `classifySkillLifecycle` — 5 ordered rules, no `sourceType` anywhere |
| Naive about combinations → "mislabels regression vs noise" | Never evaluates regression **at all** — it reads `failed` and discards it |

Evidence:
- `apps/web/lib/skills/lifecycle.ts:70` — `classifySkillLifecycle(input)`; rules at `:78-90` key only on `hasContent`, `assignmentCount`, `usage30d.invoked === 0`.
- `apps/web/lib/skills/curator.ts:88-94` — builds `usageMap` with both `invoked` and `failed`; `:119-126` passes only `{ invoked, failed }` into the classifier as `usage30d`, which then **uses `invoked` only**.
- `apps/web/lib/skills/types.ts:7-14` — `SKILL_USAGE_PHASES = [eligible, loaded, invoked, completed, failed, rated]`.
- `apps/web/lib/tak/agentic-loop.ts:2277` — terminal phase is `toolResult.success ? "completed" : "failed"`; `apps/web/lib/actions/agent-coworker.ts:903` records `invoked` at start. So `invoked` = total invocations and `failed` = the failure subset → `failed / invoked ∈ [0,1]`.

The BI was filed 2026-06-20 from the migration analysis; the description tracked
an *envisioned* richer curator, not the shipped one. We honour the intent
(catch quality regressions the rules miss), not the stale letter.

## 2. The bridge-pattern test (does this boundary warrant AI?)

Doctrine (AGENTS.md / `project_cognitive_load_migration` — "tool-ification =
AI→code"; ascent is *temporary scaffolding* that re-descends once the boundary
is crisp):

- **Lifecycle boundary — CRISP.** "Has it been invoked in 30 days? Does it have
  a body? Is it assigned?" are binary facts. A learned model here adds a model
  dependency, non-determinism, and re-descent machinery to reproduce a correct
  5-line function. **Keep deterministic. Do not ascend.**
- **Quality boundary — POTENTIALLY FUZZY.** "Is a 25% failure rate over 8
  invocations a regression or noise?" depends on volume, trend, and baseline.
  This is the only place a learned step could earn its keep — and only after a
  deterministic floor proves insufficient.

## 3. The real gap: failure-blindness

A skill invoked 100× with 95 failures is `active` ("in use") under the current
rules — a silent quality hole. The data to catch it is **already collected and
already discarded**. Closing this needs no new telemetry, no new query, no
model: just *read the number the curator already has*.

## 4. Deterministic floor — shipped with this pass

`apps/web/lib/skills/quality.ts` — `assessSkillQuality({ invoked, failed })`:

- Verdict ∈ `healthy | elevated-failures | regressing | insufficient-data`.
- Explicit, named, reviewable thresholds: `MIN_INVOCATIONS_FOR_QUALITY = 5`
  (small-sample noise guard), `ELEVATED_FAILURE_RATE = 0.2`,
  `REGRESSING_FAILURE_RATE = 0.5`.
- Pure (no DB, no clock); clamps defensively; fully unit-tested
  (`quality.test.ts`).

These three constants are deliberately the **learnable surface**: if/when a
learned step is justified, it tunes exactly these, and re-descends by writing
the tuned values back here.

This PR ships the function and its tests **only** — it does not yet wire into
the curator. The wiring is a behaviour change (report shape / signals /
transitions) and belongs to a reviewed follow-up (§5), not bundled with the
design pass.

## 5. Wiring roadmap (deferred — each step gated on the prior's evidence)

1. **v1 — record-only.** Curator computes `assessSkillQuality` per skill and
   records the verdict in the `curator-report` TaskArtifact (and per
   `CuratorFinding`). No new signals, no transition changes — pure observability
   so operators (and we) can see the distribution before acting. *Small, safe,
   reversible.*
2. **v2 — governed action (needs policy review).** Promote `regressing` to an
   `ImprovementSignal` (deduped like the lifecycle findings) and/or let it
   influence lifecycle (e.g. suggest — never auto — quarantine). Threshold and
   noise budget are an operator decision; do not ship unattended.
3. **v3 — learned ascent (conditional).** ONLY if v1/v2 evidence shows the
   deterministic thresholds genuinely mislabel (regression vs noise) across
   volume/trend. Feature-extract from `SkillMetric` history (trend, baseline
   delta, agent volatility) into a lightweight classifier via
   `resolve_model_selection`, with the deterministic floor as the always-on
   fallback. **Re-descent criterion:** once the learned thresholds stabilise
   (low variance over N curator runs), codify them back into the §4 constants
   and retire the model — the bridge has served its purpose.

## 6. Recommendation

- **Re-scope BI-93FE150F** from "replace the classifier with AI" to "give the
  curator a deterministic quality-health signal; ascend to learned only if the
  regression-vs-noise boundary proves fuzzy (§5 v3)." Update the BI body so it
  no longer references the non-existent `sourceType` switch.
- **Apply the same bridge-pattern scrutiny to BI-A1FC3EBB** (watchdog
  learned-anomaly) before building it — confirm its boundary is fuzzy rather
  than assuming a learned step is needed. (Watchdog is safety-sensitive; that
  review is its own pass.)
- Proceed to §5 v1 (record-only wiring) as the next curator increment.
