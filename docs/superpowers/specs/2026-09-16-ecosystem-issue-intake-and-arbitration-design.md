---
status: draft
---

# Ecosystem issue intake and arbitration — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | `EP-35BA9476` |
| **Backlog** | `BI-96EFB042` (A) · `BI-B423912F` (B) · `BI-F47386ED` (C) · `BI-4D1CAD69` (D) · `BI-4C8A83AB` (E) · `BI-7ED79807` (F) · `BI-4D924DB4` (G) · `BI-784D20FD` (H) |
| **Status** | Draft — operator-directed (`/goal`, 2026-09-16), pending WWMD ratification of §7 |
| **Created** | 2026-09-16 |
| **Author** | Claude Opus 5 for Mark Bodman |
| **Extends** | [Hive harvest and contribution reachability](2026-09-12-hive-harvest-and-contribution-reachability-design.md) · [Zero-config upstream feedback escalation](2026-06-06-zero-config-upstream-feedback-escalation-design.md) · [Proactivity and capacity allocation](2026-09-15-proactivity-and-capacity-allocation-design.md) · [Demand management](2026-07-10-demand-management-design.md) |
| **Supersedes** | Nothing. Every mechanism below already exists in part; this spec connects and refactors them. |
| **Out of scope** | The outbound *code* contribution path (`contribute_to_hive`, FeaturePack, DCO) — owned by the hive-harvest spec · changing the consent posture · federation transport/link establishment · any auto-contribution of source |
| **Primary goal** | An install that will never write code can still get its problems in front of the ecosystem automatically; every participant can express *relative* importance under scarcity, on a ballot scoped to what actually applies to them; a coworker brings that to them weekly in the room where it belongs; and the upstream platform-development install proactively works the resulting queue in a defensible order. |

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
| 6 | **Envelopes are archetype-blind.** The contract declares `applicability.{product,capabilityRefs,archetypeRefs,platformRange}`; the projector writes **only `product`**. No relevance scoping is possible until this is fixed. | [`demand-projection.ts:47`](../../../apps/web/lib/federation/demand-projection.ts) — the entire applicability assignment. |
| 7 | **The coworker cannot act unprompted on ecosystem work.** `PROACTIVITY_ACTIVITY_FAMILIES` is a closed set with no ecosystem/hive family, so the resolver cannot govern such a cadence at all. | [`proactivity-types.ts:4-32`](../../../apps/web/lib/proactivity/proactivity-types.ts); the `marketing-campaign` comment records this exact failure mode. |
| 5 | **Two channels that never meet.** Issue reports leave as GitHub issues (pseudonymous, unvotable, unread). Demand leaves over federation (votable) but needs a *trusted link*, which a community install does not have. | `issue-bridge.ts` vs `demand-exchange.ts` — disjoint types, disjoint transports, no shared identity. |

### 1.2 The consequence

A rescue hits a defect. Nobody there has `manage_platform`, and nobody would think to press "Report to the project team". If someone does, the issue lands in GitHub where **no other install can see it, corroborate it, or vote on it**, and where the upstream install has no machinery to read it back. Meanwhile the voting primitives — `dpf.demand.interest-recorded`, `signal.affectedOrganizations` — sit on the *other* channel, fully implemented as transport and wired to nothing that decides anything.

**The ecosystem's most numerous participants have the least reachable voice, and the arbitration substrate that would rank their input is built but inert.**

### 1.3 Operator refinement, 2026-09-16

> *"they would like to vote on which are most important where a limited capacity and arbitration between input exists."*

Submitters have already asked for this directly. It is not a hypothetical requirement. It means the design must carry **three** things, not one: a way in, a way to express *relative* importance under scarcity, and a defensible rule for resolving conflict between submitters.

A second refinement the same day settles *who votes on what, and how it reaches them*:

> *"The vote will be put to all participants in this platform, with a priority on relevant items — their submissions, and other relevant submissions based on the common or archetype aligned issues already submitted. We don't want to expose all issues, but smartly evaluate what's there, and scope applicability from the specific instance context. Proactivity of the AI coworker in the proper workroom should do this on a weekly basis. This is a watch dog of sorts, bring into the instance what is suggested and optioned per preference and need."*

So the ballot is universal but **not uniform**: relevance-scoped per instance, consent-gated, and delivered by a proactive coworker on a weekly cadence rather than waiting on a page nobody visits. §4.4 and §4.5 carry this, and it surfaces two further structural defects — findings 6 and 7 above — that must be fixed before any of it is possible.

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

### 4.4 Ballot composition — every participant votes, but not on everything

Operator direction, 2026-09-16: the vote goes to **all** participants, prioritised on items relevant to them — their own submissions, plus archetype-aligned or common issues others have already submitted. *"We don't want to expose all issues, but smartly evaluate what's there, and scope applicability from the specific instance context."*

Two gates decide what reaches an install's ballot, and they are **not** the same gate.

**Gate 1 — consent (may this install see it at all?).** Already on the wire. An item reaches another install's ballot only if its `audience` includes that install's relationship and its `forwarding` consent permits re-projection. Both fields are already projected ([`demand-projection.ts:43,50`](../../../apps/web/lib/federation/demand-projection.ts)). Absence of `forwarding` already means forwarding is forbidden, so this gate is fail-closed today and needs no new mechanism. **"Don't expose all issues" is first a consent question, not a relevance question** — a sensitive submission must not become visible merely because it is relevant.

**Gate 2 — applicability (is it relevant to this instance?).** Generalise the evaluator DPF already has. `regulationApplies()` ([`regulation-applicability.ts:281`](../../../packages/db/src/regulation-applicability.ts)) classifies a regulation against install context and returns a tri-state with a reason:

| Verdict | Regulation meaning today | Ecosystem-item meaning here | Ballot treatment |
|---|---|---|---|
| `applies` | in scope | your archetype/capabilities are affected | **on the ballot, ranked first** |
| `review` | we must ask — a required signal is undeclared | might affect you; context is thin | **offered below the fold** |
| `reference` | known out of scope | not your archetype or capability surface | **not surfaced**; reachable on request |

That evaluator is the right model for a specific reason: it already distinguishes *known out of scope* from *we do not have enough signal to say*, and it always carries a human-readable reason. A relevance score that cannot explain itself would fail the ballot's purpose, which is to earn a considered vote rather than a reflexive one.

**The blocker: the relevance data is declared and never written.** `DemandEnvelopeV1.applicability` declares `product`, `capabilityRefs`, `archetypeRefs` and `platformRange`. The projector sets **only `product`**:

```ts
// demand-projection.ts:47 — the whole of it
...(input.source.product ? { applicability: { product: input.source.product } } : {}),
```

So today every envelope arrives archetype-blind. **No relevance scoping of any kind is possible until the projector populates these fields**, which makes it a prerequisite of the ballot rather than a refinement of it.

**Ballot shape.** Three tiers, assembled per install:

1. **Yours** — items this install submitted. Always present, regardless of verdict.
2. **Applies** — `applies`, ordered by the §4.2 score. The substance of the ballot.
3. **Might apply** — `review`, below the fold, each with its reason and a one-click "not relevant to us" that records the correction.

The dismissals in tier 3 are the training signal: an archetype repeatedly marking a class of item irrelevant is evidence the applicability spec for that class is wrong, and it should raise its own finding rather than quietly accumulate.

### 4.5 The weekly watchdog — proactive, in the derived room, two-directional

Operator direction: *"Proactivity of the AI coworker in the proper workroom should do this on a weekly basis. This is a watchdog of sorts — bring into the instance what is suggested and optioned per preference and need."*

The ballot is **not** a page someone must remember to visit. A coworker assembles it, brings it to the room, and carries the outcome back.

**This needs a new proactivity activity family, and that is a hard requirement rather than a tidiness preference.** The families are a closed set, and the `marketing-campaign` entry records exactly why omission is fatal:

> *"Without this family the marketing coworker could not be described to the resolver at all, so no posture could govern it and it never acted unprompted."* — [`proactivity-types.ts:24`](../../../apps/web/lib/proactivity/proactivity-types.ts)

The same is true here. Add **`ecosystem-participation`**: the cadence on which an install votes, reviews what the ecosystem is proposing, and is told what is coming. Without it the resolver cannot govern the watchdog and it will never act unprompted — which is the entire request.

**Per preference and need** is then satisfied by machinery that already exists, not by new settings:

| Existing lever | Effect on the watchdog |
|---|---|
| `ProactivityLevel` — `quiet` / `balanced` / `assertive` | how much of tier 3 is surfaced, and how insistently |
| `ProactivityChannelPolicy` | in-app only, or a nudge through the preferred channel |
| `ProactivityActionBoundary` — `advise` / `propose` / `preauthorized` | whether the coworker drafts the vote, proposes it, or casts a pre-authorised default |
| Situational posture (proactivity spec §5) | a rescue `at-capacity` sees placement-adjacent items first |

An install on `quiet` gets tier 1 and 2 in-app and nothing else. An install on `assertive` with `preauthorized` gets its routine votes cast to its declared preferences and only exceptions escalated. Neither is a new preference surface.

**Two-directional, which is what makes it a watchdog rather than a ballot box.** The same weekly turn carries four things into the room:

1. **Vote** — the tiered ballot above.
2. **Inbound relevance** — items others submitted that `apply` to this instance: *this is coming for you too*.
3. **Disposition news** — what happened to what this install voted on or submitted (§4.3's `dpf.demand.dispositioned`). This is the §3.5 closure obligation arriving somewhere a human will actually see it.
4. **Applicable releases** — `dpf.release.applicability-published` is already a declared activity with a delivery path and no consumer. A fix shipping upstream that `applies` to this install is exactly what the watchdog exists to announce.

**The proper room is derived, never authored per install** — via the existing room-shape derivation ([`derive-workroom-shape.ts`](../../../apps/web/lib/work-management/derive-workroom-shape.ts), [`room-shapes.ts`](../../../apps/web/lib/work-management/room-shapes.ts)), on the same discipline the proactivity spec §5 states for postures. Authoring a per-install ecosystem room is the failure that derivation exists to prevent, and this programme has already made that mistake once.

### 4.6 What must not be built

- No new priority field on `BacklogItem` — `DemandScoreInputs` is the home.
- No second identity for submitters — the install pseudonym already threads replies across issues and PRs.
- No new transport — `selectTransport` gains a case.
- No new relevance scorer — the tri-state applicability evaluator is generalised, not duplicated.
- No new preference surface for the watchdog — proactivity level, channel policy, action boundary and posture already express "per preference and need".
- No per-install authored ecosystem room — the room shape is derived.
- No auto-contribution of source. Untouched.

---

## 5. Delivery slices

| Phase | Outcome | Depends on |
|---|---|---|
| **A** — `BI-96EFB042` | Automated submission sweep + standing consent prompt; non-coding installs stop depending on a human remembering. | §4.1 |
| **B** — `BI-B423912F` | Federation transport for issue submission, so a linked install's issue is votable rather than opaque. | A |
| **C** — `BI-F47386ED` ✅ **delivered** | Inbound read path (GitHub issues + demand mirrors) → BacklogItem with submitter provenance. the upstream install can finally *see* the queue. | — (parallel with A) |
| **F** — `BI-7ED79807` ✅ **delivered** | **Prerequisite.** Populate `applicability` (archetype, capability, platform range) on projection. Until this lands every envelope is archetype-blind and no ballot can be scoped. | — |
| **G** — `BI-4D924DB4` | Generalise the tri-state applicability evaluator; assemble the consent-gated, three-tier ballot per install. | C, F |
| **H** — `BI-784D20FD` | `ecosystem-participation` proactivity family; the weekly two-directional watchdog in the derived room. | G |
| **D** — `BI-4D1CAD69` | Vote budget, quadratic weighting, tally → `DemandScoreInputs`. Votes start moving the score. | B, C, G |
| **E** — `BI-4C8A83AB` | Arbitration ordering + capacity draw + disposition writeback to every submitter. Closes the loop. | D |

C is independent of A/B and is the highest-value single slice: it is the half of the loop that does not exist at all.

**F is small and blocks everything downstream of it.** It is a few lines in one projector, and until it lands the ballot cannot be scoped, the watchdog has nothing to be relevant about, and votes cannot be prioritised by relevance. It should land first or alongside C.

---

### 5.1 Implementation notes — Phase C, delivered 2026-09-16

Four decisions taken while building it that the design did not pre-empt:

1. **Pull requests must be filtered out of the issue read.** GitHub returns pull
   requests from the issues endpoint — every PR is an issue in that API — so an
   unfiltered read ingests the project's own pull requests as if they were
   ecosystem submissions. The `pull_request` key is the discriminator, and
   **pagination is driven by the raw page length**, because a page that is
   entirely PRs still means more pages and stopping on the filtered count would
   silently truncate the sweep.
2. **Inbound items are filed as `source: "user-request"`, not
   `automated-detection`.** The origin really is a person at another install
   asking for something; it merely *arrives* by automation. Recording it as an
   automated detection would erase the submitter that §4.2's arbitration depends
   on. The install pseudonym is recovered from the body the issue bridge stamps.
3. **The sweep no-ops unless the installation's purpose is `evolve-dpf`.** On an
   operate-organization install it would fill a customer's own backlog with other
   installs' defects — not merely useless, actively wrong.
4. **A failed read is reported, never folded into an empty sweep.** "Nothing
   inbound" and "could not look" are different verdicts, and a failing issue read
   must not drop the peer-demand transport with it.

`parseArchetypeRefs` — the inverse of Phase F's encoder — lives beside it rather
than in the ecosystem module: the ref grammar is one contract, and a decoder in
another module would drift the moment either side changed. Unknown prefixes are
ignored so a newer peer may add a dimension without breaking an older receiver.

The cron is registered in `SCHEDULED_JOB_CATALOG`; the drift guard caught the
omission, and an uncatalogued cron runs invisibly.

## 6. Verification

- Unit: quadratic cost function; budget exhaustion; tie-break ordering; dedupe across both transports; consent gate refusal paths.
- Integration: a report on a non-coding install reaches an upstream BacklogItem with submitter provenance intact and no PII in the envelope (`assertNoExcludedEgress` already enforces this — assert it in the test).
- Negative: no opt-in → nothing leaves. Budget exhausted → the vote is refused, not silently dropped. Untrusted link → no transport.
- Runtime: exercised on the canonical runtime per §4 of the rulebook; a gate that cannot run is recorded inconclusive, never passed.

## 7. Open decisions for WWMD / the operator

1. **Vote budget size and cycle.** Proposed: weekly, aligned to the capacity reset. Needs a number.
2. **Does seat count or contract value weight a vote?** Canny does this. It is defensible commercially and corrosive to a community of small operators. **Recommendation: no** — breadth and value-stream impact only. Operator's call.
3. **Who ratifies precedence upstream** — the maintainer, or a WWMD-scored standing rule with human exception handling.
4. **Default proactivity level for `ecosystem-participation`.** Proposed: `balanced` with an `advise` boundary — the coworker drafts and proposes, never casts unasked. An install may raise it to `preauthorized` for routine votes.
5. **Does a tier-3 dismissal travel upstream?** Aggregated "this archetype says this class is irrelevant" is a strong corrective signal for the applicability specs, but it is also an egress of instance preference. **Recommendation: aggregate counts only, no per-install attribution.**
6. **Is the community audience allowed to see the tally?** Publishing it builds trust and invites campaigning. **Recommendation: publish rank, not raw counts.**
