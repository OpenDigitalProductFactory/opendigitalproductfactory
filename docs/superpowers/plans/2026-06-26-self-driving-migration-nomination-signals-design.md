# Self-driving migration — nomination signals design pass

- **BI:** BI-A028AA14 — "Self-driving cognitive-load migration scan — recurring curator that nominates AI→code & code→AI BIs from telemetry" (the keystone)
- **Epic:** EP-COST-001
- **Date:** 2026-06-26
- **Status:** design pass started; signal (1) stats core shipped with this doc; the auto-nomination wiring is **FOUNDER-GATED** (see §4); signals (2)–(5) are roadmap

## 0. TL;DR

The keystone closes the migration loop: OBSERVE telemetry → NOMINATE a "codify X"
(or "ascend Y") BI with evidence → human APPROVES → Build Studio CODIFIES → hive
PROPAGATES. The BI says the recommended first step is building the nomination
signals, and it "needs a design pass before build."

This pass starts that design and ships the **stats core for signal (1)** — the
AI→code "stabilized → codify" trigger — as a pure, deterministic function
(`summarizeToolReasoningStability`). It deliberately **defers two things**: the
input/output *normalisation* (a tunable decision, §2) and, critically, the
**auto-nomination wiring that files BIs from telemetry** (§4) — that mutates the
backlog and must not go live without founder sign-off.

## 1. The loop and where signal (1) sits

The migration curator (reusing existing scheduled infra — `governed-backlog-tee-up`
/ `skill-curator`, NO new cron, per the BI) needs queryable signals, not a code
re-read each cycle. Signal (1) is the core descent trigger: an agent's reasoning
through a tool that **recurs with low output variance and high success** is a
candidate to replace with deterministic code.

Substrate (verified): `ToolExecution` (schema.prisma:4094) already records
`agentId`, `toolName`, `parameters` (input), `result` (output), `success`,
`durationMs`, `costUsd`, `inputTokens`/`outputTokens` per call. Everything signal
(1) needs is already collected.

## 2. Signal (1): shapes + stats core

**Two layers, deliberately separated so the codifiable core never churns when the
heuristic is retuned:**

- **Normalisation (tunable — caller's job, NOT in the shipped core):**
  - `inputShape` = a canonical signature of `ToolExecution.parameters` capturing
    the *kind* of call, not exact values. Proposed v1: sorted top-level key set +
    value *types* (e.g. `{path:string,limit:number}`). Too coarse → unrelated
    calls merge; too fine (raw value hash) → nothing recurs. This dial is the
    thing to validate against real data first.
  - `outputDigest` = a canonical signature of `result` where equal digests mean
    "same outcome". Proposed v1: stable-stringify of the result with volatile
    fields (ids, timestamps) stripped.
- **Stats core (shipped, pure, deterministic — `tool-reasoning-stability.ts`):**
  `summarizeToolReasoningStability(samples)` groups by (agent × tool ×
  inputShape) and returns `{recurrence, distinctOutputs, varianceRatio,
  successRate, verdict}`. Thresholds are explicit + named (the learnable surface):
  `MIN_RECURRENCE_TO_JUDGE=10`, `MAX_VARIANCE_RATIO_TO_CODIFY=0.2`,
  `MIN_SUCCESS_RATE_TO_CODIFY=0.9`.

## 3. Verdict logic (shipped)

- `recurrence < MIN` → **insufficient-data** (don't judge noise).
- `varianceRatio ≤ MAX` and `successRate ≥ MIN` → **stabilized** (codify candidate).
- otherwise → **variable** (genuine AI judgment — leave it at the AI tier; a
  consistent-but-failing pattern is explicitly NOT codifiable).

Pure + fully unit-tested; capacity-cheap to run over a telemetry window. It never
files anything.

## 4. Auto-nomination wiring — FOUNDER-GATED (not built here)

Turning a `stabilized` verdict into a `triaging` "codify X" BacklogItem is the
step that makes the loop *self-driving*. It **mutates the backlog from telemetry**
and is consequential enough to need explicit founder sign-off on:

1. **Should it auto-file at all**, or only produce a ranked report a human files
   from? (Default-safe = report-first; the irreducible human decision is preserved
   either way since BIs land at `triaging`, never `build`.)
2. **Thresholds + volume cap** — how many nominations per cycle; what recurrence/
   variance bar; per-cycle budget so it can't flood the backlog.
3. **Dedupe vs prior BIs** — a stabilized signature seen last cycle must touch the
   existing nomination (recurrenceCount++), not file a duplicate — mirror the
   curator's `(sourceType, sourceId)` dedupe.
4. **Evidence payload** — the nomination must carry the signature + counts so the
   human approves on evidence, not vibes.

Until that review, signal (1) is **report-only**: compute + surface, never file.

## 5. Roadmap (the other signals + the reverse trigger)

- **(2) cost-per-reasoning-pattern** rollup on `AdapterRunTelemetry` → ROI ranking
  of nominations (which codifications save the most capacity).
- **(3) per-job misfire/defer counters** → DONE (BI-9BF17415, shipped) — the
  code→AI ascent self-nomination input.
- **(4) surface friction** (time-on-field, abandonment) via EP-HX-LOOP → human→AI
  surface nominations.
- **(5) work-tier tag + load-descent trend** → makes migration measurable over
  time rather than snapshotted.
- **Reverse (ascent) trigger** — a deterministic/scheduled job whose defer/misfire
  rate exceeds a bar is nominated for code→AI judgment (the watchdog + curator
  calibration signals from BI-A1FC3EBB / BI-93FE150F feed this).

## 6. Recommendation

- Validate the §2 `inputShape` dial against a real `ToolExecution` window before
  wiring anything — a bad normalisation makes every downstream nomination noise.
- Build the **report-only** path first (compute signal (1) + surface a ranked
  "codify candidates" list); get founder sign-off on §4 before any auto-filing.
- Signal (1)'s stats core is now in place; signals (2)/(4)/(5) are the next
  foundation pieces. The loop stays human-approved at the `triaging` gate — the
  irreducible decision the whole design protects.
