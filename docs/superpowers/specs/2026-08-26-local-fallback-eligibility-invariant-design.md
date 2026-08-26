---
status: active
---
# Local fallback eligibility (`BI-A8BFEFCE`)

**OBJ-HONEST-POSTURE:** An unread local model is not an absent one.
**OBJ-ONE-CEILING:** Budget and gate share one ceiling.
**OBJ-VISIBLE-DEGRADE:** A degraded posture leaves a trace.

| AC-UNKNOWN-SAFE | OBJ-HONEST-POSTURE | Unknown local posture keeps the cliff cap. |
| AC-ABSENT-FULL | OBJ-HONEST-POSTURE | Cloud-only installs keep all 48 tools. |
| AC-GATE-AGREES | OBJ-ONE-CEILING | A budgeted surface is never refused. |
| AC-DEGRADE-LOGGED | OBJ-VISIBLE-DEGRADE | One line names the degrade. |

## Problem

`resolveLocalServedContextTokens` returns `null` for two different facts: no
local model exists, and the local model could not be read. `deriveCoworkerToolCap`
reads that `null` as the first fact and returns the full 48 tools.
`callWithFallbackChain` then refuses every local fallback above 15 tools. So a
failed read deletes local from the chain. Add a cloud rate-limit and the turn
returns nothing.

Measured on the live install: `AGT-WS-REVIEW` attached 48 tools, the gate
skipped local, every codex attempt was pool-exhausted, and the turn closed with
`executedTools=0`. The local model served a 262,144-token window against an
11,600-token payload. It was refused on a count, not on capacity.

A review turn that runs no tools writes no evidence. The gate reads evidence, so
the work stops until a human intervenes. A 30-second rate-limit becomes an
open-ended block.

## Evidence

The cap flips on one install, same agent, minutes apart, with no configuration
change between runs:

```
23:58:51 AGT-WS-PORTFOLIO authorized=189 attached=15 cap=15
00:02:59 AGT-WS-PORTFOLIO authorized=189 attached=48 cap=48
00:07:43 AGT-WS-PORTFOLIO authorized=189 attached=15 cap=15
```

That install carries no measured fidelity, so its selection ceiling is 15 and a
cap of 48 can only come from a null served window. The probe is the only input
that varies. Probed from inside the portal container it answers `/v1/models` and
`/engines/_configure` in about 4 ms when idle — so the failure is intermittent
and load-dependent, which is exactly when a coworker turn runs.

`resolveLocalServedContextTokens` returns null from four branches. One means
absence. Three mean an unread probe. Nothing distinguishes them, and the module
logs nothing on any of them, so the degrade left no trace.

`fallback.ts` asserted the two ends already agreed: "the coworker-tool-budget
caps its total attachment to the same constant, so a budgeted surface is never
disqualified here". The assertion is false in both directions — a null posture
widens the budget past the gate, and a measured fidelity ceiling would widen it
further while the gate stayed at 15.

## Contracts

**CONTRACT-POSTURE.** `resolveLocalServingPosture` returns served tokens plus a
presence of `present`, `absent`, or `unknown`. The probe decides when it answers:
a generation model means present, a clean list without one means absent. Only an
unreachable probe falls through to the active local `ModelProfile` rows, and only
a failed read of those returns unknown.

**CONTRACT-CAP.** `deriveCoworkerToolCap` lifts to 48 only on `absent`. Both
`present` and `unknown` bind to the selection ceiling. Window-fit applies only
when the window is known; an unknown window never widens the surface.

**CONTRACT-CEILING.** `resolveLocalToolCeiling` is the one place the local tool
ceiling is derived. The budget and the fallback gate both call it, so measured
fidelity moves both together and neither can outrun the other.

It lives in `routing`, not `tak`. Three contexts need it — the budget in
`actions`, the posture in `inference`, the gate in `routing` — and `routing` is
the inner boundary of the application DAG: everything may depend on it, it
depends on nothing. Placing it in `tak` forced an `inference -> tak` reverse
edge the boundary guard correctly refused. Moving it also retires the owned
`routing -> tak` exception that the old cliff import held open.

**CONTRACT-TRACE.** A posture that degrades to `unknown` logs once, naming the
probe failure, at the point the decision is made.

## Scope

In scope: the posture resolver, the cap derivation, the shared ceiling, the
fallback gate's use of it, and their tests.

Out of scope: `deriveSkillCatalogCap`, which reads the same `null` and uncaps the
skill catalog. Same shape, different failure mode (context overflow, not gate
refusal), and it does not affect fallback eligibility. It carries its own item.
Authority is untouched — deferred tools stay authorized and `load_tools` reaches
them.

## Verify

AC-UNKNOWN-SAFE: null window plus `unknown` and plus `present` both cap at the
cliff. AC-ABSENT-FULL: `absent` returns 48; the four documented window examples
are unchanged. AC-GATE-AGREES: a 15-tool surface is not skipped; a measured
ceiling of 30 admits 30 tools; an unmeasured install still refuses 48.
AC-DEGRADE-LOGGED: an unreachable probe with a failing profile read logs once and
returns `unknown`.
