---
status: draft
---

# Ecosystem issue intake and arbitration — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | `EP-35BA9476` |
| **Backlog** | `BI-96EFB042` (A) · `BI-B423912F` (B) · `BI-F47386ED` (C) · `BI-4D1CAD69` (D) · `BI-4C8A83AB` (E) |
| **Status** | Draft — operator-directed (`/goal`, 2026-09-16), pending WWMD ratification of §7 |
| **Created** | 2026-09-16 |
| **Author** | Claude Opus 5 for Mark Bodman |
| **Extends** | [Hive harvest and contribution reachability](2026-09-12-hive-harvest-and-contribution-reachability-design.md) · [Zero-config upstream feedback escalation](2026-06-06-zero-config-upstream-feedback-escalation-design.md) · [Proactivity and capacity allocation](2026-09-15-proactivity-and-capacity-allocation-design.md) · [Demand management](2026-07-10-demand-management-design.md) |
| **Supersedes** | Nothing. Every mechanism below already exists in part; this spec connects and refactors them. |
| **Out of scope** | The outbound *code* contribution path (`contribute_to_hive`, FeaturePack, DCO) — owned by the hive-harvest spec · changing the consent posture · federation transport/link establishment · any auto-contribution of source |
| **Primary goal** | An install that will never write code can still get its problems in front of the ecosystem automatically; the ecosystem can express *relative* importance under scarcity; and the upstream platform-development install proactively works that queue in a defensible order. |

---

## 1. Problem

The hive was designed around installs that **produce** improvements. The majority of installs never will: their `primaryPurpose` is `operate-organization`, they run a rescue or a restaurant, and their contribution to the ecosystem is *knowing what is broken*. For those participants the loop is open at both ends.

### 1.1 Measured in code, 2026-09-16

Every claim below was read from the tree at `8c96ccde6`, not inferred.

| # | Finding | Evidence |
|---|---|---|
| 1 | **Submission is manual and privileged.** The escalation core has exactly two callers: a UI button and an MCP tool. No cron, no hook, no sweep. | `escalateReportUpstream` callers: [`UpstreamEscalation.tsx:30`](../../../apps/web/components/feedback/UpstreamEscalation.tsx), [`feedback-pack.ts:93`](../../../apps/web/lib/mcp/packs/feedback-pack.ts). Gated on `manage_platform` ([`feedback-escalation.ts:32`](../../../apps/web/lib/actions/feedback-escalation.ts)). |
| 2 | **There is no inbound leg.** The GitHub adapter only ever POSTs an issue. Nothing lists, reads or ingests one. | [`github-adapter.ts:216`](../../../apps/web/lib/forge/github-adapter.ts) — the single `/issues` URL, write-only. No `listForRepo` anywhere in `apps/web/lib`. |
| 3 | **Votes are received and discarded.** An inbound `interest-recorded` is written to a mirror row and read by nothing. Its own comment says a read model *"can"* surface it — future tense. | [`demand-response.ts:140-188`](../../../apps/web/lib/federation/demand-response.ts) — `handleIncomingDemandResponse` creates one `FederatedRecordMirror` and returns. |
| 4 | **The scoring chain is built but unfed.** RICE derives `reach` from `occurrenceCount`; `affectedOrganizations` rides the wire and is only ever *displayed*. | [`scoring.ts`](../../../apps/web/lib/demand/scoring.ts) `EFFORT_SIZE_TO_JOB_SIZE` / `occurrenceCount` fallback; `affectedOrganizations` written at [`demand-read-model.ts:93`](../../../apps/web/lib/federation/demand-read-model.ts), rendered at [`NetworkDemandPanel.tsx:280`](../../../apps/web/components/ops/NetworkDemandPanel.tsx), consumed by no scorer. |
| 5 | **Two channels that never meet.** Issue reports leave as GitHub issues (pseudonymous, unvotable, unread). Demand leaves over federation (votable) but needs a *trusted link*, which a community install does not have. | `issue-bridge.ts` vs `demand-exchange.ts` — disjoint types, disjoint transports, no shared identity. |

### 1.2 The consequence

A rescue hits a defect. Nobody there has `manage_platform`, and nobody would think to press "Report to the project team". If someone does, the issue lands in GitHub where **no other install can see it, corroborate it, or vote on it**, and where the upstream install has no machinery to read it back. Meanwhile the voting primitives — `dpf.demand.interest-recorded`, `signal.affectedOrganizations` — sit on the *other* channel, fully implemented as transport and wired to nothing that decides anything.

**The ecosystem's most numerous participants have the least reachable voice, and the arbitration substrate that would rank their input is built but inert.**

### 1.3 Operator refinement, 2026-09-16

> *"they would like to vote on which are most important where a limited capacity and arbitration between input exists."*

Submitters have already asked for this directly. It is not a hypothetical requirement. It means the design must carry **three** things, not one: a way in, a way to express *relative* importance under scarcity, and a defensible rule for resolving conflict between submitters.

---

## 2. Research and benchmarking

Five bodies of practice. Four contribute; two contribute chiefly as warnings.

**Canny / Productboard / Aha! Ideas — the customer feedback portal.** Votes are collected per requester and weighted by account segment or contract value; the roadmap decision explicitly stays with the product team, and the portal's headline feature is *status writeback* to every voter. **Adopt:** weighting by who is affected rather than raw counts; mandatory status writeback to submitters. **Reject:** vote count as rank.

**Ubuntu Brainstorm — the cautionary case.** An open idea-voting site, retired after the top-voted items went unimplemented for years. The failure was not the voting; it was **votes with no capacity model and no closure**, which converted enthusiasm into resentment. **Adopt as a constraint:** a vote must be answered — with *scheduled*, *declined*, or *deferred with a reason* — or the mechanism is worse than not having it.

**Quadratic voting (Gitcoin Grants, the Colorado legislature's 2019 budget prioritisation).** Each participant gets a *budget* of credits; the cost of concentrating them on one item rises quadratically, so intensity of preference is expressible while a single wealthy or loud participant cannot dominate. This is the closest formal match to "limited capacity and arbitration between input". **Adopt:** a per-install, per-cycle vote budget with superlinear cost for stacking — see §5.

**Apache / OpenStack — "+1 is a signal, not a vote".** Community `+1`s inform committers; binding decisions belong to those accountable for the result. **Adopt:** the tally is an *input to* precedence, never precedence itself. This is also what `commons-are-curated-not-just-appended` already says: guards nominate, the accountable human decides.

**Debian popularity-contest / Sentry event fingerprinting.** Deduplicate by fingerprint and count *distinct affected installations*, not raw event volume, or one noisy crash loop outranks a silent structural defect. **Adopt:** `affectedOrganizations` — already on the envelope — is the primary signal; `occurrenceCount` is secondary.

**Rejected outright: automatic upstream push of every local report.** DPF's consent posture is deny-by-default and the disposition gate is fail-closed. Automation may *prepare and offer*; a recorded consent still governs whether anything leaves. §4.1 keeps that intact.

Sources: [Canny voting & segments](https://canny.io/features/feedback-voting) · [Productboard customer insights](https://www.productboard.com/) · [Ubuntu Brainstorm retirement discussion](https://lists.ubuntu.com/archives/ubuntu-devel/) · [Quadratic voting in Colorado](https://www.wsj.com/articles/a-new-way-of-voting-that-makes-zealotry-expensive-11554138033) · [Gitcoin quadratic funding](https://wtfisqf.com/) · [Apache voting conventions](https://www.apache.org/foundation/voting.html) · [Debian popularity-contest](https://popcon.debian.org/) · [Sentry issue grouping](https://docs.sentry.io/product/issues/grouping-and-fingerprints/)

---

## 3. Design principles

1. **One intake, two transports.** A submitted issue is *one* kind of thing with one identity. Whether it travels by federation link or by the relay/GitHub bridge is a transport detail chosen per install, exactly as `selectTransport` already chooses today for feedback.
2. **Extend the demand substrate; build no second priority system.** The envelope, the response activities, the mirrors, the RICE scorer and the capacity pool all exist. This spec *feeds* them. A new `Vote` table that is not an input to `DemandScoreInputs` would be the defect.
3. **Automation prepares; consent still gates.** The sweep removes the need for a human to *remember*, never the need for a human to *agree*.
4. **A vote is a signal, not a decision.** It moves `reach` and `affectedOrganizations`. Precedence remains WWMD's and the accountable human's.
5. **Every vote gets an answer.** Scheduled, declined, or deferred-with-reason, written back to the submitter. Non-negotiable — §2's Ubuntu lesson.
6. **Reachable by an install with no developer, no GitHub token, and no frontier model.** That is the population this exists for.

---

## 4. Design

### 4.1 Submission — make it automatic without making it unconsented

Refactor, not rebuild. `escalateReportUpstream` already carries the consent gate, the master pause, the mode check, the rate limit, redaction and idempotency. What it lacks is a caller that is not a human finger.

```
PlatformIssueReport (OPEN, triaged)
        │
        ▼
ecosystem/issue-submission-sweep        ← NEW scheduled job (cron, quiescence-gated)
   selects: status OPEN, promotion-eligible, not already submitted,
            install primaryPurpose != "evolve-dpf"
        │
        ├── upstreamFeedbackOptIn == false ──► raise ONE standing consent prompt
        │                                      via the coworker; never re-ask per report
        │
        └── opt-in recorded ──► escalateReportUpstream(reportId)   (UNCHANGED core)
                                        │
                                        ▼
                             selectTransport(config)
                               ├── federation link trusted ──► demand envelope  (votable)
                               └── otherwise                ──► relay / GitHub bridge
```

Three changes to existing code:

- **`feedback-escalation.ts`** — split the `manage_platform` requirement off the *core*. The server action keeps it (a human clicking must be privileged); the sweep runs under the platform's own identity with the consent record as its authority. The core is already auth-free by design and documented as such; only the callers differ.
- **`feedback-transport.ts`** — add the federation transport beside the direct and relay ones, so an install *with* a trusted link submits as demand (and therefore becomes votable) rather than as an opaque GitHub issue. This is the §1.1-finding-5 fix and it is a transport selection, not a new pipeline.
- **`issue-report-promotion.ts`** — reuse the existing promotion predicate as the sweep's eligibility filter. Do not invent a second notion of "worth escalating".

**Fail-closed:** no opt-in → nothing leaves, and the sweep records `skipped: awaiting-consent` rather than retrying forever.

### 4.2 Arbitration — a vote budget, not a vote count

An install receives a **per-cycle credit budget** (weekly, aligned to the capacity reset the proactivity spec already uses). Spending credits on one item costs the square of the credits applied — one credit for weight 1, four for weight 2, nine for weight 3. An install that cares enormously about one defect can say so; an install cannot flood the board.

```
weight applied to an item   1    2    3    4
credits consumed            1    4    9   16
```

The tally that results feeds the **existing** scorer, and nothing else:

| Signal | Feeds | Already exists |
|---|---|---|
| distinct installs endorsing | `signal.affectedOrganizations` → `reach` | contract field, scorer input — unfed |
| summed quadratic weight | `DemandScoreInputs.impact` | scorer input — unfed |
| local recurrence | `occurrenceCount` → `reach` fallback | wired |
| submitter context (archetype, seat count, install purpose) | score explanation + tie-break | derivable from operating intent |

**Arbitration rule when capacity binds.** Precedence is the RICE/WSJF score *as already computed*, with the vote-derived inputs now populated — then three tie-breaks in order: (1) a defect blocking an install's core value stream outranks an enhancement regardless of tally; (2) breadth (`affectedOrganizations`) outranks intensity; (3) oldest unanswered submission first, so a minority submitter is not starved indefinitely by a popular one. The score is advisory; **the accountable human ratifies**, per §3.4 and `commons-are-curated-not-just-appended`.

**Anti-capture:** credits are per *installation identity*, which is already pseudonymous and stable; budgets do not accumulate across cycles (use-it-or-lose-it, matching the capacity model); and a reseller forwarding on behalf of others cannot amplify, because `forwarding` consent already bounds re-projection.

### 4.3 Inbound — the upstream install proactively works the queue

The missing half. The upstream platform-development install (`primaryPurpose: evolve-dpf`) needs to *see* what was submitted.

```
ecosystem/inbound-issue-triage          ← NEW scheduled job on evolve-dpf installs only
   sources:
     • federated demand mirrors (peer-side envelopes + responses)   ← exists, unread
     • upstream GitHub issues filed by the relay                    ← NEEDS the read path (§1.1-2)
        │
        ▼
   dedupe by payloadDigest + fingerprint  (reuse demand/dedup.ts)
        │
        ▼
   project to BacklogItem with submitter + context provenance       (reuse backlog-ingest)
        │
        ▼
   score with vote-fed DemandScoreInputs                            (reuse scoring.ts)
        │
        ▼
   order the upstream work queue; draw capacity per the            (reuse capacity pool)
   proactivity spec's hierarchical pool
        │
        ▼
   publish disposition back to the submitter                        ← dpf.demand.dispositioned
                                                                       EXISTS, unused for this
```

Almost every box is existing substrate. The genuinely new code is the **GitHub issue read path** and the two scheduled jobs. `dpf.demand.dispositioned` is already a declared activity with a handler — §3.5's writeback obligation is satisfied by using it rather than inventing a notification.

### 4.4 What must not be built

- No new priority field on `BacklogItem` — `DemandScoreInputs` is the home.
- No second identity for submitters — the install pseudonym already threads replies across issues and PRs.
- No new transport — `selectTransport` gains a case.
- No auto-contribution of source. Untouched.

---

## 5. Delivery slices

| Phase | Outcome | Depends on |
|---|---|---|
| **A** — `BI-96EFB042` | Automated submission sweep + standing consent prompt; non-coding installs stop depending on a human remembering. | §4.1 |
| **B** — `BI-B423912F` | Federation transport for issue submission, so a linked install's issue is votable rather than opaque. | A |
| **C** — `BI-F47386ED` | Inbound read path (GitHub issues + demand mirrors) → BacklogItem with submitter provenance. the upstream install can finally *see* the queue. | — (parallel with A) |
| **D** — `BI-4D1CAD69` | Vote budget, quadratic weighting, tally → `DemandScoreInputs`. Votes start moving the score. | B, C |
| **E** — `BI-4C8A83AB` | Arbitration ordering + capacity draw + disposition writeback to every submitter. Closes the loop. | D |

C is independent of A/B and is the highest-value single slice: it is the half of the loop that does not exist at all.

---

## 6. Verification

- Unit: quadratic cost function; budget exhaustion; tie-break ordering; dedupe across both transports; consent gate refusal paths.
- Integration: a report on a non-coding install reaches an upstream BacklogItem with submitter provenance intact and no PII in the envelope (`assertNoExcludedEgress` already enforces this — assert it in the test).
- Negative: no opt-in → nothing leaves. Budget exhausted → the vote is refused, not silently dropped. Untrusted link → no transport.
- Runtime: exercised on the canonical runtime per §4 of the rulebook; a gate that cannot run is recorded inconclusive, never passed.

## 7. Open decisions for WWMD / the operator

1. **Vote budget size and cycle.** Proposed: weekly, aligned to the capacity reset. Needs a number.
2. **Does seat count or contract value weight a vote?** Canny does this. It is defensible commercially and corrosive to a community of small operators. **Recommendation: no** — breadth and value-stream impact only. Operator's call.
3. **Who ratifies precedence upstream** — the maintainer, or a WWMD-scored standing rule with human exception handling.
4. **Is the community audience allowed to see the tally?** Publishing it builds trust and invites campaigning. **Recommendation: publish rank, not raw counts.**
