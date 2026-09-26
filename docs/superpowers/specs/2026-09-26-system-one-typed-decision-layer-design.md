---
title: "Typed-decision layer (System One): calibrated fast judgments for the decision kernel and coworker surfaces"
status: draft
backlog: BI-734E0C69
epic: EP-0AF96937
date: 2026-09-26
research: docs/superpowers/research/2026-09-26-system-one-decision-models-landscape.md
relatedSpecs:
  - docs/superpowers/specs/2026-08-08-authorized-surface-contract-design.md
  - docs/superpowers/specs/2026-05-31-pseudo-user-contract-design.md
  - docs/superpowers/specs/2026-09-09-mailroom-email-triage-and-dispatch-design.md
  - docs/superpowers/specs/2026-09-18-situational-llm-call-parameterization-design.md
  - docs/superpowers/specs/2026-07-25-job-specific-decision-vector-inventory-design.md
  - docs/superpowers/research/2026-08-10-decision-vector-science-and-corpus-adequacy.md
relatedItems: [BI-0DFE48B4, BI-7BACFBEC, BI-E0151DB2, BI-6006E35D]
---

# Typed-decision layer (System One)

_Status: draft · BI-734E0C69 · EP-0AF96937 · branch `doc/system-one-typed-decision-layer`_

## 1. Problem

DPF already has two kinds of inference: **embeddings**, which measure similarity, and **LLM generation**, which writes prose. It has nothing that answers a well-posed question with a calibrated probability, fast. Four symptoms trace back to that missing tier:

1. **`principle_decide` goes blind when the caller skips `features`.** Commandments always carry dimension vectors, so an option without features scores 0 against all of them. The census found `insufficientSignal=true` on 32 of 277 consults and "agent feature maps remain thin" (`2026-08-10-decision-vector-science…` §1.4). Every feature value is hand-typed by the calling LLM, and nothing checks it.
2. **Stance direction is not judged.** `stance-relevance.ts` uses cosine to say whether a stance is on topic. Whether it supports or opposes an option comes from a static field.
3. **Retrieval, not judgment, bounds the number of vectors per decision.** Core and contextual principles are capped at 5 each (`retrieval-budget.ts`), so the default `maxPrinciples` of 20 never binds. Document review (`reviewDesignDoc`) produces pass/fail prose from three LLM reviewers and never produces a vector.
4. **Coworkers act on the user's screen at LLM speed.** The Authorized Surface Contract (ASC) already gives the coworker a typed semantic graph and a governed `surface_act`. Picking the next action still takes a full generative turn, measured in seconds. Cross-surface "take me there" completion is still open (BI-0DFE48B4), although `screen_navigate` exists.

"System One" models (TypeSafe's Jev and open equivalents) show the missing tier. Typed Choice/Score/Noul questions are answered by reading label probabilities at the first output position, many questions in parallel over one shared state, in roughly 100–200 ms. See the [research note](../research/2026-09-26-system-one-decision-models-landscape.md).

## 2. What already exists (fuse, do not build)

| Existing | Role in this design |
|---|---|
| Docker Model Runner (llama.cpp), resident `qwen3.8-27b` Q4_K_M on the 4090; `lib/inference/routed-inference.ts`, `chat-adapter.ts` | Default backend host. Missing piece: `chat-adapter.ts` requests no `logprobs`. |
| `lib/voice/confidence-normalize.ts` | The only precedent for turning a logprob into a normalised confidence. It warns that providers differ and thresholds must be tuned per provider. |
| `dimension-catalog.ts` `HIGH_MEANS` (24 axes, 5 cost axes) | Source text for Score levels. No second axis vocabulary. |
| `evidence-grounding.ts` `buildScoredDecisionOptions` / `groundOptionFeatures`, `option-input-contract.ts` | Where filled or verified features enter scoring. |
| `mcda-quality-gates.ts`, `band-telemetry.ts`, `principle-decide-signal-quality.ts` | Receive typed-model confidence as a coverage and stability signal. |
| `DecisionShadowLedger` + `lib/autonomy/trust-graduation.ts` | Shadow record, agreement tracking and promotion path. No new shadow table. |
| `golden-decisions.ts` + baseline, `DecisionInteraction.scoredOptions` | Ground truth for accuracy and calibration. The ledger had 0 `humanOutcome` rows at the 09-08 review. |
| ASC (`surface_open/snapshot/query/act`, `coworker_screen_read/drive` grants) and Pseudo-User `screen_*` / `CoworkerActionEnvelope` | Seam E state and actuator. The typed model only *selects*; ASC still authorizes and executes. |
| Mailroom typed triage (AC-MAIL-TYPED-REASON: output constrained to registry keys) | First WWWD consumer: a Choice question over the same registry. |
| `2026-09-18-situational-llm-call-parameterization` `ModelCardSampling` | Where a per-model `supportsLogprobs` / readout-temperature capability belongs. |

## 3. Research and benchmarking

Full comparison and sources: [research note](../research/2026-09-26-system-one-decision-models-landscape.md) §2–3.

| Leader | Adopt | Reject |
|---|---|---|
| TypeSafe **Jev** (hosted) | The Choice/Score/Noul question contract as DPF's internal wire shape, the fan-out pattern, and risk-scaled confidence thresholds | As a default backend: org WWWD state would leave the install and it adds a vendor subscription. Its calibration is unpublished (RLCD has no paper). |
| **OpenJev** 27B (GGUF fits the 4090) | Its method (letter readout with a fixed readout temperature, permutation tuning) and its measured shuffle-instability metric as an acceptance measure | Shipping it: the weights are CC BY-NC 4.0. At most a research-only reference arm. |
| **browser-use/jev-ultrafast** (MIT) | One Choice call per step over an indexed action table, with an LLM writing text only when an action needs it | Its DOM element table and raw DOM clicks. ASC forbids ungoverned DOM control; DPF selects over ASC's authorized actions instead. |
| **G-Eval** / first-token logprob literature; **PriDe** option-ID debiasing | Probability-weighted Score, permutation averaging when stakes are elevated or high | Verbalised confidence ("I am 80% sure"): the literature shows it is worse calibrated than logit readout |

**Default under `absorb-dont-adopt` (commandment, weight 2.0):** absorb the readout technique onto the resident model through the existing Docker Model Runner path. That adds no new service, image or subscription. A different backend (Kev 0.8B, Zefan-Cai Open-Jev adapter, Laya) is adopted only if Phase 0 shows it beats the absorbed path on DPF's own golden set by the margin in AC-TD-8. The same comparison must also name what the new backend retires.

## 4. Design

### 4.1 The typed-decision port (`apps/web/lib/inference/typed-decision/`)

This is one internal contract, shaped on the System One wire format so that backends can be swapped:

```ts
type TypedQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }  // ≤52 per pass
  | { type: "score";  instructions: string; criteria: string[] }                 // 2–10 ordered levels
  | { type: "noul";   instructions: string; criteria?: { true: string; false: string } };
type TypedAnswer = { probabilities: Record<string, number>; value: string | number; confidence: number;
                     backend: string; modelId: string; calibrationId: string; permutations: number };
decideTyped(state: TypedState, questions: Record<string, TypedQuestion>, opts: { stakes; budgetMs }): Promise<Record<string, TypedAnswer>>
```

- **Backend `logprob-readout` (default).** It sends a chat completion to Docker Model Runner with `max_tokens: 1`, `logprobs: true`, `top_logprobs: N`, a fixed prompt template that letters the options, and a shared state prefix so the KV cache is reused across questions. It reads the letter-token logprobs and applies the calibration record's temperature. **Whether DMR's llama.cpp build returns `top_logprobs` on the chat endpoint is unverified**; checking it is the first Phase 0 task (AC-TD-1).
- **Backend `system-one-http`** covers any wire-compatible server (Kev, the razorback16 or openjev helper). The hosted Jev endpoint is **disabled** until a separate WWMD data-egress decision exists. WWWD (org) state never goes to it by default.
- **Calibration record** per (backend, model, quantisation, template version): a readout temperature fitted on the golden set, ECE, and the shuffle-instability rate. An answer without a calibration record is `confidence: null` and is **never** used outside shadow. Calibration does not transfer between backends or quantisations.
- **Option-order debiasing:** at `stakes` `elevated` or `high`, run k=2 (or 3) cyclic permutations and average the probabilities (a light form of PriDe). The permutation count is recorded on the answer.
- **More than 52 Choice options:** a tournament of groups of 52, then a final pass with the group winners.
- **State hygiene:** the vendor itself reports that accuracy falls as irrelevant state grows, so every consumer passes the smallest state that answers the question. Sections, not whole documents; an ASC semantic summary, not a page dump.

### 4.2 Seam A: stance direction (WWWD/WSID)

Embedding retrieval stays. For each retrieved stance × option, one Choice question asks `supports | opposes | not-applicable`, which replaces the static direction field in shadow.

### 4.3 Seam B: feature fill, verification and more vectors per decision (`principle_decide`)

- **Fill.** For each option × axis the caller left empty, a Score question uses 5 levels written from `HIGH_MEANS[axis]`, with cost axes worded as magnitude. feature = score / 4. An axis whose confidence is below the stakes threshold stays in `missingDimensions`, so the model can make coverage honest but never invents it. Each filled feature is tagged `source: typed-model` with the answer's `calibrationId`.
- **Verify.** When the caller *did* supply a feature and the typed score disagrees by more than 0.35 with confidence ≥ 0.8, the disagreement is written to the shadow ledger. The caller's value is not overwritten.
- **Principle check fan-out.** One Noul question per applicable principle asks "does this option breach *P*?" It runs over all commandments plus a widened candidate set, not only the 5+5 retrieved. In shadow it only reports which principles the typed layer would have added.
- **Uncertainty propagation.** Sampling features from their Score distributions gives a rank-stability figure next to the existing ±10% weight sensitivity.

Vector count for one decision with *n* options: up to 24·n axis scores plus (commandments + candidates) · n principle checks, all over one shared state per option.

### 4.4 Seams C and D: many options and document review

- **C: many options.** When an LLM offers a set of options, one Choice question over the set gives an independent vote. If it disagrees with the weighted-sum winner, `typed-vote-disagrees` is added as a cause of the uncertain band (shadow).
- **D: document review.** A spec or plan is split into sections. Each section gets:
  - 24 axis Score questions;
  - principle Noul questions;
  - craft rubric Score questions whose levels come from the relevant WSID profession corpus pages.

  The output is a section × vector matrix attached to `reviewDesignDoc` / `reviewBuildPlan` as **advisory evidence** beside the existing LLM reviewers. It does not replace them. Worked size: 10 sections × (24 + ~60 principles + ~10 craft criteria) ≈ 940 typed answers, computed as 10 shared states.

### 4.5 Seam E: coworker action selection on the user's current screen

The founder's target is a coworker that works *inside the screen the user is on* and does what it can see, at interactive speed. ASC already solves perception and authority. The typed layer adds a fast selector:

1. `surface_open` / `surface_snapshot` produce a compact semantic summary plus **only the currently authorized actions** (ASC).
2. One Choice question over `{actionId…} ∪ {ASK_USER, DONE, NONE}`, with the user's utterance and the summary as state. Speculative Score/Noul questions ride in the same call: "does this action need text input?", "is the user's goal satisfied?".
3. If the chosen action needs free text (a form value, a message), the LLM writes **only that argument**, the same split browser-use uses.
4. Execution is always `surface_act` with `expectedRevision`. Persistent effects still go through capability, grant, `AuthorityBinding`, confirmation, kernel and audit controls. **Confidence never substitutes for authorization.**
5. Thresholds by effect class:
   - UI-local transitions (navigate, focus, scroll, open panel, select entity) run above a calibrated threshold, stakes `routine`.
   - Domain mutations always go through `screen_propose_action` / confirmation, whatever the confidence.
   - Below threshold the result is `ASK_USER`, with the top two candidates named.

What this gives the related items:
- **BI-0DFE48B4:** a fast "take me there" navigation path.
- **BI-7BACFBEC:** a stated position. DPF coworker "computer use" means *selection over an authorized semantic graph*, not pixel control of the user's screen. Pixel and DOM driving stays confined to external sites through the existing browser-use sidecar (`2026-04-06-browser-use-integration-design.md`), where the same selector can also run over the sidecar's element table.

### 4.6 Safety

- State is untrusted input. The vendor documents that injected instructions can steer answers. Answers are constrained to question keys, and **no governed action is executed because of text inside the state**. This mirrors AC-MAIL-UNTRUSTED.
- Through Phase 1 the typed layer owns no final verdict. Promotion out of shadow happens per seam, through `trust-graduation.ts` agreement thresholds and a recorded WWMD decision.
- Financial trades, credentials and destructive actions are never selectable Choice targets. ASC already withholds them from the authorized set.

### 4.7 Data

- **No new table in Phase 0.** Shadow proposals go to `DecisionShadowLedger`:
  - `sourceKind = "typed-decision"`;
  - `proposedDecision` holds the answers with model id, question key, probabilities, confidence, calibration id and permutations;
  - `agreement` records agreement with the actual path.
- Calibration records are versioned JSON under `apps/web/lib/inference/typed-decision/calibration/` until Phase 2 shows a runtime need to persist them. At that point they become a `ModelCardSampling` capability rather than a parallel store.

### 4.8 Model-weight licensing rule

A backend's **weights** are SPDX-identified in the same way as its code (`respect-open-source-license-terms`). Non-commercial weights (CC BY-NC*, CPML) may run only in a named research arm on hardware that does not ship, and never in a DPF release, image or install default. This follows the TTS precedent (`2026-05-28-tts-apple-silicon-local-design.md`).

## 5. Objectives

**OBJ-TD-1:** DPF has one internal typed-decision contract (Choice/Score/Noul → calibrated probabilities) served by default from the resident local model, with swappable backends.

**OBJ-TD-2:** `principle_decide` stops returning zero signal for options that arrive without features, and caller-supplied features gain an independent check, with every typed value attributable and calibrated.

**OBJ-TD-3:** One decision or one document can be judged along many more vectors (axes × options, principles × options, criteria × sections) at interactive cost.

**OBJ-TD-4:** A coworker can choose its next action on the user's current Authorized Surface in sub-second time, without weakening ASC authorization.

**OBJ-TD-5:** No typed answer changes an outcome until its seam has measured accuracy, calibration and agreement on DPF's own data and a recorded decision promotes it.

## 6. Acceptance criteria

| AC-ID | Objectives | Statement |
|---|---|---|
| AC-TD-1 | OBJ-TD-1 | A probe records whether Docker Model Runner returns `top_logprobs` for the resident model's chat endpoint. If it does not, the spike records the fallback it takes (llama-server sidecar on call, or `system-one-http`) and why. |
| AC-TD-2 | OBJ-TD-1 | `decideTyped` answers a Choice, a Score and a Noul in one call over a shared state, and each answer carries backend, model id, calibration id and permutation count. |
| AC-TD-3 | OBJ-TD-1, OBJ-TD-5 | Every backend tested has a calibration record with readout temperature, ECE (reliability plot) on the golden set, and shuffle-instability rate. An answer without a record has `confidence: null`. |
| AC-TD-4 | OBJ-TD-2 | In shadow, on the golden set and a replay of ledger consults that had `insufficientSignal=true`, the typed fill yields a non-null recommendation for at least 80% of those consults. The shadow row states which axes were filled and which stayed missing below threshold. |
| AC-TD-5 | OBJ-TD-2 | Verifier disagreements (more than 0.35 at confidence ≥ 0.8) are written to `DecisionShadowLedger` with both values, and no caller-supplied feature is overwritten. |
| AC-TD-6 | OBJ-TD-3 | For one real spec in `docs/superpowers/specs/`, Seam D produces a section × (axes + principles + craft criteria) matrix. Its answer count, wall time and VRAM are recorded on the 4090 while the resident model stays loaded. |
| AC-TD-7 | OBJ-TD-4 | On three ASC surfaces, the Seam E selector picks the correct next authorized action for a scripted utterance set at a measured accuracy with median latency under 500 ms. Every execution goes through `surface_act` with `expectedRevision`, and domain mutations always route to propose or confirm. |
| AC-TD-8 | OBJ-TD-1, OBJ-TD-5 | The spike report has a license verdict for every candidate (weights and code) and a go / no-go per seam. A non-default backend is recommended only if it beats `logprob-readout` by at least 3 points of accuracy or halves ECE on the golden set, and names what it retires. |
| AC-TD-9 | OBJ-TD-5 | No verdict, recommendation or executed action differs between shadow-on and shadow-off runs of the golden set during Phases 0–1. |

## 7. Phasing

| Phase | Scope | Item |
|---|---|---|
| 0: spike (shadow) | Port, `logprob-readout` backend, calibration harness; Seams A and B in shadow; license verdicts. AC-TD-1…5, 8, 9 | **BI-734E0C69** (this item) |
| 1: breadth (shadow) | Seam C vote, Seam D document matrix, principle fan-out, uncertainty propagation. AC-TD-6 | to file after the Phase 0 go/no-go |
| 2: coworker surfaces | Seam E selector over ASC; Mailroom Choice backend as the first WWWD consumer. AC-TD-7 | to file (depends on ASC navigate actions, BI-0DFE48B4) |
| 3: promotion | Per-seam WWMD decision through `trust-graduation` agreement thresholds | per seam |

## 8. Non-goals

- Shipping any non-commercially licensed weights. Using hosted Jev without its own data-egress decision.
- Replacing the weighted-sum math, the LLM design reviewers, or embedding retrieval.
- Pixel-level control of the user's own screen.
- Letting the typed layer own any final verdict before Phase 3.
- Trading or any other financial decision.

## 9. Open questions

1. Does DMR expose `top_logprobs` on chat completions for GGUF models, and is prefix caching kept across questions? (AC-TD-1)
2. Is Zefan-Cai's Open-Jev 27B adapter trained on the same Qwen3.8-27B base that is resident? If it is, a LoRA load on the resident model could buy the tuning at no VRAM cost.
3. The golden set is small and `humanOutcome` is empty. Is a founder-labelled batch of about 200 axis judgments needed before any ECE claim is meaningful?

## Traceability

| Requirement | Contracts | Plan phase | Verification |
|---|---|---|---|
| OBJ-TD-1 | §4.1 port, backends, calibration | Phase 0 | AC-TD-1, AC-TD-2, AC-TD-3, AC-TD-8 |
| OBJ-TD-2 | §4.3 fill / verify | Phase 0 | AC-TD-4, AC-TD-5 |
| OBJ-TD-3 | §4.3 fan-out, §4.4 Seams C/D | Phase 1 | AC-TD-6 |
| OBJ-TD-4 | §4.5 Seam E over ASC | Phase 2 | AC-TD-7 |
| OBJ-TD-5 | §4.6 safety, §4.7 shadow ledger, §4.8 licensing | Phases 0–3 | AC-TD-3, AC-TD-8, AC-TD-9 |
