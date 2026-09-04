---
status: active
---

# Prompt Provenance in Inference Screening — Implementation Plan

**Goal:** A coworker whose job description names payroll, invoices or salaries can reach a cloud provider, while every real governed value — including one arriving inside the system prompt — still routes exactly as it does today.

**Primary BI:** `BI-463BE12A` — a coworker's system prompt pins it to `restricted` forever
**Mechanism BI:** `BI-9C14CB5D` — separate injected data from platform instruction
**Epic:** `EP-B9DD37C7`
**Decision:** `DI-BF2FEDA18D81` scored `prompt-corroboration` (10.690) over `segment-prompt` (9.565). The operator selected `segment-prompt` after the evidence below showed `prompt-corroboration` cannot clear the defect without lowering protection for injected data.

## Why the first approach failed

`prompt-corroboration` — stop instruction matches from escalating to `restricted`, keep them holding a `confidential` floor — was implemented and unit-tested green. Driving the real screening entry point showed it does not work, because **four independent channels** clamp a turn to local-only, not one:

| # | Channel | Mechanism |
|---|---|---|
| 1 | Sensitivity clearance | `overallSensitivity=restricted` → only `local`/`speaches` are cleared |
| 2 | Per-class export decision | `buildPolicyContexts` builds a PDP context per detected class → `deny` → `routeEffect=local-only` |
| 3 | Vertical policy packs | `verticalSensitiveDataPoliciesForClasses` loads a pack per detected class, contributing a mask obligation |
| 4 | `needsPdp` → mask → residency | any detected class plus `confidential` attaches a mask obligation; `maskRequired && !prior` clamps `residencyPolicy` to `local_only`, excluded at `pipeline-v2.ts:221` |

Measured after fixing 1–3:

```
COO-PROMPT-ONLY:       sensitivity=confidential  residencyPolicy=local_only  routeEffect=local-only
REAL-VALUE-IN-MESSAGE: sensitivity=restricted    residencyPolicy=local_only  routeEffect=local-only
INNOCUOUS:             sensitivity=confidential  residencyPolicy=any_enabled routeEffect=allow
```

Channel 4 survives, and closing it within that approach requires dropping the `confidential` floor for instruction-only evidence — which lowers protection for a real value arriving in an injected briefing segment. Provenance at the source removes all four at once, with nothing weakened.

Separately observed and NOT addressed here: `transformation` stayed `none` in both the test harness and the live receipt, so the mask obligation is acting as a permanent local-only clamp rather than mask-then-send. Worth its own item.

## Design

**Instruction spans, not segments.** The caller supplies the exact text spans that are platform-authored instruction. The classifier subtracts those spans from the prompt and probes the remainder as data. Everything unlabelled is data.

This shape was chosen over a structured segment array because:

- It is **fail-closed by construction.** An assembly path that supplies nothing behaves exactly as today. The legacy persona path and every post-assembly append (setup-mode override, appended guidance) need no change and are treated as data.
- It survives **downstream concatenation**, which the current code does in at least two places after assembly.
- It needs no offsets, so reordering a block cannot silently mislabel one.

**Provenance is supplied by whoever knows it.** `finalDomainContext` in `agent-coworker.ts` concatenates the persona, `AUTHORIZED_SURFACE_PROMPT`, retrieved knowledge, and semantic memory into one string. Only that call site knows which parts are which, so the assembler must not guess: it contributes its own static blocks and unions in caller-supplied spans.

### What is instruction

- The assembler's `staticBlocks`: identity, decision routing, limitation response, escalation ladder, coordinator contract, mode.
- Generated instruction sentences: today's date, the authority statement, the initiative block, the sensitivity notice, the reading-level directive.
- Caller-supplied: the coworker persona (`selectedDomain`) and `AUTHORIZED_SURFACE_PROMPT`.

### What is data

Everything else, explicitly including: company mission, retrieved knowledge, semantic memory, profession corpus, wiki recall, working notes, `--- PAGE DATA ---`, attachments, extra sections, question packet, and anything appended after assembly.

## Steps

- [ ] `classify-payload.ts`: accept `systemPromptInstructionSpans`; emit one instruction-provenance probe per span and one data-provenance probe for the remainder. Fallback with no spans: the whole prompt is DATA.
- [ ] Replace the committed `INSTRUCTION_PROBE_PATHS` whole-prompt rule with the span rule (the committed fallback treats the whole prompt as instruction, which is the unsafe default).
- [ ] `evaluate-inference-policy.ts`: keep `classifiedDataClasses` complete for the receipt; drive policy contexts, categories, and vertical packs from the data-evidenced set. (Prototyped.)
- [ ] `prompt-assembler.ts`: return instruction spans alongside the text; keep `assembleSystemPrompt` returning the string.
- [ ] `agent-coworker.ts`: pass persona + `AUTHORIZED_SURFACE_PROMPT` as caller spans; leave knowledge and memory unlabelled.
- [ ] Thread spans: agentic-loop params → `routeOptions` → `RouteAndCallOptions` → `prepareRoute` → `createRoutedInferenceScreen` → `screenInferencePayload`.
- [ ] Receipt: `matchProvenance` names the span index, not just `systemPrompt`.
- [ ] Tests: the three probe cases above as assertions; a real value inside an unlabelled prompt segment still escalates; no spans means no behaviour change.

## Acceptance

- A COO-shaped turn with no governed values reaches `routeEffect=allow` and `residencyPolicy` unclamped.
- A real salary/invoice value in a message, a tool-call argument, a governed hint, OR an unlabelled prompt segment still produces `local-only`.
- An assembly path that supplies no spans is byte-for-byte unchanged in behaviour.
- The receipt still reports every detected class.

## Follow-on: the message carrier (BI-40EF7C44)

The plan above covers ONE carrier — the assembled system prompt. A live COO retest
on 2026-09-01 showed the same vocabulary escalating from a second one: precise
`employee-record-text` and `payment-or-finance-text` matches at
`messages[0].content` and `messages[2].content`, alongside the neutralised copies
at `systemPrompt.instruction[0]`.

Two obvious extensions were considered and **rejected with evidence**:

- **Tighten the patterns** so `salary` and `invoice` need a value nearby. It
  clears the persona, but it also breaks three cases earlier BIs deliberately
  protect: `"The employee salary band needs review."` (the ambiguous-vocabulary
  corroboration rule),
  `"Her salary is being reviewed."` (BI-67CAF494 — a pronoun carries no
  apostrophe, so possessive-matching misses it), and
  `"Reconcile the payroll against the invoice."` (corroboration across two
  domains). Any pattern narrow enough to spare the persona also spares a record.
- **Declare message spans as instruction**, mirroring the prompt. Wrong for the
  two blocks actually being prepended: the thread checkpoint is
  `AgentThread.compactedSummary` and the briefing is `CoworkerBriefing.content`,
  "distilled offline from governed records". Both can legitimately carry governed
  values, so labelling them instruction opens an egress path — the failure this
  plan's own fail-closed rule exists to prevent.

**Shipped instead: measurement.** `matchProvenance` now carries a `MessageOrigin`
label per matched message — `turn`, `thread-checkpoint`, or `user-briefing`. A
label is safe to persist where content is not (`rawPayloadStored` stays false),
and it is strictly diagnostic: it reaches no rule, verdict or policy context, and
tests assert a labelled and an unlabelled payload screen identically.

The decision this unblocks: re-run the COO turn and read which origin carries the
precise match. If it is the **briefing**, the fix belongs in briefing GENERATION —
a briefing that restates the coworker's job description is putting instruction
vocabulary into a data carrier. If it is a **real turn**, the control is working
and the answer is the masked-projection path in `BI-0064680C`, not a
classification change.
