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
| Docker Model Runner (llama.cpp), resident `qwen3.8-27b` Q4_K_M on the 4090; `lib/inference/routed-inference.ts` → `lib/routing/chat-adapter.ts` | Default backend host and the **only** call path. Missing piece: `chat-adapter.ts` requests no `logprobs`. This design adds a logprobs request option there rather than a direct DMR client. |
| `lib/inference/utility-inference.ts` `classify` task (local-first, free-text JSON over `routeAndCall`) | The existing closed-set classifier. It is not duplicated: Choice is the calibrated successor for closed-set classification. Callers move to it only after their seam is promoted (Phase 3); until then both coexist and `classify` is unchanged. |
| `lib/voice/confidence-normalize.ts` | The only precedent for turning a logprob into a normalised confidence. It warns that providers differ and thresholds must be tuned per provider. |
| `dimension-catalog.ts` `DIMENSION_CATALOG[].highMeans` and `scope` (24 axes, 5 cost axes, profession-local axes) | Source text for Score levels. No second axis vocabulary. |
| `evidence-grounding.ts` `OptionEvidenceMap` / `groundOptionFeatures` / `buildScoredDecisionOptions`, `option-input-contract.ts` | Where filled or verified features enter scoring, and where their provenance lives (§4.3). |
| `mcda-quality-gates.ts`, `band-telemetry.ts`, `principle-decide-signal-quality.ts` | Report typed-layer signals in shadow. Typed fills are excluded from coverage and autonomy measures until promotion (§4.3). |
| `DecisionShadowLedger` + `lib/autonomy/regulatory-autonomy-runtime.ts` / `trust-graduation.ts` | Shadow record, agreement window and promotion path. No new shadow table (§4.7). |
| `golden-decisions.ts` (3 scenarios) + baseline, `DecisionInteraction.scoredOptions` | Seed ground truth. It is too small for calibration claims, so AC-TD-10 adds a labelled set. The ledger had 0 `humanOutcome` rows at the 09-08 review. |
| ASC (`surface_open/snapshot/query/act`, `coworker_screen_read/drive` grants; projected actions carry `actionClass`, `risk`, `confirmation`) | Seam E state and actuator. The typed model only *selects*; ASC still authorizes and executes. |
| `decision-perspective/types.ts` direction values `support \| oppose \| neutral` | Seam A answer keys. No new direction vocabulary. |
| `AsyncInferenceOp` queue | Carries batch, advisory fan-out (Seam D) off the interactive path. |
| Mailroom typed triage (AC-MAIL-TYPED-REASON: output constrained to registry keys) | First WWWD consumer: a Choice question over the same registry. |
| `routing/model-card-types.ts` `ModelCardCapabilities` (`structuredOutput`, `promptCaching`, …) | Home of a `logprobs` capability flag. Vendor sampling stays in `ModelCardSampling`; measured calibration is per-install data, not a card field (§4.7). |

## 3. Research and benchmarking

Full comparison and sources: [research note](../research/2026-09-26-system-one-decision-models-landscape.md) §2–3.

| Leader | Adopt | Reject |
|---|---|---|
| TypeSafe **Jev** (hosted) | The Choice/Score/Noul question contract as DPF's internal wire shape, the fan-out pattern, and risk-scaled confidence thresholds | As a default backend: org WWWD state would leave the install and it adds a vendor subscription. Its calibration is unpublished (RLCD has no paper). |
| **OpenJev** 27B (GGUF fits the 4090) | Its method (letter readout with a fixed readout temperature, permutation tuning) and its measured shuffle-instability metric as an acceptance measure | Shipping it: the weights are CC BY-NC 4.0. At most a research-only reference arm. |
| **browser-use/jev-ultrafast** (MIT) | One Choice call per step over an indexed action table, with an LLM writing text only when an action needs it | Its DOM element table and raw DOM clicks. ASC forbids ungoverned DOM control; DPF selects over ASC's authorized actions instead. |
| **G-Eval** / first-token logprob literature; **PriDe** option-ID debiasing | Probability-weighted Score, permutation averaging when stakes are elevated or high | Verbalised confidence ("I am 80% sure"): the literature shows it is worse calibrated than logit readout |

**Default under `absorb-dont-adopt` (commandment, weight 2.0):** absorb the readout technique onto the resident model through the existing routed-inference path. That adds no new service, image or subscription. A different backend (Kev 0.8B, Zefan-Cai Open-Jev adapter, Laya) is adopted only if Phase 0 shows it beats the absorbed path by the margin in AC-TD-8. The same comparison must also name what the new backend retires.

## 4. Design

### 4.1 The typed-decision port (`apps/web/lib/inference/typed-decision/`)

This is one internal contract, shaped on the System One wire format so that backends can be swapped:

```ts
type TypedQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }  // ≤52 per pass
  | { type: "score";  instructions: string; criteria: string[] }                 // 2–10 ordered levels
  | { type: "noul";   instructions: string; criteria?: { true: string; false: string } };
type TypedAnswer = { probabilities: Record<string, number>; value: string | number; confidence: number | null;
                     backend: string; modelId: string; calibrationId: string | null; permutations: number };
decideTyped(state: TypedState, questions: Record<string, TypedQuestion>, opts: { stakes; budgetMs }): Promise<Record<string, TypedAnswer>>
```

- **Backend `logprob-readout` (default).** It goes through `routeAndCall` / `chat-adapter.ts` with a new logprobs request option (`max_tokens: 1`, `logprobs: true`, `top_logprobs: N`), a fixed prompt template that letters the options, and a shared state prefix so the KV cache is reused across questions. It reads the letter-token logprobs and applies the calibration temperature. Model eligibility comes from the `ModelCardCapabilities.logprobs` flag. **Whether DMR's llama.cpp build returns `top_logprobs` on the chat endpoint is unverified**; checking it is the first Phase 0 task (AC-TD-1).
- **Backend `system-one-http`** covers any wire-compatible server (Kev, the razorback16 or openjev helper). The hosted Jev endpoint is **disabled** until a separate WWMD data-egress decision exists. WWWD (org) state never goes to it by default.
- **Calibration** per (backend, model, quantisation, template version): a readout temperature fitted on the labelled set, ECE with a confidence interval, and the shuffle-instability rate. An answer without calibration has `confidence: null` and is **never** used outside shadow. Calibration does not transfer between backends or quantisations.
- **Option-order debiasing:** at `stakes` `elevated` or `high`, run k=2 (or 3) cyclic permutations and average the probabilities (a light form of PriDe). The permutation count is recorded on the answer.
- **More than 52 Choice options:** a tournament of groups of 52, then a final pass with the group winners.
- **Ceilings (enforced by the port, refused above them):** at most 64 questions per `decideTyped` call and at most 1 call in flight per interactive request. Larger fan-outs must be split by the caller and, if not interactive, queued (§4.4).
- **State hygiene:** the vendor itself reports that accuracy falls as irrelevant state grows, so every consumer passes the smallest state that answers the question. Sections, not whole documents; an ASC semantic summary, not a page dump.

### 4.2 Seam A: stance direction (WWWD/WSID)

Embedding retrieval stays. For each retrieved stance × option, one Choice question asks for the existing direction keys `support | oppose | neutral` (`decision-perspective/types.ts`). In shadow it is compared with the static direction field and does not replace it.

### 4.3 Seam B: feature fill, verification and more vectors per decision (`principle_decide`)

- **Fill.** Scope is the spine axes plus the calling profession's local axes (`DIMENSION_CATALOG[].scope`), never all 24 blindly. For each in-scope axis the caller left empty, a Score question uses 5 levels written from `DIMENSION_CATALOG[].highMeans`, with cost axes worded as magnitude. feature = score / 4. An axis whose confidence is below the stakes threshold stays missing.
- **Provenance.** Each fill is recorded in the existing `OptionEvidenceMap` as a **Grade D** citation (model judgment) whose locator points at the shadow-ledger row. Consequences, all by existing rules:
  - under `requireEvidence: true`, fills are dropped, because Grade D is inadmissible;
  - `measureFeatureCoverage` and `evaluateAutonomyEligibility` exclude typed fills, so a fill can never clear the `insufficient_signal` or `feature_coverage_weak` blockers before Phase 3 promotion.
- **Verify.** When the caller *did* supply a feature and the typed score disagrees by more than 0.35 with confidence ≥ 0.8, the disagreement is written to the shadow ledger. The caller's value is not overwritten.
- **Principle check fan-out.** One Noul question per principle per option asks "does this option breach *P*?" The principle set is the existing capped commandment list (`limit: 50` in `principle-decide-pack.ts`) plus at most 20 widened candidates. In shadow it only reports which principles the typed layer would have added.
- **Uncertainty propagation.** Sampling features from their Score distributions gives a rank-stability figure next to the existing ±10% weight sensitivity.

Vector count and ceiling for one decision with *n* options: at most (in-scope axes + 70 principles) · n answers, split into ≤64-question calls per option. At the interactive ceiling of n ≤ 4 options that is under 400 answers.

### 4.4 Seams C and D: many options and document review

- **C: many options.** When an LLM offers a set of options, one Choice question over the set gives an independent vote. If it disagrees with the weighted-sum winner, `typed-vote-disagrees` is added as a cause of the uncertain band (shadow).
- **D: document review.** A spec or plan is split into sections (at most 20; longer documents are reviewed by their 20 largest sections and the rest reported as skipped). Each section gets:
  - in-scope axis Score questions;
  - principle Noul questions (same capped set as §4.3);
  - craft rubric Score questions whose levels come from the relevant WSID profession corpus pages.

  Seam D is batch and advisory, so it runs through the `AsyncInferenceOp` queue, never inline on the interactive path. The output is a section × vector matrix attached to `reviewDesignDoc` / `reviewBuildPlan` as **advisory evidence** beside the existing LLM reviewers. It does not replace them. Worked size: 10 sections × (24 + ~60 principles + ~10 craft criteria) ≈ 940 typed answers in about 15 calls.

**Scale ceiling.** Everything above holds on one host GPU shared with interactive inference, for one install. Multi-GPU or offloaded batch scoring is out of scope here; it is lifted by the Phase 1 item under EP-0AF96937 if Phase 0 measurements (AC-TD-6 there) show the queue cannot keep up.

### 4.5 Seam E: coworker action selection on the user's current screen

The founder's target is a coworker that works *inside the screen the user is on* and does what it can see, at interactive speed. ASC already solves perception and authority. The typed layer adds a fast selector:

1. `surface_open` / `surface_snapshot` produce a compact semantic summary plus **only the currently authorized actions**, each carrying `actionClass`, `risk` and `confirmation`.
2. One Choice question over `{actionId…} ∪ {ASK_USER, DONE, NONE}`, with the user's utterance and the summary as state. Speculative Score/Noul questions ride in the same call: "does this action need text input?", "is the user's goal satisfied?".
3. If the chosen action needs free text (a form value, a message), the LLM writes **only that argument**, the same split browser-use uses.
4. Execution is always `surface_act` with `expectedRevision`. Domain actions re-enter ASC's governed dispatch: capability, grant, `AuthorityBinding`, confirmation, kernel and audit. **Confidence never substitutes for authorization.**
5. What the selector may do, keyed on the fields ASC already projects:
   - It may auto-run an action **only** if `actionClass === "ui-local"` and `confirmation === "none"`, and the calibrated confidence is above the routine threshold.
   - Every other action, including any domain action whatever its confidence, is returned to the user as a **proposal**: the action named with its `risk`, then executed through the same `surface_act` domain path only after the user confirms. The selector never auto-invokes a domain action.
   - Below threshold the result is `ASK_USER`, with the top two candidates named.

**Dependencies (Phase 2 cannot start without them).** Today ASC registers one surface (`ALL_SURFACE_DEFINITIONS = [DISCOVERY_OPERATIONS_SURFACE]`), and `surface_act` executes only the `set-value` UI-local effect. Navigate, focus, scroll, open-panel and select-entity are refused as `surface_action_unmapped`. Phase 2 therefore needs at least three registered surfaces and those UI-local effect kinds, which is the substance of BI-0DFE48B4.

What this gives the related items:
- **BI-0DFE48B4:** a fast "take me there" selector, once the effect kinds above exist.
- **BI-7BACFBEC:** a stated position. DPF coworker "computer use" means *selection over an authorized semantic graph*, not pixel control of the user's screen. Pixel and DOM driving stays confined to external sites through the existing browser-use sidecar (`2026-04-06-browser-use-integration-design.md`), where the same selector can also run over the sidecar's element table.

### 4.6 Safety

- State is untrusted input. The vendor documents that injected instructions can steer answers. Answers are constrained to question keys, and **no governed action is executed because of text inside the state**. This mirrors AC-MAIL-UNTRUSTED.
- Through Phase 1 the typed layer owns no final verdict. Promotion out of shadow happens per seam, through the shadow-ledger agreement window and a recorded WWMD decision.
- ASC withholds *unauthorized* actions, not destructive ones: an authorized delete is projected with its `risk` and `confirmation`. The selector therefore excludes nothing silently but **never auto-runs** anything outside the ui-local, no-confirmation class (§4.5). Financial trades and credential entry are never offered as auto-runnable targets.

### 4.7 Data

- **No new table.** Shadow proposals go to `DecisionShadowLedger` with a tuple that cannot touch any agent's trust window:
  - `agentId` = a dedicated typed-decision system agent, never a real coworker's id;
  - `activityType = "typed-decision:<seam>"` (`stance`, `feature-fill`, `feature-verify`, `principle-check`, `option-vote`, `document-review`, `surface-select`), which also gives the per-seam windows §4.6 promotes through;
  - `riskClass` derived from `stakes`;
  - `sourceKind = typed-decision`;
  - `proposedDecision` holds the answers (model id, question key, probabilities, confidence, calibration id, permutations);
  - `agreement = null` when there is no comparable actual value, such as a fill where the caller supplied nothing;
  - **one row per consult or document review**, not one per answer.
- **`sourceKind` becomes a typed enum.** It is a free-form `String?` today with four literals in use. Per AGENTS.md §8, Phase 0 adds a Prisma enum `DecisionShadowSourceKind` (the four existing values plus `typed-decision`) with its generated union and an in-place migration, rather than a fifth bare literal. Every ledger reader, including `regulatory-autonomy-runtime.ts`, filters on `sourceKind`.
- **Calibration** results are versioned JSON evaluation reports under `apps/web/lib/inference/typed-decision/calibration/` in Phase 0, produced by the harness and read by nothing at runtime. Where runtime calibration persists (per-install evaluated data vs a small table) is decided through `principle_decide` before Phase 2 (§9, question 4). It is never a `ModelCardSampling` field, which holds vendor guidance, not measured per-install values.

### 4.8 Model-weight licensing rule

A backend's **weights** are SPDX-identified in the same way as its code (`respect-open-source-license-terms`). Non-commercial weights (CC BY-NC*, CPML) may run only in a named research arm on hardware that does not ship, and never in a DPF release, image or install default. This follows the TTS precedent (`2026-05-28-tts-apple-silicon-local-design.md`).

## 5. Objectives

This item (BI-734E0C69) owns Phase 0 only. Its manifest:

**OBJ-TD-1:** DPF has one internal typed-decision contract (Choice/Score/Noul → calibrated probabilities) served by default from the resident local model through the routed-inference path, with swappable backends.

**OBJ-TD-2:** `principle_decide` stops returning zero signal for options that arrive without features, and caller-supplied features gain an independent check, with every typed value attributable, calibrated and kept out of coverage and autonomy measures until promoted.

**OBJ-TD-5:** No typed answer changes an outcome until its seam has measured accuracy, calibration and agreement on DPF's own data and a recorded decision promotes it.

Later-phase objectives, carried by their own items and specs when filed (not part of this item's manifest):
- Phase 1, many vectors: one decision or one document can be judged along many more vectors (axes × options, principles × options, criteria × sections) within the ceilings of §4.3–4.4.
- Phase 2, coworker surfaces: a coworker can choose its next action on the user's current Authorized Surface in sub-second time, without weakening ASC authorization.

## 6. Acceptance criteria

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-TD-1 | OBJ-TD-1 | A probe records whether the routed DMR chat path returns `top_logprobs` for the resident model. If it does not, the spike records the fallback it takes (llama-server sidecar on call, or `system-one-http`) and why. |
| AC-TD-2 | OBJ-TD-1 | `decideTyped` answers a Choice, a Score and a Noul in one call over a shared state, each answer carries backend, model id, calibration id and permutation count, and a call above 64 questions is refused. |
| AC-TD-3 | OBJ-TD-1, OBJ-TD-5 | Every backend tested has a calibration report with readout temperature, ECE with a 95% confidence interval and reliability plot on the AC-TD-10 set, and shuffle-instability rate. An answer without calibration has `confidence: null`. |
| AC-TD-4 | OBJ-TD-2 | In shadow, on a replay of ledger consults that had `insufficientSignal=true`, the typed fill would yield a non-null recommendation for at least 80% of them. The shadow row lists filled and still-missing axes, and the live response for every replayed consult is unchanged. |
| AC-TD-5 | OBJ-TD-2 | Verifier disagreements (more than 0.35 at confidence ≥ 0.8) are written to `DecisionShadowLedger` with both values, and no caller-supplied feature is overwritten. |
| AC-TD-8 | OBJ-TD-1, OBJ-TD-5 | The spike report has a license verdict for every candidate (weights and code) and a go / no-go per seam. A non-default backend is recommended only if, on the AC-TD-10 set, it beats `logprob-readout` by at least 3 points of accuracy or halves ECE with non-overlapping 95% intervals, and names what it retires. |
| AC-TD-9 | OBJ-TD-5 | No verdict, recommendation or executed action differs between shadow-on and shadow-off runs of the golden set and the replay set. Typed rows carry the dedicated agent id and a `typed-decision:*` activity type, and no existing agent's `TrustState` changes. |
| AC-TD-10 | OBJ-TD-1, OBJ-TD-5 | Before any ECE or backend-comparison verdict, a labelled set of at least 200 axis judgments (option × axis, labelled by the founder or the accountable WSID owner) exists and is versioned with the harness. No calibration claim is made on the 3-scenario golden set alone. |
| AC-TD-11 | OBJ-TD-5 | `DecisionShadowLedger.sourceKind` is a Prisma enum including `typed-decision`, the migration applies cleanly against existing rows, and `regulatory-autonomy-runtime.ts` filters its agreement window by `sourceKind`. |

## 7. Phasing

| Phase | Scope | Item |
|---|---|---|
| 0: spike (shadow) | Port, `logprob-readout` backend, labelled set, calibration harness, `sourceKind` enum; Seams A and B in shadow; license verdicts. AC-TD-1…5, 8…11 | **BI-734E0C69** (this item) |
| 1: breadth (shadow) | Seam C vote, Seam D document matrix via `AsyncInferenceOp`, principle fan-out, uncertainty propagation | to file after the Phase 0 go/no-go |
| 2: coworker surfaces | Seam E selector over ASC; Mailroom Choice backend as the first WWWD consumer | to file; blocked on ≥3 ASC surfaces and UI-local effect kinds (BI-0DFE48B4) |
| 3: promotion | Per-seam WWMD decision through the shadow-ledger agreement window; `utility-inference` `classify` callers migrate to Choice | per seam |

## 8. Non-goals

- Shipping any non-commercially licensed weights. Using hosted Jev without its own data-egress decision.
- Replacing the weighted-sum math, the LLM design reviewers, or embedding retrieval.
- Pixel-level control of the user's own screen.
- Letting the typed layer own any final verdict before Phase 3.
- Trading or any other financial decision.

## 9. Open questions

1. Does DMR expose `top_logprobs` on chat completions for GGUF models, and is prefix caching kept across questions? (AC-TD-1)
2. Is Zefan-Cai's Open-Jev 27B adapter trained on the same Qwen3.8-27B base that is resident? If it is, a LoRA load on the resident model could buy the tuning at no VRAM cost.
3. Who labels the AC-TD-10 set: the founder, or the accountable WSID owner per profession? A mixed set may be needed for profession-local axes.
4. Where does runtime calibration persist from Phase 2: per-install evaluated model data or a small table? To be settled through `principle_decide` before Phase 2.

## Traceability

| Requirement | Contracts | Plan phase | Verification |
|---|---|---|---|
| OBJ-TD-1 | §4.1 port, backends, ceilings, calibration | Phase 0 | AC-TD-1, AC-TD-2, AC-TD-3, AC-TD-8, AC-TD-10 |
| OBJ-TD-2 | §4.2 stance, §4.3 fill / provenance / verify | Phase 0 | AC-TD-4, AC-TD-5 |
| OBJ-TD-5 | §4.6 safety, §4.7 shadow tuple and `sourceKind` enum, §4.8 licensing | Phases 0–3 | AC-TD-3, AC-TD-8, AC-TD-9, AC-TD-10, AC-TD-11 |
