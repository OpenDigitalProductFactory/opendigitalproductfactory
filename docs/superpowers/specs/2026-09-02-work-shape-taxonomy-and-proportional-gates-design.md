---
status: draft
---

# Work shapes — one taxonomy, gates proportional to size and risk

- **Epic:** EP-129D11FD (Initiative Readiness and Governed Completion Enforcement)
- **Backlog item:** BI-B5C8FEFC
- **Profile:** cross-domain (policy spans backlog, Workroom, Build Studio, readiness)
- **Authored:** 2026-09-02
- **Status:** draft — founder ruling needed on §5 open decisions
- **Provenance:** BI-B3AB7FC9 (PR #4999) was a one-afternoon diagnosis-to-merge fix that could not be closed because the completion gate demanded a research receipt, a plan-coverage record, an independently approved spec baseline, acceptance evidence, and objective reconciliation. BI-28E8CB88, BI-F0715C9C and BI-3AE38A1F record the same wall from three other fixes.

## 1. Problem

DPF governs every unit of work with one gauntlet. A one-file operational repair and a new archetype answer to the same completion policy, and the policy asks the repair for artifacts a repair never produces.

Two sizing systems exist today and do not talk to each other:

| System | Lives in | Tiers by | Ignores |
|---|---|---|---|
| Initiative readiness (`initiative-readiness.v2`) | `apps/web/lib/backlog/initiative-readiness/` | risk kind: `doc-only` < `fix` < `feature` < `cross-domain` < `archetype` (`types.ts:4`, `profiles.ts:3-9`) | size — no `effortSize` reference anywhere in the policy |
| Build Studio right-sizing matrix | `apps/web/lib/explore/build-process-matrix.ts` | type (`feature|fix|chore|doc`) × size (`small|medium|large|xlarge`) × sensitivity (`low|elevated|high`) | readiness codes — its gates are phase-transition gates, not initiative gates |

The readiness policy's completion requirements are **unconditional across profiles** (`evaluate.ts:107-115`): `DELIVERY_EVIDENCE_REQUIRED`, `ACCEPTANCE_EVIDENCE_REQUIRED`, `OBJECTIVE_BASELINE_REQUIRED`, `OBJECTIVE_RECONCILIATION_REQUIRED`. The `fix` profile is excused from minting an objective baseline at plan and implementation (`evaluate.ts:54` puts it only in the feature branch), then required to hold one at completion. That is the structural trap: the policy is internally inconsistent for its own smallest tier.

Consequences measured on the live install (2026-08-28 to 2026-09-02):

- 33 items are `done` and zero hold a scope baseline (BI-F0715C9C activity cmtdgf59d00ha01p2vsb9k3mn) — the gate is being bypassed, not satisfied.
- 58 items hold evidence the gate cannot read (BI-28E8CB88 re-measure).
- The merge-through-gates escape hatch (`backlog-terminal-transition.ts:97-124`) requires a bound Workroom with a `headSha`; a fix worked outside a Workroom cannot use it.
- `Workroom` has no shape of its own (`work-coordination.prisma:340`) and inherits the bound item's profile, so a Workroom for an emergency repair is governed exactly like one for a feature.

The pressure this creates is documented in BI-28E8CB88: the path of least resistance is to author research docs and plans *after the fact* to satisfy the projector. That converts a reporting defect into falsified governance history.

## 2. Research & Benchmarking

Seven bodies of practice were compared (full citations in the research appendix, §8). What they converge on:

1. **Pre-authorise the repeatable.** ITIL 4 *standard changes* are authorised once as a procedure, never per instance. DORA's peer-review-in-platform, Google's small-CL guidance and IEC 62304 Class A say the same: when risk is understood and the procedure is fixed, the procedure *is* the gate.
2. **Gate on risk and blast radius, never on ceremony or provenance.** IEC scales by harm potential, ITIL by impact × urgency, Kanban by cost of delay, SAFe by investment. None scales by who asked. DPF already states this as `gate-coverage-matches-blast-radius` and `governance-approves-evidence-not-provenance`.
3. **External approval boards do not reduce failures; small batches do.** Accelerate: "External approvals were negatively correlated with lead time, deployment frequency, and restore time, and had no correlation with change fail rate." Heavyweight approval grows batch size, which raises risk — a vicious cycle.
4. **Big work gets a hypothesis and a budget before it gets a spec.** SAFe's epic hypothesis + Lean business case; Shape Up's appetite + pitch. Both bound the investment and force a measurable success claim before design starts.
5. **The emergency lane is narrow, permissioned and audited afterward.** Kanban expedite WIP limit of 1; a named authority declares the emergency; approver ≠ implementer; a mandatory post-implementation review; emergency frequency monitored as a share of all changes (SOC 2 / ISO 27001 A.8.32 / ITIL).
6. **Evidence lives in the delivery platform.** Ticket ↔ commit ↔ test ↔ deploy linkage with unique ids satisfies ISO, SOC 2 and DORA. A merged SHA reachable from trunk with green required checks *is* delivery evidence.
7. **Unclassified defaults to the strictest tier.** IEC 62304's default-to-Class-C is the safe failure mode for any taxonomy.

What DPF adopts: all seven. What DPF rejects: SAFe's four-level hierarchy (story/feature/capability/epic) — DPF has backlog item and epic and does not need a capability tier; and ITIL's CAB as a body — DPF's change authority is the gate policy plus an eligible independent reviewer, never a meeting.

## 3. The taxonomy

One axis of **shape** (size and lifecycle), one orthogonal axis of **risk** (sensitivity), and one binary **lane** (standard or expedite). Shape is derived, storable as an override, and inherited by every carrier of the same work: backlog item → Workroom → FeatureBuild → TaskRun.

### 3.1 Shapes

| Shape | What it is | Appetite | Carrier | Examples |
|---|---|---|---|---|
| `break-fix` | Operational repair of a live defect or incident on the installed runtime. Reversion-shaped: restores intended behaviour, adds no capability. | hours | one PR; Workroom optional | the pregate hook that never ran; a leaked lease; a crashed reaper |
| `small` | Bug, chore, doc, or improvement whose scope is one clean revert. No new substrate (no table, enum value, tool, route, agent role). | ≤ 2 days, one PR | one Workroom | BI-B3AB7FC9 attribution fix; a guard that fails open; copy corrections |
| `medium` | A bounded feature or refactor inside one domain and one Workroom. May extend existing substrate; may not add a new domain concept. | ≤ 1 week, 1–3 PRs | one Workroom | a new tab on an existing route; a new evidence kind on an existing ledger |
| `large` | New capability or cross-domain change. Adds substrate or changes a contract other domains depend on. | ≤ 3 weeks | one Workroom, may spawn child items | MCP OAuth; same-org work sync; a new archetype surface |
| `xlarge` | An initiative. Must decompose into ≥ 2 children before any implementation starts. Carrier is an **epic**. | multi-week | epic + child items, each with its own shape | Initiative Readiness enforcement (EP-129D11FD); Greenhouse ATS absorption |

Mapping to existing substrate: `small|medium|large|xlarge` **are** `BacklogEffortSize`. `break-fix` is new — it is the expedite lane applied to a `small` fix, expressed as a shape because its gates differ in *kind* (post-hoc review), not just in count.

### 3.2 Risk axis (unchanged, made universal)

`DeliverableSensitivity = low | elevated | high` already exists in the matrix with a monotonic raise-only rule (`build-process-matrix.ts:369-479`). It becomes the single risk axis for readiness too. Raisers: sensitive data, auth/security, compliance evidence, migration, archetype scope, cross-domain contract. `high` sensitivity raises any shape's gate set to the next shape's set (a `small` security fix carries `medium` gates: regression test first, independent review). It never lowers.

The current readiness profiles collapse onto (shape, sensitivity):

| Today's profile | Becomes |
|---|---|
| `doc-only` | `small` + `low`, doc work type |
| `fix` | `small` (or `break-fix` when expedited) |
| `feature` | `medium` or `large` by size |
| `cross-domain` | `large` + `elevated` |
| `archetype` | `large` + `high` with the archetype provisioning/completeness codes |

### 3.3 Classification rules

Derived at triage from signals already on the item; overridable with a recorded reason; audited.

1. Work type `bug` with `source = automated-detection` or an incident link, and an operator (or the operations coworker) declares expedite → `break-fix`. Otherwise `bug` → `small`.
2. Work type `doc|chore` → `small` unless effortSize says otherwise.
3. `effortSize` drives `small|medium|large|xlarge` for everything else.
4. Any of: new Prisma model or enum value, new MCP tool, new route, new agent role, new archetype → at least `large` (this is the `verify-substrate-before-proposing-new` principle turned into a classifier).
5. Sensitivity keyword regex plus org risk posture → sensitivity floor (exists today).
6. **Unclassified → `large` + `high`.** Never `small`. A shape must be an explicit act.
7. `xlarge` cannot enter implementation. The only legal transition is decomposition.

## 4. Gates per shape

"PR gate" below means the existing pre-push gate: unit tests, typecheck, lint, DCO, local-CI lease, plus the deterministic guards (ux-fit, docs-impact, module-size, design-grounding). It applies to every shape and is not listed again.

| Requirement | `break-fix` | `small` | `medium` | `large` | `xlarge` (epic) |
|---|---|---|---|---|---|
| Classification | after the fact, within 48h | at triage | at triage | at triage | at triage |
| Research | reproduction on a named ref, recorded in the PR body | reproduction + failing→passing proof (`RESEARCH_DEFINITIONS.fix`, exists) | design note in the item body: problem, options considered, chosen | research & benchmarking section in a spec (exists) | epic hypothesis statement + appetite + Lean case (new) |
| Design artifact | none | none | item body is the design | canonical spec, independently approved (`SPEC_APPROVAL_REQUIRED`) | decomposition proposal, approved |
| Objective baseline | none | acceptance criterion in the item body | acceptance criteria in the item body, minted as the baseline by triage (new: baseline from item, not from spec) | spec approval mints it (exists) | hypothesis is the baseline |
| Plan | none | none | ordered steps in the item body | plan doc + coverage record (exists) | children with their own shapes |
| Independent review | PR review + mandatory post-implementation review within 48h by someone other than the author | PR review (peer, in-platform) | PR review + architecture advisory (non-blocking) | PR review + architecture review (blocking) + specialist reviews as applicable | portfolio review of decomposition |
| Delivery evidence | merged SHA reachable from `main` | merged SHA reachable from `main` | same | same, plus deployed via `/ops/self-upgrade` | all children done |
| Acceptance | post-implementation review confirms the symptom is gone on the live install | runtime check on the live install or the failing→passing test | acceptance criteria verified on the live install (UX verification where UI) | acceptance evidence against baseline (exists) | outcome reconciliation against the hypothesis (`OBJECTIVE_RECONCILIATION_REQUIRED`, moved here) |
| Completion writer | author, with the PIR receipt | author | author, with acceptance receipt | acceptance reviewer | portfolio owner |
| WIP limit | 1 per installation | none | Workroom cap (exists) | Workroom cap | epic cap |

Principles encoded in the table:

- **Delivery evidence is the trunk, not a manifest.** For every shape, "merged SHA reachable from `main` with green required checks" satisfies `DELIVERY_EVIDENCE_REQUIRED`. The current merge-through-gates hatch becomes the primary path and must not require a Workroom: it takes the PR's merge SHA from the item's linked PR when no Workroom exists.
- **The objective baseline scales with the shape.** Today only a spec approval can mint one, so anything without a spec cannot reconcile. `small` and `medium` mint their baseline from the item's acceptance criteria at triage. `OBJECTIVE_RECONCILIATION_REQUIRED` applies to `large` and `xlarge` only; smaller shapes reconcile through acceptance.
- **The expedite lane is real, narrow and audited.** `break-fix` skips pre-authorisation and owes a post-implementation review receipt within 48 hours. A missed PIR flips the item to `input-required` and blocks the author's next `break-fix` declaration. The share of `break-fix` among merged work is a Right Now / governance signal; above 20% in a rolling week it is a finding, not a number.
- **Raising is monotonic; lowering is a recorded override.** Sensitivity raises. An operator may lower a shape only with a reason, and the override is visible on the item and in the gate decision.
- **No artifact is produced solely to satisfy a gate.** If a shape's gate table asks for something the work did not naturally produce, the table is wrong, not the work. This is the direct answer to the after-the-fact plan pressure in BI-28E8CB88.

## 5. Open decisions (founder)

1. **Is `break-fix` a shape or a lane flag on `small`?** Recommendation: a shape. Its gates differ in kind (post-hoc), it needs a WIP limit and a frequency signal, and operators will look for it by name. Cost: one more `BacklogEffortSize`-adjacent value, stored as `workShape`, not as an effort size.
2. **Who may declare `break-fix`?** Recommendation: any human operator with `view_platform`, and the operations coworker when an incident record exists. Never an unattended build. The declaring principal is recorded and cannot be the PIR reviewer.
3. **Does `medium` require an independent acceptance reviewer, or is author acceptance with live-install evidence enough?** Recommendation: author acceptance with recorded runtime evidence. Independent acceptance starts at `large`. On a single-human-principal install, mandatory independent acceptance for medium work is the CAB anti-pattern.
4. **Does sensitivity `high` on a `small` shape raise to `medium` gates (recommendation) or all the way to `large`?**
5. **Retroactive classification of the 33 `done` items with no baseline.** Recommendation: leave them; add the shape column with `null` meaning "pre-taxonomy" and report the count once, not as a permanent blocker.

## 6. Implementation outline (for the plan that follows this spec)

1. **Schema:** `BacklogItem.workShape` (`break-fix|small|medium|large|xlarge`, closed-set CHECK like the other contract-pending columns), `workShapeSource` (`derived|override`), `workShapeReason`. Workroom, FeatureBuild and TaskRun read it through the item; no duplicate columns.
2. **Classifier:** `deriveWorkShape(item)` next to `deriveAuthoritativeReadinessProfile` (`profiles.ts`), consuming the same signals plus the substrate-addition detector. Unclassified → `large` + `high`.
3. **Readiness policy v3:** requirements keyed by (shape, sensitivity, target). Completion requirements become shape-conditional. `OBJECTIVE_BASELINE_REQUIRED` is satisfiable by an item-body acceptance baseline for `small|medium`.
4. **Delivery evidence:** merge-reachability resolver reads the linked PR when no Workroom is bound.
5. **Build Studio matrix:** the `(type, size)` cell lookup becomes `(shape, sensitivity)`; the cell bodies stay. `break-fix` maps to the `FIX_SMALL` cell with `promptVariant = "hotfix"`.
6. **Expedite lane:** `declare_break_fix` on the backlog pack (records declarer, incident ref, starts the 48h PIR clock); PIR receipt writer; WIP-1 check at claim; frequency signal on Right Now governance card.
7. **Docs:** kernel principle `gates-proportional-to-shape` under `docs/founder-kernel/wiki/principles/`; AGENTS.md §5 one-liner pointing at it; `backlog-and-planning-runbook.md` shape table.
8. **Tests:** policy table tests per (shape, sensitivity, target); classifier fixtures for every rule in §3.3 including unclassified-defaults-strict; expedite abuse fixtures (missed PIR, WIP > 1, self-PIR).

Estimated size of this work: `large` (schema + policy + three consumers), decomposed into 4–6 `medium` children under EP-129D11FD.

## 7. What this does not change

- The PR gate itself (tests, typecheck, DCO, local-CI lease, deterministic guards). Every shape runs it. DORA's finding is about *external* approval, not about automated verification.
- Separation of duties on independent lanes: a reviewer receipt still comes from an eligible independent reviewer wherever the table asks for one.
- The `archetype` codes (`ARCHETYPE_PROVISIONING_INCOMPLETE`, `ARCHETYPE_COMPLETENESS_FAILED`) — they attach to `large` + archetype scope unchanged.

## 8. Research appendix — sources

- ITIL 4 change enablement, standard/normal/emergency and change authority: itsm.tools/change-enablement; Atlassian ITSM change management; BMC Helix change types.
- SAFe epics, hypothesis statement, Lean business case, WSJF: framework.scaledagile.com/epic; agility-at-scale.com/safe/lpm/epics.
- Shape Up appetite, betting table, cool-down bug handling: basecamp.com/shapeup chapters 2.2, 2.3, 4.1, 4.5.
- Kanban classes of service and expedite WIP limit: businessmap.io classes-of-service; kanbanzone.com classes-of-service.
- Google small CLs and review standard: google.github.io/eng-practices/review/developer/small-cls.html.
- Trunk-based development short-lived branches: trunkbaseddevelopment.com/short-lived-feature-branches.
- DORA small batches and streamlining change approval; Accelerate finding on external approvals: dora.dev/capabilities/working-in-small-batches, dora.dev/capabilities/streamlining-change-approval; Team Topologies "When DORA metrics meet governance in banking".
- IEC 62304 software safety classes A/B/C and per-class activities: Johner Institute safety-class article; Greenlight Guru.
- ISO 27001:2022 A.8.32 and SOC 2 CC8.1 change management evidence: hightable.io A.8.32; thesoc2.com emergency change procedures.
- Hotfix / roll-forward vs rollback: gocd.org hotfixes-rollback-rollforward; red-gate.com database roll-forward.
