---
status: active
---
# Skill catalog cap and local presence (`BI-DBEEC15B`)

**OBJ-HONEST-WINDOW:** An unread window is not a large one.
**OBJ-CLOUD-UNCHANGED:** Cloud-only installs keep an uncapped catalog.

| AC-UNREAD-CAPS | OBJ-HONEST-WINDOW | Unknown window with local present caps the catalog. |
| AC-ABSENT-FREE | OBJ-CLOUD-UNCHANGED | Absent local leaves the catalog uncapped. |
| AC-PIN-SURVIVES | OBJ-CLOUD-UNCHANGED | An invoked skill is never dropped by the cap. |

## Problem

`deriveSkillCatalogCap` uncaps the skill catalog whenever the served window is
null or zero:

```ts
if (!servedContextTokens || servedContextTokens <= 0) return Number.POSITIVE_INFINITY;
```

That null is the same ambiguous value `BI-A8BFEFCE` fixed for the tool cap. It
means both "no local model" and "the probe could not read one". Only the first
justifies uncapping. When the probe fails on an install that does have a small
local model, the largest uncapped block in the prompt is enumerated in full.

The module's own header names the stakes but understates them. It says a heavy
coworker holds 36-38 skills; measured against the live install, the real figures
are higher and eight agents sit above the cap:

| agent | active skills | catalog chars | approx tokens |
| --- | --- | --- | --- |
| `platform-engineer` | 45 | 15,281 | ~3,820 |
| `build-specialist` | 43 | 14,036 | ~3,510 |
| `portfolio-advisor` | 22 | — | — |
| `ops-coordinator` | 18 | 4,947 | ~1,240 |
| `ea-architect` | 18 | 5,186 | ~1,300 |

Measured by joining `SkillAssignment` to `SkillDefinition` on `skillId` where the
assignment is enabled and the definition is active, summing the catalog line
shape. Correct the header comment in the same change so the next reader is not
working from the stale number.

The two defects compound, and the arithmetic is the point. On this install the
served window is 24,576 tokens with a 12,000-token non-tool reserve. A failed
probe simultaneously widened the tool surface from 15 to 48 schemas (~11k extra
tokens) and uncapped the catalog for the heaviest agent (~2.5k extra). That is
roughly 13.5k of a 24.5k window consumed by a single failed read.

## Why this was separated from BI-A8BFEFCE

Different failure mode. The tool-cap defect made the routing layer refuse the
local fallback outright, producing turns that executed nothing and wrote no
evidence. This one risks context overflow, which has its own handling path
(`describeContextCapacityFailure`, `REQUEST_TOO_LARGE`) and does not affect
fallback eligibility. Folding it in would have widened a targeted routing fix
into prompt assembly.

## Contract

**CONTRACT-CATALOG-CAP.** `deriveSkillCatalogCap` takes the same `LocalPresence`
the tool cap consumes. `absent` returns infinity. `present` and `unknown` mean
local is in the path: a KNOWN window still decides on fit, and an UNREAD window
takes the cliff cap rather than infinity.

Note the axis differs from the tool cap deliberately. The tool cap binds on
presence because tool-SELECTION accuracy is a property of the model class. The
catalog cap binds on window size because it is a question of context FIT — so a
local model with a genuinely large window keeps an uncapped catalog, exactly as
today. Only the unread case changes.

## Scope

In scope: `deriveSkillCatalogCap`, its call site in `agent-coworker.ts` (which
already holds the resolved presence in scope), and their tests.

Out of scope: any change to `capSkillCatalog` pinning behavior, to the tool cap,
or to the posture resolver — all landed under `BI-A8BFEFCE`.

## Dependency

Requires `LocalPresence` and `resolveLocalServingPosture` from `BI-A8BFEFCE`
(PR #4663). This branch bases on `main` AFTER that merges rather than stacking
on it, because a stacked PR does not run the heavy CI on this repo and its green
is not a real green.

## Verify

AC-UNREAD-CAPS: null window with `unknown` and with `present` both return the
cliff cap. AC-ABSENT-FREE: `absent` returns infinity; the existing window
examples (24,576 → capped; 131,072 → infinity) are unchanged. AC-PIN-SURVIVES:
an explicitly invoked skill is still appended beyond the cap.
