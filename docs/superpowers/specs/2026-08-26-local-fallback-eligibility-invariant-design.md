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
