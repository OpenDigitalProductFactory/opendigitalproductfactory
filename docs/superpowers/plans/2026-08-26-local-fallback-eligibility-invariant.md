---
status: active
---

# Local fallback eligibility invariant implementation plan

- **Backlog item:** `BI-A8BFEFCE`
- **Workroom:** `WC-F9884F9B`
- **Design:** `docs/superpowers/specs/2026-08-26-local-fallback-eligibility-invariant-design.md`

## Research evidence

- Live portal logs, 2026-08-25T23:56:36Z to 23:57:10Z. `AGT-WS-REVIEW` budgeted
  `authorized=86 attached=48 deferred=39 cap=48`; the gate logged
  `Skipping local fallback (48 tools > 15 threshold)`; every codex attempt
  returned pool exhaustion; the turn closed `executedTools=0 toolSurface=48
  estToolTokens=11600 ctxPeakTokens=544`.
- Docker Model Runner serves `huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M`
  with a 262,144-token window, and answered `/v1/models` and
  `/engines/_configure` in about 4 ms from inside the portal container. The model
  could have run the turn.
- The same agent flips cap between runs with no config change:
  `AGT-WS-PORTFOLIO` logged `cap=15` at 23:58:51Z, `cap=48` at 00:02:59Z, and
  `cap=15` at 00:07:43Z. The active local `ModelProfile` carries no
  `toolFidelity` key, so the selection ceiling is 15 and `cap=48` can only come
  from `servedContextTokens === null`. The probe is the only varying input.
- Source inspection: `resolveLocalServedContextTokens` returns `null` from four
  separate branches, one of which means absence and three of which mean an
  unread probe. `deriveCoworkerToolCap` treats them alike.
- `fallback.ts:270` claims the budget "caps its total attachment to the same
  constant, so a budgeted surface is never disqualified here". The claim is false
  in both directions: `null` posture widens the budget past the gate, and a
  measured fidelity ceiling would widen it further while the gate stays at 15.

## Requirement and contract map

| Ref | Requirement | Contract | Flow | Verification |
| --- | --- | --- | --- | --- |
| `REQ-POSTURE` | An unread local model is never reported as an absent one. | `CONTRACT-POSTURE` | `FLOW-PROBE-THEN-PROFILE` | `VERIFY-POSTURE` |
| `REQ-FAIL-SAFE` | An unknown posture caps at the cliff, keeping local eligible. | `CONTRACT-CAP` | `FLOW-CAP-DERIVE` | `VERIFY-CAP` |
| `REQ-ONE-CEILING` | Budget and gate cannot disagree about the local ceiling. | `CONTRACT-CEILING` | `FLOW-GATE-CHECK` | `VERIFY-GATE` |
| `REQ-TRACE` | A degrade to unknown is greppable at the decision point. | `CONTRACT-TRACE` | `FLOW-PROBE-THEN-PROFILE` | `VERIFY-TRACE` |

Canonical baseline mapping: `OBJ-HONEST-POSTURE` -> `AC-UNKNOWN-SAFE`,
`AC-ABSENT-FULL`; `OBJ-ONE-CEILING` -> `AC-GATE-AGREES`; `OBJ-VISIBLE-DEGRADE`
-> `AC-DEGRADE-LOGGED`.

## Atomic delivery

The posture resolver, the cap derivation, and the gate ceiling are one
eligibility boundary. Shipping the posture alone leaves the gate refusing a
measured surface. Shipping the shared ceiling alone leaves the flaky probe still
widening the budget to 48. Shipping the cap alone leaves callers with no way to
report an unknown posture. One atomic deliverable under `BI-A8BFEFCE`.

## Task 1: Pin the shared ceiling red

**Files:**

- Modify `apps/web/lib/tak/context-economy-metrics.ts`
- Modify `apps/web/lib/tak/context-economy-metrics.test.ts`

Add `LocalPresence` and `resolveLocalToolCeiling` to the pure module. The
function returns `LOCAL_TOOL_SELECTION_CLIFF` for null, zero, and negative
input, and the floored measured value otherwise. Tests cover each branch and
assert the cliff constant stays at 15.

## Task 2: Separate an unread probe from an absent model

**Files:**

- Modify `apps/web/lib/inference/local-model-context-reconcile.ts`
- Modify `apps/web/lib/inference/local-model-context-reconcile.test.ts`

Extract the probe into a discriminated result — `served`, `no-model`, or
`unreachable` — and keep `resolveLocalServedContextTokens` as a wrapper so
existing callers are unchanged. Add `resolveLocalServingPosture`, which maps
`served` to present, `no-model` to absent, and `unreachable` to an active local
`ModelProfile` lookup, returning unknown only when that read throws. Log once on
the unknown branch. Tests cover all five paths and the embedding-only list.

## Task 3: Make an unknown posture fail safe

**Files:**

- Modify `apps/web/lib/actions/coworker-tool-budget.ts`
- Modify `apps/web/lib/actions/coworker-tool-budget.test.ts`

Add `localPresence` to `CoworkerToolCapOptions`. Return 48 only on absent; bind
present and unknown to the shared ceiling; apply window-fit only when the window
is known. Omitting the option keeps today's behavior, derived from the window.
Tests pin the four documented examples, both new fail-safe cases, and the
measured-ceiling interaction.

## Task 4: Make the gate read the shared ceiling

**Files:**

- Modify `apps/web/lib/routing/fallback.ts`
- Modify `apps/web/lib/routing/fallback.test.ts`

Resolve the ceiling lazily inside the skip branch, memoized per call, so the
measured value is read only when a local fallback entry is actually reached.
Keep the `N tools exceeds threshold` message shape that
`inference-dead-ends.ts` parses. Tests prove 48 is still refused unmeasured, 15
is admitted, a measured ceiling of 30 admits 30, and the primary endpoint is
tried regardless.

## Task 5: Wire the call sites

**Files:**

- Modify `apps/web/lib/actions/agent-coworker.ts`
- Modify `apps/web/lib/tak/autonomous-work-run.ts`

Both switch from `resolveLocalServedContextTokens` to
`resolveLocalServingPosture` and pass presence into the cap. The existing
`[autonomous-tool-budget]` line gains the presence so the next occurrence is
readable. `deriveSkillCatalogCap` keeps its current input, per the design's
scope boundary.
