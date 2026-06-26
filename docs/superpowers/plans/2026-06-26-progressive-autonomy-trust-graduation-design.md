# Progressive Autonomy & Trust Graduation — design pass

- **Epic:** EP-8AF1C996
- **Foundational BI:** BI-DE4BF92F (Decision-Shadow Ledger + trust-state)
- **Date:** 2026-06-26
- **Status:** design pass; foundation BI filed; everything gated behind validation (no YOLO)

## 0. The directive

Founder, 2026-06-26: the self-driving auto-nomination loop (and autonomy in
general) is desirable but must be **eased in incrementally and validated over
time** — switching it on blind is dangerous. Concretely: when an AI coworker is
idle it should be **proactive** on behalf of the user/context, but **not make
changes directly at first**; as it demonstrates it "makes the right call," the
controls are released and it becomes more autonomous. Autonomous actions get
**summarized** so the human keeps tabs. Every activity / coworker is in an
early-stage **NOT-TRUSTED** mode until proven — even WWMD is not yet 100% ready
for autonomous operation.

This extends the existing **autopilot trust-dial** principle (confidence-
calibrated; proven -> autopilot + after-the-fact review) by specifying the
*mechanism*.

## 1. The unit of trust

Trust is **not global**. It is earned per triple: **(coworker x activity-type x
risk-class)**. AGT-X may be trusted to auto-categorise transactions while still
only shadowing client emails.

Risk-class buckets actions by reversibility / blast-radius:
- R0 read-only (read/observe)
- R1 internal-reversible (draft, stage, propose)
- R2 internal-irreversible (mutate internal state, file a BI, change config)
- R3 outbound / external / financial / access-control (the kernel floor)

The **irreducible kernel floor** (R3: irreversible outbound, financial transfer,
access-control, destructive deletes) is a **hard ceiling** — recordable in the
ledger, but it NEVER graduates past L1-propose regardless of agreement. A human
always makes that call.

## 2. The autonomy levels (the dial)

| Level | The AI does | Human role | Recorded |
|------|-------------|-----------|----------|
| **L0 Shadow** | computes the decision/action it WOULD take; takes NO action | sees "would have done X"; nothing required | proposed decision + rationale, later the actual choice/outcome |
| **L1 Propose** | stages the action; surfaces for 1-click approve/reject | approves each | approval / rejection |
| **L2 Supervised** | acts autonomously; emits a per-action summary + easy undo/flag | after-the-fact review; can undo/flag | action summary + any undo/flag |
| **L3 Autopilot** | acts; periodic digest only | reads the digest | digest |

Everything starts at **L0**.

## 3. Graduation & demotion

Earned per triple by an **agreement rate** over a rolling window:
- **L0 -> L1**: shadow decisions, compared to what the human actually did (or the
  outcome), agree >= threshold (e.g. >=90%) over >= N samples (e.g. 20). I.e. "if
  we had let it act, it would have been right >=90% of the time."
- **L1 -> L2**: human approves its proposals >= threshold over >= N (low reject rate).
- **L2 -> L3**: post-hoc reviews flag/undo <= a small rate over >= N.
- **Demotion is symmetric**: a rejected proposal (L1), an undo/flag (L2), or a
  wrong shadow call (L0) lowers the rate; crossing a floor drops a level. Trust
  is earned AND losable.

Graduation between levels is **human-confirmed** at first — the operator releases
the control with the evidence (agreement rate, sample size, recent misses) in
front of them. Auto-promotion for the lowest-risk classes is a later, meta-trust
step. The thresholds/window are the explicit, tunable surface.

## 4. The substrate — Decision-Shadow Ledger (BI-DE4BF92F)

You cannot graduate trust you have not measured. The foundation:
- **TrustState** per triple: current level + rolling agreement stats.
- **DecisionShadowLedger**: one row per governed decision — `{coworker,
  activityType, riskClass, proposedDecision, rationale, autonomyLevel,
  actualDecision?, outcome?, agreement?}`. At L0, proposed-only; a reconciliation
  pass fills the actual/outcome and computes agreement.
- `computeAgreementRate(rows, window)` — pure, deterministic — the trust metric.

It IS both the trust metric and the **oversight surface** (what the AI would/did
do). Reuse existing telemetry as the actual/outcome source: `ToolExecution`,
`CoworkerActionEnvelope`, WWMD decision records, the keystone migration signals.

## 5. First tenants (rollout order)

1. **Auto-nomination loop (BI-A028AA14)** — already designed; I built its
   detection signals (codifiability + cost ROI). Start it at **L0**: the curator
   computes the "codify X" nominations it WOULD file, records them, and a human
   compares. As its nominations prove right, graduate to L1 (file at `triaging`
   for 1-click) then L2 (file + summary). This is the concrete "ease the
   auto-nomination in" the directive asks for.
2. **Idle-coworker proactivity** — when idle, the coworker produces proposals
   ("I would draft a reply to client X's unanswered email") WITHOUT acting, logs
   them, surfaces them. Graduates per activity (drafting before sending).
3. **WWMD** — runs shadow-first. recommend / arbitrate / escalate / defer are
   recorded vs the human's actual decision; WWMD graduates per decision-type. It
   stays advisory until its agreement rate earns more.

## 6. Oversight (keeping tabs)

L2 emits a per-action summary; L3 a periodic digest. These land on the
**Attention Surface** (EP-ATTENTION-SURFACE) — the "what your coworkers did /
want to do" view — with undo/flag affordances. Flags feed demotion (§3).

## 7. How to start + open questions

**Incremental path:**
1. Build the ledger + trust-state (BI-DE4BF92F) — measure, don't act.
2. Put the auto-nomination loop in L0 shadow (lowest-risk first tenant).
3. Build the graduation evaluator (surfaces "eligible to graduate" with evidence)
   + the L2 action-summary surface.
4. Expand to idle-proactivity, then WWMD, once the mechanics are proven.

**Open questions for the founder:**
- Default thresholds/window per risk-class (how much proof is enough)?
- Is L3 autopilot ever allowed for R2 (internal-irreversible), or is L2-supervised
  the ceiling for anything that mutates state?
- Should graduation always be human-confirmed, or auto-promote for R0/R1 once a
  high bar is met (meta-trust)?
- How to seed agreement for activities with no human "actual" to compare to
  (where the outcome, not a human choice, is ground truth)?
