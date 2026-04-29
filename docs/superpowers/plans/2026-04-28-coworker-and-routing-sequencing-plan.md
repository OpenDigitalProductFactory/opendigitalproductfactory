# DPF Sequencing Plan - Coworker Roster + Routing Substrate

| Field | Value |
|-------|-------|
| **Created** | 2026-04-28 |
| **Revised** | 2026-04-28 |
| **Author** | Claude Opus 4.7 for Mark Bodman |
| **Review refactor** | Codex architectural review and rewrite |
| **Status** | Draft for review - no new PRs should start from this document until Mark approves the sequence |
| **Scope** | Sequence the routing-substrate work, coworker-roster correction work, and seed/runtime-boundary work into one dependency-aware execution plan with explicit gates, outputs, and ownership choices |
| **Why this exists** | Several solid specs and audits landed in 24 hours, but they landed as adjacent tracks rather than one execution contract. The result was predictable: PR #318 shipped a mechanical rename before the control-plane substrate it depended on existed, and the first visible symptom was the marketing coworker runtime failure against an unmigrated DB. The missing artifact was not another fix PR; it was a sequencing plan that distinguishes containment, substrate, hygiene, and expansion. |

---

## 1. Executive architectural judgment

The current draft had the right instinct but mixed four different kinds of work into one queue:

1. **Containment work** - make current drift visible and bounded.
2. **Substrate work** - build the control-plane/runtime architecture that prevents repeat drift.
3. **Hygiene work** - align registry, persona, and grant catalogs so the roster is internally coherent.
4. **Expansion work** - implement the missing coworker capabilities that unlock new value streams.

Those are not interchangeable. If we let expansion run before substrate, we will reproduce the same failure class with a larger blast radius. If we let hygiene wait until after expansion, we will build against a misleading registry. The sequence below corrects that.

This revision also corrects one factual issue in the earlier draft:

- **A2A is not "prompt only" anymore.** This worktree already contains both [2026-04-23-a2a-aligned-coworker-runtime.md](./2026-04-23-a2a-aligned-coworker-runtime.md) and [2026-04-23-a2a-aligned-coworker-runtime-design.md](../specs/2026-04-23-a2a-aligned-coworker-runtime-design.md). What is missing is approval and implementation sequencing, not authorship from scratch.

---

## 2. Ground truth snapshot

### 2.1 What actually landed on 2026-04-28

| PR | Subject | State assessment |
|---|---|---|
| #309 | Routing substrate fixes + cost capture + spec | Important spec and partial fixes landed; architecture not yet realized |
| #310 | Routing boot-invariant audit | Good evidence layer landed |
| #311 | CI gate for routing audit | Good detection layer landed |
| #312 | Eliminate seed-as-data-load | Spec only; no implementation |
| #313 | AGENTS.md canonicalization | Complete mechanical cleanup |
| #314 | Portal URL from request headers | Complete bug fix |
| #316 | Coworker persona audit | Audit + CI gate; persona corpus still materially incomplete |
| #317 | Coworker tool-grant audit + grant catalog | Audit + CI gate; major reconciliation backlog remains |
| #318 | `capabilityTier` -> `capabilityCategory` rename | Mechanical schema/code change landed before its architectural prerequisite |
| #319 | Portal URL helper split | Complete bug fix |
| #320 | Session-cookie Secure flag | Complete bug fix |
| #321 | Pre-commit auto-regen Prisma client | Developer convenience only; not a deployment/migration answer |
| #322 | Coworker self-assessment Phase 1 | Discovery complete; Phase 2 implementation batches still need honest sequencing |

### 2.2 What is broken right now

- **Marketing coworker fails** with `column ModelProfile.capabilityCategory does not exist`.
- Root cause is not merely "migration not applied." The deeper failure is that a mechanical rename shipped before the runtime/control-plane publication model in [2026-04-27-routing-control-data-plane-design.md](../specs/2026-04-27-routing-control-data-plane-design.md) existed.
- [2026-04-27-routing-spec-boot-invariants.md](../audits/2026-04-27-routing-spec-boot-invariants.md) already established that seed/runtime drift is systemic, not incidental.

### 2.3 What is committed but still under-sequenced

- Routing control/data-plane phases A-L
- Persona audit remediation
- Tool-grant audit remediation
- Coworker self-assessment Phase 2
- Seed-elimination substrate
- A2A-aligned coworker runtime plan/spec
- Local LLM grading incremental design

The risk is no longer lack of ideas. The risk is uncontrolled concurrency across shared substrate files: registry, grant catalog, routing control-plane, model/provider state, prompt/persona surfaces, and schema.

---

## 3. Planning principles for this thread

1. **Substrate before expansion.** No new capability family should ship onto the old routing/runtime boundary if it depends on platform state mutation.
2. **Containment before confidence.** We need one small evidence-and-boundary pass before we make irreversible architectural choices.
3. **Registry truth before coworker expansion.** Persona, grant, and self-assessment artifacts must agree on what the roster is before we add more verbs.
4. **Spec before epic.** Any batch that introduces a new durable domain model becomes its own spec+plan pair before implementation.
5. **Owners are not dependencies.** The plan should identify likely owners, but sequencing must remain correct even if ownership changes.
6. **UI-visible work must include route discovery and UX verification.** If a batch claims to make a coworker usable through a visible surface, it must discover the actual route/tab/shell and verify it there, not only through code-level reasoning.

---

## 4. Work decomposition

The original "five tracks" framing was useful. It becomes much stronger when the tracks are recast by execution role.

### Track A - Containment and evidence

Purpose: make the current failure class explicit and bounded before substrate edits begin.

- **A1 - Rename drift surface audit.**
  Output: `docs/superpowers/audits/2026-04-28-rename-318-drift-surfaces.md`
  Must enumerate: host install, sandbox install, fresh install, upgrade path, running container path, and every runtime surface reading the renamed field.
- **A2 - Deployment-path decision record.**
  Output: short ADR-style note answering one question:
  "Until Phase A exists, what is the approved deployment-path truth for schema-changing PRs?"
  This is not the permanent architecture; it is the containment contract.

### Track B - Routing substrate critical path

Purpose: build the architecture that makes the current class of drift structurally impossible or at least structurally loud.

- **B1 - Routing Phase A (RIB introduction / publication boundary)**
- **B2 - Phase B remainder (named state transitions)**
- **B3 - Phase C (probe daemon)**
- **B4 - Phase D (compile RIB -> FIB)**
- **B5 - Phase E (data plane dispatches from FIB)**
- **B6 - Phase F (remove legacy routing paths)**

This is the true critical path for the routing substrate. The rest of the plan must respect it.

### Track C - Coworker roster hygiene

Purpose: make the coworker roster internally truthful before expansion work starts.

- **C1 - Persona schema migration for the 21 existing personas**
- **C2 - GRANT-003 reconciliation: add catalog entries for the 10 real checked-but-uncataloged grants**
- **C3 - AGT-BUILD-* capability-domain differentiation**
- **C4 - Boundary adjudication changes after supervisor decisions**
- **C5 - Missing persona authoring backlog for the 50 absent personas**

Important split:

- `C1-C4` are platform hygiene.
- `C5` is content production and should not block substrate work unless a specific batch depends on a specific missing persona.

### Track D - Coworker capability enablement

Purpose: unblock coworkers by implementing missing tool families only after the substrate and registry are trustworthy enough.

- **D1 - Governance reads**
- **D2 - Deploy VS rounding**
- **D3 - SBOM substrate**
- **D4 - Incident domain**
- **D5 - Release catalog + subscription domain**
- **D6 - Consume fulfillment/support domain**
- **D7 - Governance enforcement domain**
- **D8 - Evaluate VS domain**

The original draft correctly sensed that D3-D8 are not "batches" in the same sense as D1-D2. This revision makes that explicit:

- `D1-D2` are implementation batches.
- `D3-D8` are domain programs that each require a spec-backed slice before implementation starts.

### Track E - Adjacent substrate

Purpose: coordinate neighboring architectural work without letting it collide with the routing critical path.

- **E1 - Seed-elimination implementation strategy**
- **E2 - A2A runtime sequencing**
- **E3 - Local LLM grading Phase 1**
- **E4 - Build Studio independent queue**

---

## 5. Dependency matrix

This is the most important correction in the review. The old draft described order mostly in prose. The plan now makes the dependency contract explicit.

| Work item | Depends on | Why |
|---|---|---|
| A1 | none | First evidence pass |
| A2 | A1 | Deployment-path decision should be based on actual drift surfaces |
| B1 | A1 | Phase A should be informed by the real drift map |
| B2 | B1 | Named transitions only make sense once the publication boundary exists |
| B3 | B2 | Probe outcomes must feed the state machine you just formalized |
| B4 | B3 | FIB compilation depends on real state signals |
| B5 | B4 | Data plane cannot read a FIB that does not exist |
| B6 | B5 | Legacy removal only after new path is serving traffic |
| C1 | none | Safe to run early; mechanical |
| C2 | none | Safe to run early; mechanical and audit-aligned |
| C3 | none | Safe to run early; registry correction |
| C4 | supervisor decisions | Governance call, not engineering uncertainty |
| C5 | C1 schema shape | Persona authoring should target the stabilized schema |
| D1 | B2, C2 | First safe enablement slice needs named transitions and a truthful grant catalog |
| D2 | B2, C2 | Same rationale as D1 |
| D3-D8 spec authoring | B1, C2 | New domain specs should target the new substrate and current grant truth |
| D3-D8 implementation | corresponding spec + B6 | Domain implementation should not land while legacy routing remains half-live |
| E1 decision | B1, B2 | Seed-elimination should align to the actual publication boundary and transition model |
| E1 implementation | B6 or an explicitly approved earlier slice | Avoid interleaving two substrate rewrites blindly |
| E2 implementation | D-track midpoint + approved existing spec | A2A is already designed; timing is the real question |
| E3 implementation | B4 | Local grading overlaps routing/profile selection and should target the compiled routing architecture |

---

## 6. Execution sequence

This plan now uses **waves**, not a falsely serial numbered list. Some work is parallel-safe; some work is not.

### Wave 0 - Review and freeze

Goal: stop new opportunistic PRs from racing this plan.

Exit criteria:

- Mark approves or redirects this plan.
- No new Claude PRs start from the old batch lists while this decision is open.

### Wave 1 - Containment and evidence

1. **A1 - Rename drift surface audit**
2. **A2 - Deployment-path decision record**
3. **B1 - Routing Phase A plan confirmation and owner selection**

Artifacts:

- Drift-surface audit document
- Short decision record on schema-change deployment truth
- Confirmed Phase A owner and slice plan

Exit criteria:

- The team can explain exactly where the rename can still fail.
- The team has one explicit interim rule for schema-changing PRs.
- Phase A is ready to start with no ambiguity about what it must protect.

### Wave 2 - Parallel-safe hygiene lane

These items can proceed while Phase A is being built because they reduce ambiguity without deepening substrate coupling.

1. **C1 - Persona schema migration for the 21 existing personas**
2. **C2 - GRANT-003 reconciliation**
3. **C3 - AGT-BUILD-* capability-domain differentiation**

Artifacts:

- Lower persona-audit error floor
- Honest grant catalog for the already-real checked grants
- Build-agent registry no longer misdescribes four distinct roles as one

Exit criteria:

- Persona audit is reduced to missing-content work rather than mixed schema/content noise.
- Tool-grant audit no longer has the checked-but-uncataloged class for the 10 confirmed grants.

### Wave 3 - Routing substrate critical path

1. **B1 - Phase A**
2. **B2 - Phase B remainder**
3. **B3 - Phase C**
4. **B4 - Phase D**
5. **B5 - Phase E**
6. **B6 - Phase F**

Important gate refinement:

- The previous draft required a full production day after every phase. That is too blunt.
- New rule:
  - **B1 and B5 require explicit soak gates** because they change publication/dispatch behavior materially.
  - **B2-B4 and B6 require verification gates**, not automatic 24-hour holds, unless they expose production instability during rollout.

Artifacts:

- RIB publication boundary
- Named transition layer
- Probe signal path
- FIB compiler
- FIB-backed dispatch
- Legacy routing removal

Exit criteria:

- Boot-invariant audit reaches zero errors for routing-substrate invariants that these phases are meant to solve.
- The marketing-coworker error class is structurally prevented or rendered immediately loud by the new publication/deployment contract.

### Wave 4 - First enablement slices

Only after Wave 3 completes:

1. **D1 - Governance reads**
2. **D2 - Deploy VS rounding**
3. **C4 - Boundary adjudication PR** after Mark decides the 11 disputed boundaries

Why these first:

- They are the best ratio of unblock value to architectural blast radius.
- They are good proving grounds for the new sequencing discipline.
- They do not require inventing a large new durable domain before the team has validated the first enablement pattern.

Exit criteria:

- At least one small coworker-capability family has shipped cleanly on the new substrate.
- Boundary duplications are reduced through explicit supervisor-approved ownership.

### Wave 5 - Promote epics to spec-backed programs

Before any implementation on the remaining enablement domains:

1. **D3 - SBOM substrate spec confirmation or refinement**
2. **D4 - Incident domain spec**
3. **D5 - Release catalog/subscription domain spec**
4. **D6 - Consume fulfillment/support domain spec**
5. **D7 - Governance enforcement domain spec**
6. **D8 - Evaluate VS domain spec**

Important correction from the previous draft:

- These should not be described as "later batches."
- They are each multi-slice programs with their own data model, workflow, and UX implications.

Exit criteria:

- Each remaining enablement domain has an approved design artifact and a smallest-slice implementation plan.

### Wave 6 - Adjacent substrate alignment

1. **E1 - Seed-elimination re-entry decision**
2. **E2 - A2A sequencing decision using the already-authored plan/spec**
3. **E3 - Local LLM grading Phase 1 resume decision**

This wave is intentionally decision-heavy rather than implementation-heavy. The point is to re-enter adjacent architecture from a stable routing base rather than from churn.

### Wave 7 - Program execution beyond the first slices

1. Implement `D3-D8` in approved slice order
2. Resume `E1-E3` according to the decisions made in Wave 6
3. Continue routing phases `G-L` after the platform is no longer absorbing foundational churn

---

## 7. What is explicitly paused

- **The 50-persona authoring backlog as a blanket blocker.**
  It should continue as content work, but it does not sit on the routing critical path.
- **Any new Phase 2 coworker-implementation batch beyond D1/D2**
  until the routing substrate critical path is complete.
- **Treating A2A as a fresh authorship track.**
  The design exists. Timing and integration decisions are what remain.
- **Local LLM grading implementation**
  until the routing substrate reaches at least B4.
- **Seed-elimination implementation churn**
  until we decide whether the first slice should be aligned directly to the B1/B2 publication boundary or intentionally held until B6.

---

## 8. Cross-cutting gates

These apply to every implementation PR opened under this plan.

### G1 - Spec-before-epic

Any change that introduces a new durable domain model, new cross-agent workflow, or meaningful schema surface must have an approved spec first.

Examples:

- Incident domain
- Release/subscription domain
- Consume fulfillment domain
- Governance enforcement domain

### G2 - Runtime-proof gate

Any PR that claims to fix a runtime failure or enable a coworker capability must be verified against the actual running install path it affects, not only a unit-test or static audit path.

### G3 - Surface discovery gate for UI-visible coworker work

If a batch claims a coworker is now usable through a visible portal/build/admin surface:

- discover the actual route/tab/shell first
- verify there
- record the verification path in the PR or follow-up evidence note

### G4 - Audit regeneration gate

If a PR touches registry, grants, personas, or coworker capabilities, regenerate the relevant audit artifact in the same PR:

- persona audit
- tool-grant audit
- self-assessment follow-up where relevant

---

## 9. Recommended ownership defaults

Ownership is secondary to sequence, but default assignment helps execution start cleanly.

| Area | Default owner | Reason |
|---|---|---|
| A1-A2 | Claude | evidence and decision-record work |
| B1-B6 | Build Studio or Mark-directed deep implementation lane | shared routing substrate with high architectural depth |
| C1-C4 | Claude | mechanical reconciliation and registry hygiene |
| C5 | Build Studio / content lane | large content-production backlog |
| D1-D2 | Claude | smallest controlled enablement slices |
| D3-D8 specs | Claude or Mark | architecture/spec-first work |
| D3-D8 implementation | Build Studio after specs | larger programs, likely multi-PR |
| E1-E3 decisions | Mark + architecture lane | cross-cutting product/platform choices |

---

## 10. Open decisions for Mark

1. **Phase A owner:** who owns `B1-B6`?
2. **Containment rule:** until Phase A lands, do schema-changing PRs require an explicit deployment-path step in the PR contract?
3. **Persona backlog ownership:** should the 50 missing personas continue in a separate content lane?
4. **Boundary adjudication format:** do the 11 disputes get one supervisor pass or separate threads by value stream?
5. **Seed-elimination re-entry point:** do we want the first implementation slice aligned immediately after `B2`, or do we deliberately wait for `B6`?
6. **A2A timing:** do we treat the existing A2A plan/spec as a Wave 6 decision item, or pull it forward sooner for a specific reason?

---

## 11. Immediate next actions if approved

1. Write **A1**: the rename drift-surface audit.
2. Write **A2**: the deployment-path decision record.
3. Start **C1-C3** as the safe hygiene lane.
4. Confirm owner and slice shape for **B1** before any new enablement PR starts.

That is the smallest architecture-sound next move. It contains the current failure class, improves truthfulness of the coworker roster, and preserves room to make the larger substrate decisions once instead of three times.
