# Coworker Competence Flywheel — the platform's per-instance excellence engine

**Date:** 2026-07-21
**Status:** DESIGN / proposed
**Area:** cross-cutting — coworker runtime, WSID profession corpus, memory, decision governance
**Epic:** `EP-COMPETENCE-FLYWHEEL`
**Origin:** operator framing, 2026-07-21 — "the platform is built in anticipation to be used, exercised and populated per instance. I can only provide the WWMD corpus to get it started, on a path to be fleshed out further by every user of this platform, every real business that exercises the processes we built into this platform, to allow all users to achieve excellence, iteratively, while maintaining it safely."

> **Thesis.** DPF ships one thing and grows the rest. The founder seeds the WWMD kernel;
> every other body of knowledge, memory, and calibrated judgment is meant to accumulate
> *per instance*, from each real business exercising the platform. That makes the machinery
> which converts **exercise → durable, improving, safe competence** the platform's core
> operating engine — not a feature. This document establishes that engine as a first-class
> design object: the **competence flywheel**. An audit across three pillars finds the
> flywheel is **designed and largely built, but not driven** — the stores and read-paths
> exist, while the acquisition edges, the feedback edges, and the safety governors that
> would spin it are missing or dead. This is the design to close them.

---

## 1. The operating principle

DPF is not shipped complete. It is shipped as a **capable-but-empty apparatus** plus one
seed:

- **What the founder provides:** the WWMD founder-kernel — commandments, core and contextual
  principles, the dimension registry, the decision-scope doctrine (WWMD / WWWD / WSID). This
  is the *bootstrap*, deliberately small and deliberately the only thing hand-authored.
- **What every instance grows:** its own profession knowledge (WSID depth beyond the seed),
  its own business stance (WWWD), each coworker's accumulated craft memory, and the
  calibration of judgment that comes from having decided and seen the outcome.

The promise to a customer is therefore not "a finished product." It is: *a business that
exercises these processes will, over time, get measurably better at them — and stay safe
while doing so.* That is a **flywheel**: work is exercised → the exercise is captured → the
capture is reviewed → the review improves the next decision → the business compounds toward
excellence. Every turn should leave the instance more competent than the last, and never
more dangerous.

This principle has a direct, load-bearing consequence for engineering: **an empty store on a
fresh install is correct, not broken.** `CoworkerMemoryNote` at zero rows, a new archetype
with no corpus, a decision ledger with no outcomes — on a not-yet-exercised install, all of
these are the designed initial state (the seed-is-bootstrap / structural-≠-functional
principles). Judging the platform by whether the *seed* is complete is the wrong test. The
right test is: **when a real business exercises it, does competence actually accumulate — and
safely?**

That is the test the flywheel must pass, and today it does not.

---

## 2. The flywheel and its three pillars

A professional is competent because three things compound over a career: they **know** their
field (and keep current), they **remember** what they have done (what worked, what failed,
this client's context), and their **judgment** is refined by having decided and been held to
account for the outcome. A DPF coworker is meant to be a professional. The flywheel therefore
has three pillars, each a loop:

| Pillar | The professional analogue | The DPF loop |
|---|---|---|
| **Knowledge** | Best practice; standing on predecessors' shoulders | exercise surfaces a knowledge need → the corpus is grown and kept current → the next coworker is better grounded |
| **Memory** | Remembering what worked, what failed, this client | work produces experience → experience is distilled into durable memory → recalled, and falsified when the world changes |
| **Judgment** | Deciding, being held to the outcome, calibrating | a decision is recorded with its reasoning → its outcome is captured → judgment is calibrated, safely |

Each loop has the same three-part anatomy, and it is the same part that is missing in all
three:

- a **store** (where the compounded competence lives) — **built** in every pillar;
- a **read path** (how it reaches the coworker at the moment of work) — **built**, with gaps;
- an **acquisition edge** (exercise → store) and a **feedback/safety edge** (outcome →
  improvement, and staleness → distrust) — **missing or dead** in every pillar.

The rest of §2 is the evidence, pillar by pillar. Every claim is anchored to `file:line` in
the codebase as of this date.

### 2.1 Knowledge — the corpus is read on the wrong path and never grows or ages

**Built and working.** A real WSID corpus (166 markdown pages across 23 profession families,
`docs/professions/<key>/wiki/*.md`), a strong binding from coworker → profession family
(`docs/professions/registry.json`, `resolve-profession-profile.ts:98`, with invariants in
`resolve-profession-profile.test.ts:173-225` guaranteeing every registry role maps to exactly
one family with ≥1 source and ≥1 page), a fail-open retrieval service explicitly designed to
swap lexical→vector behind one interface (`profession-corpus.ts:15-19,399`), an
install-variant model (archetype + four-basis jurisdiction) wired into eligibility, and a
demand-signal loop (`ProfessionCorpusGap`, `ProfessionCorpusUsageStat`) that records what
coworkers could not ground. Provenance is lint-enforced (every published page must cite a
fetched source; `wiki/lint-detectors.ts:363`) and the open-vs-licensed **conduit rule** is
respected. The archetype provisioning playbook (PR #3352) now guarantees every *new* archetype
ships with seed corpus.

**The missing edges.**

1. **The autonomous work path is corpus-blind.** `professionContext` is injected in exactly
   one place — the interactive chat path (`agent-coworker.ts:931`, rendered above generic
   wiki recall at `prompt-assembler.ts:214-220`). The background executor
   (`agent-thread-dispatcher-runtime.ts`) never calls `resolveProfessionCorpusContext`. So a
   build-lane coworker is *bound* to a profession family but does its actual build work
   **without** its craft knowledge — grounding is absent at exactly the moment it matters
   most. (BI-744D583B.)
2. **The growth loop has no closing edge.** `ProfessionCorpusGap` accumulates open rows with a
   `suggestedSource`, but nothing converts an open gap into a reviewed, sourced page. Demand is
   instrumented; supply never follows. (BI-BE9C95D9.)
3. **No freshness lifecycle.** `material-freshness.ts` decays *decision* material, not the
   profession corpus. Pages carry a `retrievedAt` on their source but nothing ages,
   re-validates, or down-weights a stale page; the only corpus lint is *unsourced*, not
   *stale*. Standards drift (OWASP, WCAG, tax/jurisdiction rules) silently. (BI-BE9C95D9.)
4. **Adjacent limits:** retrieval is lexical keyword (3 pages × 320 chars), so paraphrased
   queries miss; `professionCompetencyLevel` is captured but inert at retrieval; licensed BoKs
   are checklist-only with the org-upload path unbuilt; and a coworker minted at runtime via
   `establish_coworker` has no gate guaranteeing it binds to a family (the conformance test
   omits it) — it would run corpus-blind and only log `missed-unmapped`.

### 2.2 Memory — the store is never written and never falsified

This pillar has its own detailed treatment in
[`2026-07-21-memory-trust-and-evidence-currency-design.md`](2026-07-21-memory-trust-and-evidence-currency-design.md);
it nests under this epic as the memory-and-trust facet. In brief:

**Built.** Three layers — per-user relationship memory (`UserFact`, auto-extracted each turn),
per-thread continuity (`AgentThread.compactedSummary` checkpoint), and the per-coworker craft
store `CoworkerMemoryNote` (schema:2760: typed notes, supersede-by-key with write-time dedup,
LRU decay, recalled into every prompt) — plus a nightly consolidation pass and a shared
commons (WWMD/WWWD/WSID + the hive ledger).

**The missing edges (live-DB audit).**

1. **The one true per-coworker craft store is empty.** `CoworkerMemoryNote` = **0 rows, ever**.
   It is written *only* by an explicit `record_working_note` call; **no edge distils a
   completed thread, build, or `PhaseHandoff` into a note.** The nightly pass only maintains
   what already exists. The full plane — dedup, decay, recall — is built around a store nothing
   writes to.
2. **Continuity is wired but dead.** The rolling thread checkpoint has run on **0 of 287**
   threads, so the 8/20-message recency window is effectively the whole memory of a long
   thread.
3. **Every promotion edge is broken.** Org-scope facts: 0 promoted (all facts are user-scope);
   `contribute_to_hive` requires a `FeatureBuild`, and 0 packs have ever existed — a pure
   learning has no transport out of the individual.
4. **No falsification.** A note is written once and never re-derived against a changed world.
   The worked example: a "Build Studio is not working" note would survive seven weeks and two
   contradicting records and still route work by name. This is the safety-governor gap, and it
   *worsens* with autonomy.

### 2.3 Judgment — decisions are recorded richly, reviewed narrowly, and almost never learned from

**Built and rigorous.** A pure scoring core (`option-scoring.ts`) produces a full
**contribution ledger** — per-principle `{tier, weight, alignment, contribution}`, the *why*
not just the *what* — with commandment-conflict, tie-margin, and insufficient-signal
guardrails. Three governed gates route by scope: WWMD (`principle_decide`, advisory,
kernel principles from Postgres+Qdrant), WWWD (`evaluate_org_business_decision`, the business's
own recorded stance), WSID (`evaluate_profession_decision`). Every consult persists as a
`DecisionInteraction` (schema:12264, id `DI-xxxx`) with `evidenceBundle`, `rationale`,
`confidenceBefore/After`, `gateKey`, and a `humanOutcome` slot. A human-in-the-loop review
surface reads defer/escalate rows. A separate deliberation pipeline runs peer-review/debate
over an artifact. `DecisionShadowLedger` (schema:6648) even carries proposed/actual/agreement/
reconciledAt — a calibration substrate.

**The missing edges.**

1. **Recording is advisory-by-prompt.** The routing rule is a system-prompt block
   (`decision-routing-block.ts:19-24`), not code. A coworker can reason and act with **zero**
   ledger row; the only hard gate is Build Studio phase advancement. The largest loss of rigor
   is decisions made and acted on entirely off-ledger. (BI-A834EE61.)
2. **Recommendation ≠ action ≠ outcome.** `principle_decide` is `sideEffect:false` and records
   the *consult*, never the action taken or its result. The chain recommendation → action →
   outcome is never linked.
3. **Review is narrow.** Only defer/escalate rows reach the queue; confident `recommend`
   outcomes (the majority) are never sampled or audited; advisory kernel-consults are excluded
   from the queue entirely — recorded write-only.
4. **No outcome-correctness signal anywhere.** `humanOutcome` records *that a human resolved a
   review*, never *whether the decision was right in hindsight*. Nothing links a decision to
   its eventual real-world result, so nothing can learn from being wrong. The
   `DecisionShadowLedger` calibration fields appear unfed.
5. **The only closed loop is narrow and manual.** WWWD stance promotion
   (`stance-promotion.ts`) closes — the org stops being asked the same question — but only when
   a human sets `candidateMaterial=true`. WWMD and WSID are record-and-review **without**
   feedback. (BI-A834EE61.)

---

## 3. The unifying diagnosis

Across all three pillars the pattern is identical, and it is not "build the system." It is:

> **The stores and read-paths are built. The acquisition edges (exercise → store), the
> feedback edges (outcome → improvement), and the safety governors (staleness → distrust,
> outcome → calibration, competence → autonomy) are missing or dead.**

So the flywheel does not spin. On a real, exercised install: knowledge gaps are *detected* but
never *filled*; experience is *produced* but never *distilled*; decisions are *recorded* but
never *learned from*. The raw material of excellence is generated by every real business and
then discarded at the edge. That is the gap — a **drive-belt-and-governor** gap, not a
vessel gap. It is cheaper to close than it looks, because the expensive parts (the stores, the
scoring, the retrieval, the schema) already exist and mostly work.

Two asymmetries make it worse and are worth naming explicitly, because they recur:

- **Absence is instrumented; staleness is not.** The platform records what a coworker *lacks*
  (`ProfessionCorpusGap`, `CoworkerCapabilityNeed`, `insufficientSignal`) far better than it
  records that what a coworker *has* may no longer be true. A confidently-held stale belief is
  the worst case, not the best case — and it is invisible today.
- **The controls are built; the signals that drive them are never produced.** The freshness →
  weight → confidence → escalate coupling exists and works; it has never fired because nothing
  classifies freshness. The autonomy ladder (`AgentGovernanceProfile`/`TrustState`/
  `DelegationGrant`) exists at 0 rows and is not an input to tool authority. Building more
  control is not the need; producing the signal is.

---

## 4. Design — close the edges, spin the flywheel

The design principle is **connect, don't rebuild.** Each edge attaches to substrate that
already exists. The work per pillar:

### 4.1 Knowledge

- **Ground the autonomous path** (BI-744D583B) — **shipped 2026-07-21** (PR #3361). Call
  `resolveProfessionCorpusContext` on the build/agent execution path with the same fail-open +
  budget-compression behavior as chat, firing the same `ProfessionCorpusGap`/`UsageStat`
  evidence so autonomous misses also feed growth.
- **Close the growth edge + add freshness** (BI-BE9C95D9). *Operator-decided (§5.5):* the
  *gap → page* authoring flow is **tiered by risk** — low-stakes families auto-publish a
  coworker-drafted, source-cited page; high-stakes families (legal, compliance, finance,
  healthcare) require human approval; **every** change lands in the daily digest. On the
  freshness side, retrieval **caveats** an injected page with its verification age (it does
  *not* silently down-weight — the corpus is too thin to risk starvation); a **routine job**
  investigates stale *and conflicting* pages and files a **BI** so the remediation investment
  is prioritized; auto-purge is reserved for an **obvious 1:1 supersession** (supersede, never
  delete). Note the stale-page signal already exists (`detectStaleClaims`, `info`) — this is
  the retrieval consequence + the conflict-resolution loop, not a new lint.
- **Bind on establish.** *Operator-decided (§5.5):* a coworker that resolves to no profession
  family **falls back to the `universal` corpus and works immediately** (degraded, not blocked),
  is flagged in the daily digest, and a **BI is filed** to give it a proper family. This is
  the coworker-side of the archetype-completeness idea, but softer than the archetype gate on
  purpose — a coworker still functions on `universal` where a template-only archetype is
  broken, and "grows per instance" favors low friction over a hard block.

### 4.2 Memory

Adopt the memory-trust spec's proposals under this epic (BI-4B0A1C1F): make freshness
classification real (P1), supersession lineage on corpus material (P2), close one promotion
edge as proof (P3), repair the escalation gate-clear defect (P4, BI-6EC1EE25), extend quality
gating past `plan→build` (P5), and the WWMD default-distrust principle (P6). **Add the missing
acquisition edge** the memory spec identifies but leaves for this epic. *Operator-decided
(§5.5):* the acquisition trigger is **self-nominate + nightly distill** — a coworker flags
"worth remembering" during its work (`record_working_note`), *and* a nightly pass distils
notes from completed threads / builds / `PhaseHandoff`s it did not explicitly capture (and
makes the thread checkpoint actually run). New notes surface in the daily digest; the
decay/supersede governor keeps them honest so a wrong note cannot persist (the load-bearing
"maintain safely" half — a note is recalled into every future prompt).

### 4.3 Judgment

- **Capture outcome-correctness** (BI-A834EE61). Link a `DecisionInteraction` to its eventual
  result and record a verdict, feeding the `DecisionShadowLedger` reconciliation that already
  has the fields. *Operator-decided (§5.5):* the verdict is **inferred from downstream signals**
  (a reverted PR, a re-opened ticket, a rolled-back deploy, a churned account, a decision
  superseded within N days), proposed verdicts surface in the daily digest, and **the operator
  confirms/overrides only the consequential or ambiguous ones** — the scalable default with a
  human check where it matters. Calibrates WWWD/WSID; **surfaces WWMD miscalibration for founder
  review, never auto-rewriting the kernel** (§5).
- **Close it as a nested loop.** *Operator framing (§5.5):* a coworker's task-loop sits inside
  its performance-loop inside the org-loop — the Reduction Gear ring structure
  (`ring-1-coworker` … `ring-5-hive`). The feedback granularity (per-transaction vs. aggregate)
  is chosen per **ring** by the volume/capacity and the cost of the downstream read, rather than
  fixed globally.
- **Sample the confident path.** An audit path for a fraction of confident `recommend`
  outcomes, not just defer/escalate — "confident but wrong" is the failure review never sees.
- **Reduce the recording leak.** Make the gate harder to skip for consequential actions, or
  reconcile action logs against the ledger, so "recorded losslessly" becomes measurable rather
  than aspirational (fail-open drops must be observable).

---

## 5. Safety doctrine — "maintain it safely" is a first-class constraint, not a footnote

The operator's phrase is "achieve excellence, iteratively, **while maintaining it safely**."
The safety half is not decoration; a flywheel that accumulates unfalsified belief and widens
autonomy on it is a hazard amplifier. Three invariants bound every edge above:

1. **The founder-authored kernel is never auto-mutated.** Outcome learning feeds WWWD (the
   business's own stance) and WSID (profession craft) material, and calibrates *retrieval and
   confidence*. It never silently rewrites WWMD commandments, principles, or dimension weights.
   Observed WWMD miscalibration is *surfaced for founder review*, not applied. The kernel is the
   one tier that stays hand-authored, because it is the tier that governs all the others.
2. **Absence of a freshness signal is treated as stale, not current** (memory-trust P6). The
   system's null value must be its least-trusting value, not its most-trusting. This single
   default flip is what turns the existing, dormant freshness→confidence→escalate brake into a
   live one.
3. **Autonomy is gated on the age of verification, not on a confidence estimate** (memory-trust
   §6.1/§6.3). Accumulated competence may *widen* a coworker's authority only through the
   governed ladder, and only against verified-recently material — never through a
   self-reported confidence score, which is exactly what a plausible stale belief inflates.

A corollary for sequencing: the outcome-correctness and falsification edges (the governors)
should not lag far behind the acquisition edges (the drive belt). Populating memory and corpus
without ever falsifying them is the one ordering that makes the platform *less* safe as it is
exercised.

## 5.5 Resolution doctrine — the operator's operating model (2026-07-21)

The five design forks (§9) were resolved by the founder in one sitting, and the answers were
not five independent choices — they define **one operating model** that every autonomous edge
of the flywheel follows. Stated once, applied everywhere:

> **Act autonomously on the unambiguous; flag honestly (caveat / fallback) on the uncertain;
> surface everything in one daily digest; escalate the consequential or conflicting to either a
> human confirmation or a governed BI; and close the loop as calibration that improves WWWD /
> WSID while surfacing WWMD miscalibration for founder review — never auto-rewriting the kernel.**

Two mechanisms carry the whole model:

- **The daily digest is the single cognitive-load valve.** A solo entrepreneur runs 50+
  coworkers improving at once. The digest is one surface — auto-published corpus pages, newly
  distilled memory notes, proposed decision verdicts, under-grounded coworkers, stale/conflicting
  pages — summarized, so the operator sees the whole estate improving and can pull any thread
  that looks small-but-worth-investigating. It reuses the existing attention / needs-you surface
  rather than emitting 50 separate notifications. Nothing autonomous is invisible; almost nothing
  demands a click.
- **Escalation is either a human confirm or a governed BI.** When the platform is unsure —
  a high-stakes corpus page, a conflicting/stale claim, a consequential decision verdict, a
  coworker with no profession family — it does not guess and it does not silently proceed. It
  either asks the operator to confirm the few that matter, or files a BI so the remediation
  investment is *prioritized* against everything else, not force-fit now.

And the founder's framing of the judgment loop is load-bearing: **each coworker's task is a
closed loop inside a broader closed loop** — task → coworker-performance → org outcome. That is
the Reduction Gear **ring** structure the platform already has (`ring-1-coworker` …
`ring-5-hive`), so "what granularity does feedback close at — per-transaction or in aggregate?"
becomes "which ring closes this loop," chosen by the volume, the capacity, and the cost of the
downstream read — exactly how human performance and any control system are evaluated.

Per-pillar decisions are recorded inline in §4.1–§4.3 and summarized in §9.

---

## 6. Relationship to existing work

- **Nests:** [`2026-07-21-memory-trust-and-evidence-currency-design.md`](2026-07-21-memory-trust-and-evidence-currency-design.md)
  is the memory-and-trust pillar of this epic; its open question #3 ("new epic, or items under
  EP-7B169558 / EP-31815F97?") is answered here — **`EP-COMPETENCE-FLYWHEEL` is the umbrella**,
  and it draws on the decision-altitude `WorkWarrant` (EP-7B169558) and the authority model
  (EP-31815F97) as hosts rather than reinventing them.
- **Builds on:** the archetype provisioning playbook (PR #3352) guarantees *seed* corpus and a
  coworker decision for every new archetype; this epic grows knowledge *beyond seed*, per
  instance. The two are the bootstrap and the flywheel of the same knowledge pillar.
- **Reconciles against, does not duplicate:** EP-COWORKER-RT (autonomous runtime),
  EP-WIKI-001 (kernel wiki), the WSID decision-tier work (EP-0AF96937 / PR #3344).

## 7. Backlog (teed up under EP-COMPETENCE-FLYWHEEL)

| BI | Pillar | Edge |
|---|---|---|
| BI-744D583B | Knowledge | ground the autonomous executor in profession corpus — **shipped 2026-07-21** (`groundPromptWithProfessionCorpus` at the `executeAutonomousAgenticLoop` seam, gated `interactionMode !== "chat"`) |
| BI-BE9C95D9 | Knowledge | close the gap→page growth edge + corpus freshness lifecycle |
| BI-4B0A1C1F | Memory | adopt memory-trust P1–P6 + the experience→note acquisition edge |
| BI-A834EE61 | Judgment | outcome-correctness signal + close the WWMD/WSID feedback loop |
| BI-84E51657 | Knowledge | coworker binding: fallback to `universal` + digest + BI when unmapped |
| BI-19122722 | Host-agent | cross-surface shared memory across the build surfaces (WWMD scope) |
| BI-D6DFC0E7 | Host-agent | fleet readiness signal — **slice 1 shipped 2026-07-21** (`AgentSurfaceReadiness` + `evaluateFleetReadiness` roll-up + `record_surface_readiness`/`get_fleet_readiness` MCP tools; digest surfacing + drift-coverage parity for Codex/Grok/Antigravity/Build Studio remain) |
| BI-IMP-04326905 | Principle | memory at every scope = system-of-record + experience, behind an MCP (the access plane) |

**Host-agent scope** (the surfaces *building* the platform, not a business's coworkers): the
same three-pillar architecture at WWMD tenancy — shared memory (BI-19122722) needs readiness
observability (BI-D6DFC0E7) which rests on the access-plane principle (BI-IMP-04326905). You
cannot share memory a surface cannot reach, nor trust reach you cannot observe. Fleet readiness
surfaces in the same daily digest as every other flywheel edge.

Recommended sequence: **BI-744D583B first** (a today-cost on every autonomous build), then the
memory acquisition edge, then outcome-correctness — the first two generate the raw material the
third learns from. Each pillar's governor (freshness, falsification, verdict) ships with its
drive belt, never after, per §5.

## 8. Non-goals

- A confidence-threshold autonomy gate, quarterly-review-as-primary-mechanism, or an LLM pass
  to judge freshness — all argued against in the memory-trust spec (§6.1, §5.6, §5.7).
- Auto-mutating WWMD kernel doctrine from outcomes (§5, invariant 1).
- A scaffold/generator or a vector-retrieval rebuild as a prerequisite — the retrieval
  interface is already swap-ready; embeddings are an enhancement, not a blocker.
- Backfilling every profession family's corpus depth here — that is the per-instance growth the
  flywheel exists to produce, plus a tracked seed-depth program, not a one-time push.

## 9. Resolved decisions (founder, 2026-07-21)

The design forks are resolved; the operating model they define is §5.5. Summary:

| # | Fork | Decision |
|---|---|---|
| 1 | Corpus gap→page review | **Tiered by risk** — low-stakes auto-publish, high-stakes (legal/finance/compliance/health) human-approved; all in the daily digest. |
| 2 | Retrieval-time staleness | **Caveat** the injected page with its verification age (no silent down-weight — thin corpus); a **routine job** investigates stale/conflicting pages → files a **BI** to prioritize; auto-purge only on an obvious 1:1 supersession. |
| 3 | Coworker with no family | **Fallback to `universal` + digest + BI** — works now, flagged, fix prioritized; softer than the archetype hard-block by design. |
| 4 | Memory capture trigger | **Self-nominate + nightly distill**, surfaced in the digest, kept honest by the decay/supersede governor. |
| 5 | Decision verdict | **Infer from downstream signals + confirm the consequential**; feeds a **nested closed loop** (Reduction Gear rings), granularity per ring by volume/capacity; calibrates WWWD/WSID, surfaces WWMD for review. |

Remaining founder question, deferred (memory-trust open-Q1): **Tier-4 knowledge** — "is what we
believe about our market still true?" is a corpus problem, a scheduled-research problem, or out
of scope for the first cut. Not on the critical path for the four pillar BIs; revisit after the
acquisition and feedback edges are closed.
