---
status: draft
---

# Hive harvest and contribution reachability — Implementation Plan

| Field | Value |
|-------|-------|
| **Epic** | EP-HIVE-HARVEST |
| **Design** | [2026-09-12-hive-harvest-and-contribution-reachability-design.md](../specs/2026-09-12-hive-harvest-and-contribution-reachability-design.md) |
| **Created** | 2026-09-12 |
| **Author** | Claude Opus 5 for Mark Bodman |

---

## Coverage

Every deliverable maps to a filed backlog item. Nothing in this plan is unowned.

| Phase | Backlog item | Design section | Depends on |
|---|---|---|---|
| 1 | BI-D4BA68BD — one allow-check on every upstream path | §4.5, narrowed by §4.8 | — |
| 2 | BI-5BB8B959 — contribution source, not only a build diff | §4.1 | 1 |
| 3 | BI-E3D9F9CD — seed serializer registry | §4.2, constrained by §4.6 | 2 |
| 4 | BI-BE75E2C8 — the harvester and its candidate queue | §4.3, bounded by §4.9 | 2, 3 |
| 5 | BI-B4C8FF84 — bind `Seed-Fit-Decision` to candidacy | §4.4 | 4 |

**Not owned by this plan, and tracked elsewhere.** These must not be re-implemented here.

| Concern | Owner |
|---|---|
| Publish happens before readiness runs | BI-46E9AB38 |
| Local-CI gate is structurally absent from the in-platform path | BI-96253639 |
| Ref force-update with no ancestry check | BI-9A405652 |
| Fork model built but not wired; head equals base | BI-D75B87B1 |
| Spend originating outside the portal is invisible | BI-FDB896D7 |
| Metered lanes are governance, not coding | BI-A20D9F82 |
| The rung between portfolio and workroom | BI-C30A4694 |
| Inbound seed reconciliation and three-way merge | upgrade-lifecycle spec |

---

## Phase 1 — make the safety controls honest (BI-D4BA68BD)

Sequenced first because the measured state is zero contributions. The moment that changes, the pause toggle and the consent surface have to mean what they say.

1. Add `assertContributionAllowed(context)` in the contribution library: mode, master pause, DCO, disposition. Fail closed, one reason string per refusal.
2. Call it from `contribute_to_hive`, from `create_portal_pr` when its egress classification is the public hive, and from the skill seed pull request. **Call it before any remote write**, establishing the position in the sequence that BI-46E9AB38 will complete.
3. Write `contributionType: "source"` to the ledger on every source contribution.
4. Add `feedback` and `result` to the consent surface; both are written today and disclosed nowhere.
5. Make a failing security scan refuse rather than label.
6. Delete `submitBuildAsPR`, and correct the architecture doc that counts it as a covered chokepoint.

**Verify:** a test that toggles the master pause and asserts all three paths refuse. A test that a failing scan opens no pull request. A test that a source contribution writes a ledger row.

**Trap.** Do not add the consent check after the branch is published. That would satisfy this phase's acceptance while leaving BI-46E9AB38's defect intact and making it harder to see.

---

## Phase 2 — contribution source (BI-5BB8B959)

1. Extract the current build lookup into `resolveContributionSource({ kind: "build" })` returning `{ files, provenance }`. No behaviour change.
2. Prove no regression before adding anything: the build path must produce a byte-identical pull request.
3. Add `kind: "paths"` — repo-relative paths in a governed worktree, diffed against `origin/main`. This is what makes the tool reachable from an external session.
4. Add `kind: "artifacts"` — ids resolved through the phase-3 registry. Land the interface here and the serializers in phase 3.

**Verify:** AC-HIVE-005 first and as a gate on the rest. Then AC-HIVE-004, exercised by running the worked example in `dpf-route-learning-to-commons` end to end. That example currently returns "No active build" and is the honest measure of this phase.

**Read first:** BI-96253639. This phase increases traffic through a path with no local-CI contract. Land it knowing that, and say so in the pull request.

---

## Phase 3 — serializer registry (BI-E3D9F9CD)

1. Define `SeedSerializer`: `resolveSeedPath`, `render`, `validate`, and `resolveScope` from §4.6.
2. Move the existing skill writeback into the registry unchanged, as the reference implementation and the regression guard.
3. Add prompt, profession wiki page, kernel principle and knowledge article.
4. `validate` runs the corpus's own gate — the persona audit for a persona, `wiki_lint` for a wiki page — before the file is offered.
5. Surface `no-seed-file` and `no-scope` as named outcomes.

**Two rules carried from the skill writeback, both load-bearing.** Never invent a path; guessing seeds a file the loader never reads. Only a written file counts as propagated.

**Constraint from §4.6.** A serializer must emit scope and refuse when the source carries none. Organization knowledge cannot currently do this, because those pages are seeded from an archetype and then discard the reference. Either the serializer refuses for that kind until the reference is retained, or retaining it becomes part of this phase. **Decide before building, and record the decision.** Refusing is acceptable and visible; guessing is neither.

**Verify:** AC-HIVE-006 and AC-HIVE-007.

---

## Phase 4 — the harvester (BI-BE75E2C8)

1. Add `contribution-candidate-sweep` to the scheduled-job catalogue, weekly.
2. Read the local-changes ledger, `ImprovementProposal` where `contributionStatus = 'local'`, and artifacts changed since the last sweep.
3. Classify deterministically first. Record `install-local-only` and `reject-as-seed` as decided, not pending.
4. Report the unclassified residue every run, and honour a per-run inference ceiling with attributed spend.
5. Emit a candidate queue beside the local-changes ledger, and one digest backlog item per sweep.
6. **The sweep never calls `contribute_to_hive`.**

**First run is manual.** 239 proposals is a fortnight's backlog. Run it once with the ceiling raised, review the output, then put it on a cadence. Putting it straight on a schedule hides the one run whose output most needs a human eye.

**Verify:** AC-HIVE-008, AC-HIVE-009, AC-HIVE-011. AC-HIVE-011 accepts an honest negative: if nothing qualifies, the sweep says why.

---

## Phase 5 — bind the decision already being made (BI-B4C8FF84)

1. Read the `Seed-Fit-Decision` trailer at branch finish.
2. A shareable verdict creates a candidate; `install-local-only` records a decision with its reason.
3. No new question is added to anyone's workflow.

**Verify:** AC-HIVE-010.

---

## Risks

**The rung this depends on does not exist.** BI-C30A4694. Scoped contribution degrades to guesswork for anything harvested from a room, because a room carries a portfolio role and no archetype. Phases 1 to 4 ship without it; phase 3's scope derivation is weakest exactly where the rung is missing, and the refusal path is what keeps that visible rather than silent.

**Reach without a gate.** BI-96253639 means the in-platform contribution path has no local-CI contract. Phase 2 widens that path. The mitigation is to say so plainly in the pull request rather than to hold the phase, because the gate gap is owned and being worked separately.

**Invisible spend.** BI-FDB896D7. A weekly job that calls a model is the shape that becomes unexplained usage. Phase 4's ceiling and attribution are the mitigation and are not optional.

**Contributing into a fleet that cannot merge.** Until the customization fingerprint and three-way merge exist, a receiving install either clobbers a local customization or skips the improvement. This is worth doing anyway and worth stating the limit of, in the spec and in the first digest.

---

## Sequencing note

Phase 1 is small and independent and should land first regardless of what follows. Phases 2 and 3 are the reachability pair and are worth landing together in spirit even if they ship as two pull requests, because a contribution source with no serializers is reachable and empty. Phase 4 is where the founder's question is actually answered, and it is deliberately last of the build phases because a harvester that produces candidates nothing can act on is a report, not a loop.
