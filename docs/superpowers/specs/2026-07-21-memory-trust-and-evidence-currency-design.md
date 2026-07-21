# Memory trust and evidence currency — no tier trusted by default

_Status: DESIGN / proposed · 2026-07-21_
_Origin: operator observation following the WSID decision-tier investigation (PR #3344, EP-0AF96937)_

> **Thesis.** An AI coworker's beliefs arrive from four tiers — model weights, its own
> local memory, the collective corpus (WWMD/WWWD/WSID), and the external situation.
> None should be trusted by default. DPF instruments the **absence** of knowledge well
> and its **staleness** barely, and it records the epistemic status of every governed
> decision without ever consulting it. As autonomy rises, that converts silently into
> misallocated investment — or, in the better case, work that did not need doing.

---

## 1. The problem

The failure is not that a coworker lacks knowledge. Missing knowledge is loud: a gap is
recorded, a tier reads empty, a human notices. The failure is that a coworker **holds
knowledge that was true once**, retrieves it confidently, and acts on it — and every
health metric in the platform reads green while it happens.

Four tiers, four different silent failures:

| # | Tier | What it is here | How it goes wrong | Currently detectable? |
|---|---|---|---|---|
| 1 | **Model weights** | The LLM behind each coworker | Frozen at training cutoff; no provenance, no expiry, and the model cannot tell that a belief is dated | **No** — no representation at all |
| 2 | **Local agent memory** | `CoworkerMemoryNote`; client-side memory files for external agents | Written once, never falsified; survives the condition that produced it | Only by contradiction, if anyone looks |
| 3 | **Collective corpus** | `WikiPage` + `PerspectiveMaterial` behind WWMD / WWWD / WSID | Material ages; nothing re-derives it against reality | Partially — decay exists, detection is unproven (§4) |
| 4 | **External situation** | The market, the customer base, current architecture and tooling | Drifts continuously and invisibly; nothing samples it | **Effectively no** |

Tier 4 is the one that turns this from hygiene into money. A company can run for months on
a correct-in-March belief about its customers or its architecture, and nothing in the
system is positioned to notice.

### Why autonomy is the multiplier

At low autonomy a stale belief produces a bad *suggestion*, and a human filters it. At high
autonomy it produces a bad *action*, repeatedly, with the platform's own audit surfaces
reporting healthy. The cost ladder:

- **Cheapest:** effort spent where it was not needed — rework, re-litigating settled calls.
- **Middle:** confident wrong answers to operators who reasonably trust the governed surface.
- **Worst:** capital committed on an outdated model of the market or the estate.

This is why the control belongs on the *authority* axis, not only the *quality* axis.

---

## 2. What this install actually shows

All figures queried directly against the live database on 2026-07-21, after PR #3344.

### 2.1 The forgetting pipeline is complete; the promotion edge is missing

| Mechanism | Producer | Consumer |
|---|---|---|
| Profession corpus gaps (`ProfessionCorpusGap`) | **LIVE** — 2 writers, **24 open** | **none** — `status` is written `open` at creation and updated nowhere; **0 ever resolved** |
| Wiki lint (`WikiLintFinding`) | **LIVE** cron — **4,420 open** / 86 resolved | admin page only. **952** are `stance-extraction-needed` — a standing queue of "this should become WWWD stance" that nothing drains |
| Memory → WWWD promotion | **LIVE** cron | fires only on `scope="org"`; **all 38 `UserFact` rows are `scope="user"`**, **0 promoted**. Structurally a no-op |
| `contribute_to_hive` (outbound) | LIVE code path | carries **code, not knowledge** — requires a `FeatureBuild`; **0 `FeaturePack` rows ever**. A pure learning has no cross-install transport |
| Coworker working notes | full plane — write-time dedup, nightly batch dedup, LRU decay, recall-into-prompt | **0 rows.** Never exercised once |
| Thread compaction | wired | **0 of 287 threads** compacted; raw-message pruning is consequently dead |

The shape is consistent: DPF has a genuinely complete **forgetting** pipeline and a genuinely
complete **demand-signal** pipeline. What is absent, in every case, is the **promotion edge**
— the step that turns a detected gap into new corpus material, or a confirmed learning into
shared knowledge.

Three of the four lanes in the `dpf-route-learning-to-commons` skill terminate in a broken or
missing tool. Its WWWD lane instructs the agent to mark a superseded fact with
`flag_stale_knowledge`; that tool reads `KnowledgeArticle` (2 rows, both draft), not
`WikiPage`. Wrong store entirely.

### 2.2 The control is wired to a signal that is never produced

This is the crux, and the first two readings of it were wrong in opposite directions. Stated
precisely:

- The **aggregate** `freshnessDistribution` on the interaction **is write-only.** Six sites in
  `apps/web`, all writes or normalizations, **zero readers.** Confirmed by grep for property
  access, destructuring, and comparison.
- But **per-material `freshness` does gate a real branch.** In `material.ts`, `contradicted` and
  `superseded` set `effectiveWeight = 0` outright; other states multiply through
  `FRESHNESS_FACTORS`. That weight flows into the confidence computation, and confidence drives
  a hard escalate ladder in `evaluator.ts` (below `minimumConfidenceForRecommendation`, `<0.4`,
  `<0.7` → `escalate`). `principleConflict` forces `escalate` ahead of even the risk floor;
  `coverageGap` forces `defer`.

So the authority coupling I assumed was missing **already exists**. The mechanism is live,
correct, and load-bearing.

**It has never fired.** All 20 `PerspectiveMaterial` rows are `freshness = 'current'`, and 18
of them are grade A — permanently exempt from the decay sweep. Nothing has ever transitioned a
material out of `current`, so the weight penalty has never applied, so confidence has never been
reduced by staleness, so no decision has ever escalated because its evidence was old.

**This changes the fix.** The problem is not "wire freshness into authority" — that is done.
It is that **nothing ever classifies a material as anything but current.** The expensive half is
already built; the missing half is classification.

There is a related data defect: **159 of 185** decisions (86%) carry `materialCount > 0` with an
all-zero aggregate distribution, because several gates hardcode the zero literal instead of
calling `summarizeFreshness`. The aggregate is therefore unreliable as an audit signal even
though the per-material path underneath it is sound.

### 2.3 The escalation queue was not drained — it was hidden

Stated carefully, because two earlier readings of this were both wrong.

Clearing a gate requires **two** things (`persistence.ts`): an `EscalationCapture` row **and**
`humanOutcome.clearsGate === true`.

```
DecisionInteraction   185   (recommend 128 / escalate 50 / defer 7)
with humanOutcome      25   — all carry clearsGate: true
EscalationCapture       0
DeferralCapture         0
```

**All 25 have `humanOutcome`. None has a capture row. Therefore none of them clears its gate.**

The payloads show what happened: a bulk `{"type":"acknowledged", "reviewMode":"bulk-goal-directed"}`
write on 2026-07-10, referencing BI-9026B96C, performed out-of-band — **no code path in `main`
writes that type for a `DecisionInteraction`.** The founder review queue filters on
`humanOutcome IS NULL`, so those 25 vanished from the queue while remaining gate-blocking
everywhere else.

Net: **all 57 escalate/defer decisions remain unresolved for gate purposes, and 25 of them are
invisible in the surface built to review them.** That is a live governance defect, not a design
gap — and it is the same shape as the WSID tier reading "never used": a surface reporting health
because the thing that would show the problem was bypassed rather than satisfied.

### 2.5 The autonomy ladder is built and entirely unfed

Four independent trust/autonomy schemas exist. None is populated:

```
AgentGovernanceProfile   0 rows   (autonomyLevel — read only for display)
TrustState               0 rows   (currentLevel, defaults to "shadow")
DelegationGrant          0 rows
RegulatoryAutonomyPolicy 0 rows
DecisionShadowLedger     0 rows
```

Graduated autonomy is behind `DPF_BUILD_GRADUATED_GATE_AUTONOMY`, **unset on this install**, so
the gate hardcodes `riskTier = "medium"`. The gear-interface Governor's graduation arithmetic is
real but its only caller is a seed script. `isAutonomyCandidate` has zero non-test callers.
`EffectivePermission` is a **display type with no resolver.**

The inputs that actually determine what a coworker may do, exhaustively: **user capability +
agent tool grants + advise/act mode + external-access flag.** Risk tier, trust level, and
autonomy level are *not* inputs to tool authority.

One correction to the standing note that "proactivity is cadence, not autonomy": mostly true,
but `actionBoundary` is a real exception — `quiet → advise` strips every side-effecting tool
from the surface, and `propose` diverts side-effecting calls into `AgentActionProposal`
(17 rows, live).

### 2.6 Only one transition in the whole pipeline is quality-gated

`plan → build` blocks on decision quality — `build.ts` throws when the gate returns anything
other than `recommend`/`arbitrate`.

**`build → review`, `review → ship`, release bundling, promotion scheduling, promotion
execution, and self-upgrade are all quality-blind.** None of them reads `DecisionInteraction`,
confidence, or conflict state. A build can enter on a governed decision and ship without any
further evidence check.

### 2.4 Decision volume by gate, post-#3344

```
build-studio  170     org-business  10     profession  4     (pre-column)  1
```

The WSID tier is populated for the first time — and both of its non-probe rows carry
`gateFallbackUsed = true`, meaning the Enterprise Architect decided from **platform doctrine,
not its own craft corpus**, because that corpus has no material for the decision class. The
tier is no longer silent; it is now honestly reporting that it is ungrounded. That distinction
did not previously exist.

---

## 3. The worked example: this session

Tier 2 failed, visibly, in this repository, for about seven weeks.

Two memory files dated 2026-05-29 asserted a **standing override**: *"Build Studio is not
working — do all development directly, until further notice."* Both were contradicted by a
2026-06-04 file recording Build Studio working end-to-end, and superseded again by the current
`build-studio-suitability-boundary` rule. Neither was indexed, so neither surfaced for review;
both would have been retrieved by name.

Nothing in the system was positioned to notice. The note had no expiry, no owner, no
re-derivation against the condition it described, and — critically — **no representation of
the fact that it was a claim about a mutable state of the world** rather than a durable rule.
An autonomous coworker reading it would have routed every piece of work away from Build Studio
and been unable to explain why beyond "my memory says so."

That is precisely the cheapest rung of the cost ladder in §1, and it was found by accident
during an unrelated consolidation pass.

### 3.1 A second instance, in this very investigation

The subagent survey that produced much of §2 asserted two things that verification contradicted:

- that `detectStaleClaims` "silently no-ops for lack of `retrievedAt`" — in fact **293 of 384**
  page-source links carry it (76%);
- that the growth-gap loop closes — it does not, but I had earlier described it to the operator
  as though it did, reading a dashboard as a mechanism.

A third instance is the most on-the-nose. One survey reported that `gateFallbackUsed` **"does not
exist — 0 hits repo-wide."** It had existed for about an hour. The agent was reading a checkout at
`a4573f52`, which predates the merge of PR #3344 — a **stale snapshot of the world, reported with
total confidence, in a survey about stale snapshots reported with total confidence.**

Note what this is not: the agent did not hallucinate. Its grep was correct, its reasoning was
correct, and its conclusion was false — because its evidence was out of date and nothing in its
context carried the age of that evidence. That is precisely the failure class in §1, and no amount
of care by the agent would have caught it. Only re-derivation against current state did.

All three were caught only because the claims were re-checked before use. The lesson is not
"subagents are unreliable"; it is that **an unverified claim looks identical to a verified one once
it is written down** — which is the entire problem this document is about, reproduced three times
inside the investigation of it.

---

## 4. Two structural asymmetries

### Asymmetry A — absence is instrumented, staleness is not

A corpus gap fires when retrieval returns **nothing**. Nothing fires when retrieval returns
something **out of date**. On the profession-corpus panel, `MISSES 0 / INJECTION RATE 100%` is
fully compatible with a corpus that is entirely stale: every metric measures whether *something*
was retrieved, never whether it was *still true*.

The one detector built for this — `detectStaleClaims`, 180-day source-retrieval threshold — has
**never fired**, and the honest reason is not that it is broken:

- 76% of page-source links carry `retrievedAt`; the remaining 24% are invisible to it permanently;
- the **oldest source on this install is 41 days old** against a 180-day threshold.

It is **unproven, not broken**. That distinction matters for the fix: the detector may work, and
we have no evidence either way. An unexercised detector is not evidence of health.

`PerspectiveMaterial` tells the same story: 20 rows, **all `current`**, with a decay job that
demotes grade B/C/D material after 90 days and exempts first-party grade A permanently.

### Asymmetry B — the control is built; the signal that drives it is never produced

§2.2. This is the inverse of what it looks like from the outside, and it is good news for cost.
Per-material `freshness` already modulates authority through `effectiveWeight → confidence →
escalate`. The wiring is live and correct. It has simply never been exercised, because
**nothing ever moves a material off `current`** — the only classifier is a 90-day timer that
exempts 90% of the corpus.

So the two asymmetries compose into one sentence: **DPF detects that it knows nothing, and
cannot detect that what it knows is old — while holding a working brake that only a staleness
signal can pull.**

That also identifies the host for the control rather than inventing one. **EP-7B169558** already
ships a `WorkWarrant` metering execution by *altitude* and *blast radius*; evidence currency is a
third input on that existing spine. And §2.6 shows where the brake is missing entirely — every
transition after `plan → build`.

---

## 5. External research

Evidence graded **strong** (peer-reviewed, replicated or large-N), **mixed** (peer-reviewed but
narrow or contested), **thin** (preprint-only, vendor-authored, or asserted without measurement).
Vendor material is flagged as such.

### 5.1 A plausible stale fact is the worst case, not the best case

The intuition that a stale-but-reasonable belief is "mostly harmless" is backwards.

- **ClashEval** (Wu et al., Stanford, NeurIPS 2024 D&B — [arXiv:2404.10198](https://arxiv.org/abs/2404.10198))
  perturbed retrieved documents across ~1,200 questions in six domains. Six frontier models,
  GPT-4o included, **overrode their own correct prior in favour of incorrect retrieved content
  more than 60% of the time.** _Strong._
- Critically, adoption is **confidence-weighted**: implausible perturbations get rejected,
  and adoption rises as the model's own prior weakens. So the errors that get caught are the
  absurd ones. **A stale fact that still sounds right is adopted silently.** _Strong._
- Faithfulness does not improve with scale — **FaithEval** (Ming et al., Salesforce, ICLR 2025)
  reports GPT-4o at 96.3% on standard factual QA collapsing to **47.5% under counterfactual
  context**. _Mixed→strong._

**Consequence for DPF:** a stale WWMD/WWWD/WSID page in the retrieval path is not a weak input
the model will discount. It is an input the model will prefer over its own correct knowledge,
most of the time, precisely when it is plausible.

### 5.2 The weights are a stale tier, and worse than "cutoff" implies

- **Set the Clock** (Zhao et al., ACL Findings 2024 — [arXiv:2402.16797](https://arxiv.org/abs/2402.16797)):
  LLaMA-2 has a Sept-2022 cutoff but answers as though it were **~2019**. Target-year F1 was
  **17.2% unaligned → 27.4% with time-aware prompting**. The authors describe "a chaotic sense
  of time". _Strong._
- **Dated Data** (Cheng et al., JHU, COLM 2024 — [arXiv:2403.12958](https://arxiv.org/abs/2403.12958)):
  the *effective* cutoff routinely predates the announced one, per topic. **"It's within the
  model's cutoff" is not a valid freshness argument.** _Strong._
- Degradation past the training window is monotonic and **not fixed by scale**
  (Lazaridou et al., DeepMind, NeurIPS 2021 — [arXiv:2102.01951](https://arxiv.org/abs/2102.01951)). _Strong._

**Consequence for DPF:** tier 1 in §1 is not a hypothetical. Time-aware prompting is a cheap,
real, partial mitigation that DPF does not currently apply.

### 5.3 Retrieving an update is not the same as revising a belief

**STALE** ([arXiv:2605.06527](https://arxiv.org/abs/2605.06527), _thin_ — 2026 preprint,
unreviewed) tests whether agents notice their memories are no longer valid: 400 expert-validated
scenarios, leading models at **55.2%**. Its useful contribution is the construct
**"implicit conflict"** — a later observation invalidates an earlier memory *without explicitly
negating it*, so no contradiction detector fires.

The Build Studio memory in §3 is a textbook implicit conflict. Nothing ever said "Build Studio
is working now" in a form that contradicted the stored note; the world simply moved.

### 5.4 There are only three proactive staleness mechanisms

This is the most directly actionable result of the research. Systems that detect staleness
*before* a query misses use one of exactly three mechanisms:

| # | Mechanism | Strength | Cost | Covers |
|---|---|---|---|---|
| 1 | **Write-time supersession** — a new fact about the same (subject, relation) retires the old into a bitemporal ledger. Deterministic; no similarity threshold, no LLM call | **Strongest** | Low at write | Anything with a stable key |
| 2 | **Diff against source-of-truth** — CDC / re-crawl / identifier existence checks | Strong where applicable | Medium | Only where an authoritative machine-readable source exists |
| 3 | **Time-based expiry** — TTL, review-by date, freshness SLA | **Weakest** — detects *suspicion*, not staleness | Lowest | Everything, including judgement and stance |

The blunt summary from the review: *anything claiming to detect semantic staleness without one
of these three is doing absence-detection with better marketing.* Mechanism 1 is the strongest
and least deployed; mechanism 3 the weakest and most deployed.

Mechanism 1 is not an AI advance — it is bitemporal modelling, a 1980s database technique
(SQL:2011 system- and application-time periods). The reference implementation in agent memory is
Zep/Graphiti's edge invalidation, four timestamps per edge, superseded rather than deleted
([arXiv:2501.13956](https://arxiv.org/pdf/2501.13956) — design credible, _evaluation is
vendor-run and unreviewed_).

#### The finding that reframes DPF's position

**DPF already implements mechanism 1 — in the tier that has zero rows — and only mechanism 3 in
the tier that carries every governed decision.**

| | `CoworkerMemoryNote` | `PerspectiveMaterial` |
|---|---|---|
| Rows | **0** | **20** (backs all of WWMD/WWWD/WSID) |
| Supersession lineage | `supersededAt` + `supersededById` ✅ | **none** |
| Write-time dedup/supersede | mem0-style add/noop/update/supersede ✅ | **none** |
| Decay | LRU, 28-day | time-based, 90-day |
| Exemptions | — | **grade A never decays** |

And the live state of that 20-row corpus: **18 are grade A — permanently exempt from decay —
last validated once at seed on 2026-06-08 and never re-validated. The other 2 have never been
validated at all.**

So the strongest available mechanism is built and unused; the weakest is deployed and exempts
90% of the corpus from itself.

### 5.5 There is no standard to adopt for claim-level provenance

W3C PROV-O (Recommendation, 2013) is the canonical vocabulary with real but *niche* adoption —
science, workflows, and notably **HL7 FHIR's `Provenance` resource**. It can express source and
generation time (`prov:wasDerivedFrom`, `prov:generatedAtTime`) but **confidence is not in the
core vocabulary**. C2PA is asset-level, not claim-level. RAG citation practice is unstandardised
and per-vendor.

**There is no adopted standard for attaching source + retrieval-time + confidence to a stored
claim.** Building one is legitimate; calling it a standard is not. The defensible shape is
PROV-O naming + a bitemporal pair (`valid_from`/`valid_to`, `recorded_at`/`superseded_at`) + an
explicit confidence field, described as a local convention.

### 5.6 On governance-by-review-cycle — the practice with no evidence

Named owners, quarterly review cycles, and expiry-by-default are universally recommended and,
as far as the review could establish, **never independently validated**. No controlled study,
no longitudinal measurement. The widely-circulated "15–25% higher ticket volumes without content
governance" figure appears only in vendor marketing with no traceable source. _Thin — do not cite._

The one governance practice with real empirical backing is **automated** detection against a
source of truth: **23.0% of analysed repositories contained stale code-element references**,
found by checking whether identifiers named in docs still exist in the code
([arXiv:2212.01479](https://arxiv.org/pdf/2212.01479)). _Mixed→strong._ That is mechanism 2
applied to prose — and DPF already has the shape of it in the **Doc Reference Integrity** CI gate.

Documentation rot itself is well-replicated: more than two-thirds of practitioners believe their
system documentation is outdated (EMSE 2023). _Strong as a qualitative finding._

**Implication:** a proposal resting on "we will review the corpus quarterly" is resting on the
weakest available evidence. Weight the automated mechanisms accordingly.

### 5.7 Take freshness adjudication away from the model

The best-evidenced single intervention in the review, and it is cheap.

**"Don't Ask the LLM to Track Freshness"** ([arXiv:2606.01435](https://arxiv.org/abs/2606.01435),
_thin — 2026 preprint, but methodologically convincing_) diagnoses two failures and fixes both by
moving work out of the model:

- **Prior override** — when a stored fact conflicts with training-data knowledge, the model emits
  the familiar training answer *regardless of explicit freshness instructions and version numbers*.
  Your memory can be correct, retrieved, and still lose.
- **Serial-comparison drift** — as the candidate pool grows, the model loses track of which version
  marker is largest.

Recipe: retrieve → **LLM decides only semantic relevance** → **deterministic code picks the newest**
(`max` over a monotonic serial). Reported **+10.8pp average (67.2 → 78.0)** and **+21pp at 262K
context**.

**The generalisable principle: freshness is a total order over a monotonic key. That is a `max()`,
not a reasoning task.** Zep's bitemporal edges are the same insight expressed in schema.

This matters for DPF because it means the classification gap in §2.2 does **not** require an LLM
pass over the corpus. It requires a key and a comparison.

### 5.8 The write path is where the errors are born

**HaluMem** ([arXiv:2511.03506](https://arxiv.org/abs/2511.03506), _mixed — the strongest direct
evidence available_) is the first operation-level benchmark separating extraction / update / QA over
~1M-token contexts. **Memory update accuracy falls below ~26% on the medium split and to near zero
on the long split.**

That is the mechanistic explanation for the whole staleness literature: every system that asks an
LLM to decide UPDATE-vs-ADD-vs-DELETE is getting that decision wrong most of the time at scale.

**DPF is accidentally on the right side of this.** `CoworkerMemoryNote`'s write-time consolidation
is **deterministic** — Jaccard similarity over note *keys* with a fixed threshold — not an LLM
adjudication. That is the design the research recommends. It is in the tier with zero rows.

Corroborating: **MemConflict** ([arXiv:2605.20926](https://arxiv.org/abs/2605.20926), _thin_) scores
six production memory systems 0.28–0.55 on conflict handling, and finds **static** conflicts hardest
— systems overwrite a correct fact with an incorrect newer mention. **Memora/FAMA** (ACL 2026
Findings, [arXiv:2604.20006](https://arxiv.org/abs/2604.20006)) introduces a metric that *penalises
reliance on obsolete memory* and concludes: "frequent reuse of invalid memories… memory agents offer
marginal improvements."

### 5.9 Two failure modes DPF has already exhibited

**Reflection-induced false-belief entrenchment.** The 2026 survey names it precisely — *an agent
that concludes "X always fails" stops testing X, and the belief becomes unfalsifiable* — and notes
that **nobody has ever quantified it.**

The Build Studio memory in §3 is a literal instance: *Build Studio is not working → route work away
from Build Studio → never exercise Build Studio → the belief cannot be falsified.* It survived seven
weeks and two contradicting records precisely because acting on it removed the evidence that would
have refuted it. This is a named, unmeasured failure mode of the field, reproduced in this
repository.

**Premise resistance.** STALE's third probe asks whether an agent rejects a question that
presupposes a stale state. An agent that accepts a false premise embedded in an operator's own
question will confidently act on a state neither party has checked — the operator's trust and the
agent's memory failing in the same direction at once.

### 5.10 Memory is a persistence layer for untrusted input

An angle worth naming because DPF's corpus is fed from scraped and uploaded sources via
`enrichOrgCorpus`/`RawSource`.

**MINJA** ([arXiv:2503.03704](https://arxiv.org/abs/2503.03704), _mixed — attacker-authored, idealised
conditions_) reports **>95% injection success through ordinary user queries alone**, with no
privileged access to the store. Memory poisoning differs from prompt injection in **persistence**: one
injection biases behaviour across all future sessions, and — the structural point — *the agent trusts
its own memory implicitly, so a poisoned belief is indistinguishable from a legitimate one.*

Provenance on every stored claim is the obvious partial defence, and is absent from almost every
system surveyed. It is the same field DPF needs for staleness. **One mechanism, two payoffs.**

### 5.11 Do not trust the benchmark numbers, including the good ones

The field's evaluation layer is its weakest part, and this bears directly on how much weight any
proposal here should carry.

- **LoCoMo** — the most-cited memory benchmark — has documented gold-label errors, task-disclosure
  bias, and length-biased metrics, and **a trivial filesystem baseline scores competitively on it.**
  A benchmark that cannot separate `grep` from a knowledge graph is not measuring what the field
  claims.
- Two vendors published **three different numbers for the same system on the same benchmark —
  84%, 75.14%, 58.44%** — and publicly accused each other of misconfiguration. No third party can
  adjudicate, because the contested choices are not prescribed by the benchmark.
- **ConvoMem** (Salesforce, _mixed_) finds plain full-context beats a production memory system
  (70–82% vs 30–45%) on histories below ~150 conversations.

**Implication: memory systems are a well-established _cost_ win and an unestablished _accuracy_ win.**
Any DPF proposal should be justified on auditability and governance grounds — which are real and
specific to this platform — not on borrowed accuracy claims. Steal the *structure* of LongMemEval's
knowledge-update and abstention categories and STALE's premise-resistance probe for an internal eval;
do not import the numbers.

### 5.12 Where the field has no answer

Stated so the proposal does not overclaim:

1. Whether elaborate memory architectures beat full context on accuracy at realistic scale.
2. The compounding-error curve for repeated consolidation — theoretically predicted super-linear,
   **never measured**.
3. Reflection-induced false-belief entrenchment — **zero quantification anywhere** (§5.9).
4. Whether forgetting improves *accuracy* as opposed to cost.
5. Supersession vs deletion, head to head — no controlled comparison, despite being the central
   schema decision.
6. Governance of shared memory across multiple agents — whose write wins. **This is precisely DPF's
   situation**, and it is an open problem with no implementations of note.

## 6. What the evidence says about gating autonomy — including what *not* to build

### 6.1 Do not build a confidence-threshold autonomy gate

The obvious design — "act above confidence X, escalate below" — is the one the evidence
least supports.

- **RLHF degrades calibration.** OpenAI's own GPT-4 report: the pre-trained model is well
  calibrated and "after the post-training process, the calibration is reduced"
  ([arXiv:2303.08774](https://arxiv.org/abs/2303.08774)). _Strong._
- **Verbalized confidence is prompt-sensitive** — the number moves when you rephrase the
  question, which is fatal for a fixed threshold. _Mixed._
- **Uncertainty quality degrades *faster* than accuracy under distribution shift**
  (Ovadia et al., NeurIPS 2019, [arXiv:1906.02530](https://arxiv.org/abs/1906.02530)) — models
  become *confidently wrong* exactly in the regime where the gate matters. _Strong._
- **Confidence-based deferral is provably suboptimal** versus learning-to-defer, because it
  ignores whether the human is actually better on that instance
  (Mozannar & Sontag, ICML 2020). _Strong theory._
- **Conformal guarantees are marginal, not conditional, and assume exchangeability** — and
  exchangeability dies in an agentic loop, where step *n* is conditioned on the agent's own
  step *n−1* output. The guarantee is voided the moment the agent's actions shape its input
  distribution. _Strong — it is a theorem._

There is one existence proof of confidence-gated autonomy done properly — **KnowNo**
(Ren et al., CoRL 2023, [arXiv:2307.01928](https://arxiv.org/abs/2307.01928)), where a robot acts
when the conformal prediction set is a singleton and asks for help otherwise. It works because the
action space is small, calibration is per-task, and the guarantee is re-earned. None of those hold
for a general coworker.

### 6.2 Do not assume escalation is a safe default

DPF's evaluator escalates readily. The evidence says that is not automatically a win.

- **Human+AI combinations on average underperform the *better* of human or AI alone on
  decision tasks** — preregistered meta-analysis, 106 studies, 370 effect sizes
  (Vaccaro, Almaatouq & Malone, _Nature Human Behaviour_ 2024). Losses concentrate in decision
  tasks; gains in creation tasks. _Strong._
- **Automation complacency is robust, appears in experts, and "cannot be overcome with simple
  practice"** (Parasuraman & Manzey, _Human Factors_ 2010). _Strong._
- **Mandated human oversight without evidence it works mainly launders accountability**
  (Green, _CLSR_ 2022 — 41 policies surveyed). _Strong argument._

**Implication for §2.3:** the 25 bulk-acknowledged decisions are not an anomaly, they are the
predicted outcome. A queue that asks a human to *review* rather than *decide* gets rubber-stamped.
An escalation must transfer a decision with the evidence attached, or it is worse than no gate.

### 6.3 The mechanism that does work: age of last verification

Every hard, enforced, real-world staleness gate found in the review shares one design — and it is
not in AI.

| Mechanism | What is gated | Interval | Enforced? |
|---|---|---|---|
| IFR VOR accuracy check (14 CFR 91.171) | age of the **verification**, not the equipment | 30 days | Legally |
| Altimeter / static system (14 CFR 91.411) | age of test | 24 calendar months | Legally |
| Nav database currency (FAA AC 90-105A) | age of the **world model** | 28-day AIRAC cycle | Operationally |
| Pilot recency (14 CFR 61.57) | age of the **operator's** competence evidence | 90 days / 6 months | Legally |
| Minimum Equipment List | known capability gap | 3 / 10 / 120 days by category | Yes |

> **The transferable principle: the gate is on the age of the last successful verification, not on
> a live estimate of correctness.** Nobody asks whether the altimeter is actually wrong; the question
> is whether the check is in date.

This is the whole virtue of the design: **it fails safe when the monitoring is itself broken**,
whereas a confidence gate fails *open* precisely when the model is most wrong (§6.1). The MEL
pattern is the companion: a known-degraded capability does not stop operation, it **starts a clock
and narrows the envelope**.

### 6.4 Two cautionary analogues

**Clinical decision support** is the best-documented instance of the exact failure: *"the rule was
right when written, the world moved, nobody noticed."* Nearly all surveyed health systems reported
CDS malfunctions from new codes, software updates, and silently toggled rules — and lacked tooling
to detect them (Wright, Sittig, Bates et al., _JAMIA_ 2016). _Strong._

**GRADE** shows that grading evidence does not constrain action unless something enforces it:
guideline panels routinely issue *strong* recommendations from *low-certainty* evidence. _Mixed._

That second one indicts DPF's schema directly. `PerspectiveMaterial.evidenceGrade` **exempts grade A
from decay permanently** — the material held to be most authoritative is the material never
re-checked. Aviation inverts this: the more critical the system, the *shorter* the verification
interval. **DPF's exemption is backwards, and it currently covers 18 of 20 rows.**

### 6.5 We would be building ahead of the frameworks, not complying with them

Worth stating plainly so this is not oversold internally.

- **NIST AI RMF** gets closest and is genuinely close — it names the risk ("datasets… may become
  **stale or outdated** relative to deployment context"), and MANAGE 2.4 + MEASURE 2.6 together say
  disengage when operating "**beyond its knowledge limits**." But it is **voluntary and
  thresholdless**.
- **EU AI Act Art. 14** (human oversight) contains **no** evidence-currency or provenance
  requirement — it is the one binding law that names automation bias, while providing no evidence
  the oversight it mandates is effective. Art. 10 requires provenance and updating, but for
  **training** data at conformity assessment, not runtime evidence.
- **ISO/IEC 42001 A.7.5** (data provenance) is a **recording** obligation, not an authority control.

**No framework requires a deployed system to reduce its autonomy when its evidence is old.** The
claim that regulation demands this is not supportable today.

## 7. Proposal

Ordered by evidence strength and cost. Each names its host — none proposes a new control plane.

### P1 — Make freshness classification real _(highest value, lowest cost)_

§2.2 established that the authority coupling **already exists and works**: per-material
`freshness` → `effectiveWeight` → confidence → escalate. It has never fired because nothing
classifies. So:

1. **Re-key decay on age-of-last-verification**, not age-of-creation — the §6.3 principle.
   `lastValidatedAt` already exists on `PerspectiveMaterial` and is set once at seed.
2. **Invert the grade exemption.** Grade A must have the *shortest* interval, not an infinite one
   (§6.4). This single change moves 18 of 20 rows from "never checked" to "checked on a clock."
3. **Keep it deterministic.** Interval arithmetic and monotonic-key comparison, no LLM adjudication
   (§5.7, and §5.8's sub-26% LLM update accuracy).

**Expected effect:** a live brake that has never engaged begins to engage, and a WSID/WWMD decision
resting on unverified material loses confidence and escalates *on its own existing path*.

### P2 — Supersession lineage on corpus material

Copy the schema `CoworkerMemoryNote` already has (`supersededAt`, `supersededById`) onto
`PerspectiveMaterial`, plus a validity interval. This is mechanism 1 from §5.4 — the strongest
proactive mechanism, and a 1980s database technique, not an AI advance. Supersede, never delete
(§5.4, §5.8).

Second payoff: provenance-on-every-claim is also the partial defence against memory poisoning
(§5.10), and DPF's corpus is fed from scraped and uploaded sources.

### P3 — Close one promotion edge, as proof

`ProfessionCorpusGap → enrichOrgCorpus`. **24 real open rows** are already waiting, the landing
zone already exists and is draft-by-default. This is the shortest path to proving the promotion
edge can close at all (§2.1).

### P4 — Repair the escalation gate-clear defect _(live bug — filed as BI-6EC1EE25)_

§2.3. 25 interactions carry `humanOutcome.clearsGate: true` with **no `EscalationCapture` row**, so
none actually clears; they are hidden from the review queue while still blocking. No code path in
`main` writes that outcome type.

Per §6.2, do not simply re-surface them: an escalation must **transfer a decision with its evidence**,
not request a review. The bulk-acknowledge is what a review-shaped queue produces.

### P5 — Extend quality gating past `plan → build`

§2.6 — every downstream transition is quality-blind. Evidence currency is a natural third input to
the **`WorkWarrant`** already shipped under **EP-7B169558**, alongside altitude and blast radius.

### P6 — A kernel principle (WWMD)

> No memory tier is trusted by default. A retrieved claim carries its provenance and the age of its
> last verification; **absence of a freshness signal is treated as stale, not as current**; and
> authority is gated on the age of verification rather than on a confidence estimate.

The default matters most. Today an unclassified material is `current` — the system's null value is
its most trusting value, which is why 20 of 20 rows read healthy.

### Explicitly not proposed

- **A confidence-threshold autonomy gate** — §6.1.
- **Quarterly human review cycles as the primary mechanism** — §5.6: universally recommended,
  never validated; the only governance practice with empirical backing is automated detection
  against a source of truth.
- **An LLM pass to judge corpus freshness** — §5.7, §5.8.

### Open questions for the founder

1. **Tier 4** (§1) has no representation at all. Is "is what we believe about our market still
   true?" a corpus problem, a scheduled research problem, or out of scope for now?
2. P1 will **increase escalation volume** by design. Given §6.2, what should receive those
   escalations so they are decided rather than acknowledged?
3. Should this be a new epic, or items under **EP-7B169558** (decision-altitude) and
   **EP-31815F97** (authority model)?
