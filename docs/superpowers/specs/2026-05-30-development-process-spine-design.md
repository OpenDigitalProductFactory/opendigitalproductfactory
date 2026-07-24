---
title: Development Process Spine — Distribution, Enforcement, and Refinement
authoredAt: 2026-05-30
authoredBy: claude
status: active
specKind: design
implementationStatus: "Enforcement edge (§6.3 spec/plan review trigger + the spec/plan/doc PR gate) landed 2026-06-18 under EP-PROCESS-SPINE. Remaining P0/P1/P2 items tracked there. See §12 addendum."
relatedSpecs:
  - docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md
  - docs/superpowers/specs/2026-05-09-deployment-contracts.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/single-source-of-truth.md
  - docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md
  - docs/professions/data-architect/wiki/schema-audit-before-features.md
externalReferences:
  - https://www.modelcontextprotocol.io/
  - https://docs.anthropic.com/en/docs/claude-code/hooks
  - https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks
---

# Development Process Spine — Distribution, Enforcement, and Refinement

## 1. Purpose

DPF already has a strong **definition** of how development should happen:
`AGENTS.md` as the canonical rulebook, 65 kernel principles, and 18
`dpf-platform` skills (chief-architect review, substrate verification,
worktree-per-session, PR-with-DCO, and more). The problem is not what the
process says — it is whether every future thread and every future install
across **Build Studio, Claude Code, and Codex** actually *runs* it, and
whether process learning flows back into the canonical source instead of
evaporating.

This spec defines the **process spine**: the mechanism that makes the
development discipline (a) distributed to every install, (b) enforced at the
edges rather than left to an agent's memory, and (c) continuously refined
through a closed loop. The goal is parity of *enforcement* across the three
surfaces using the *single* canonical definition that already exists.

This is not a new rulebook. `AGENTS.md` and the kernel remain the single
source of truth. This spec is about the edges and the loop around that source.

## 2. Problem Evidence

Two failures in a single working session motivated this spec; both were
enforcement gaps, not content gaps:

1. **Silent loss of uncommitted work.** A design-doc addendum (~100 lines)
   authored by one session sat untracked in the shared root worktree. A
   concurrent session switched branches; the working tree reset; the work was
   unrecoverable (`git fsck` found no dangling blob — it was never staged).
2. **Untracked spec at risk.** A second design spec was found committed to no
   branch anywhere — it existed only as an untracked file in the shared root,
   one branch operation away from the same fate.

In both cases the relevant discipline *existed* (`worktree-per-session`,
"commit your work", PR-at-end-of-work) but nothing in the harness enforced it.
The architecture-review discipline has the same shape: the
`dpf-architecture-review` skill exists, but on the Claude/Codex surfaces it
only runs if the agent remembers to invoke it.

## 3. Substrate Verification

No existing "process spine" / "process distribution" spec or backlog item was
found. The relevant substrate already exists in pieces and must be extended,
not duplicated:

| Layer | Existing substrate | Current posture |
| --- | --- | --- |
| Define | `AGENTS.md` (§1–16); `docs/founder-kernel/wiki/principles/` (65 files); `packages/dpf-skill-pack/` (18 skills) | Strong single-source-of-truth. Pointer files (`CLAUDE.md`, Codex config, `apps/web/lib/integrate/build-project-context.ts`) reference it without copying. |
| Distribute | `scripts/dpf-bootstrap-agent-toolchain.sh` (+`.ps1`); `packages/dpf-bootstrap/src/agent-toolchain/`; `.claude-plugin/marketplace.json`; `.agents/plugins/marketplace.json`; `packages/db/src/seed-skills.ts` | Live, idempotent, dual-surface. **Phase 5 (HTTP token mint + kernel smoke probe) is stubbed** — install wiring is built but not energized end-to-end. |
| Enforce (Build Studio) | `apps/web/lib/integrate/build-reviewers.ts` — `buildArchitectureReviewPrompt` (advisory) + design/plan checklist reviewers, run at Ideate/Plan gates via `reviewDesignDoc` / `reviewBuildPlan` MCP tools | Always-on. Architecture advisory rides on `ReviewResult.architectureAdvisory`. This is the reference posture. |
| Enforce (git/harness) | `.githooks/pre-commit` (migration immutability, typecheck, secret scan); `.claude/settings.json` hooks (`PostToolUse`, `SessionEnd` snapshot) | Live but **no guard against uncommitted-work loss** and **no spec/plan review trigger** on the Claude/Codex surfaces. |
| Refine | `propose_skill_improvement`, `propose_improvement`, `register_tech_debt`, `flag_stale_knowledge`, `report_quality_issue`, `submit_feedback`; `dpf-capture-kernel-gap` skill | Capture + triage exist (`ImprovementProposal` → `/platform/ai/skills`, `/admin/improvements`). **No automated promote step** from a review finding to a canonical-source PR, and **no scheduled redistribution** of refinements to existing installs. |

Verdict: extend the bootstrap, the hook surface, and the refinement tools.
Do not create a parallel "process engine" — the spine is the wiring between
substrates that already exist.

## 4. The Four-Layer Model

The process spine has four layers. Each must hold for every surface:

1. **Define once** — one canonical definition (`AGENTS.md` + kernel +
   skill-pack). Already true.
2. **Distribute everywhere** — every install and every worktree receives the
   definition automatically. Partially true (Phase 5 stubbed).
3. **Enforce at the edges** — the harness, not the agent's memory, makes the
   discipline run. True for Build Studio; weak for Claude/Codex.
4. **Refine in a loop** — observations promote into the canonical source and
   redistribute. Capture/triage exist; promote/redistribute are manual.

The leverage is in layers 3 and 4. Layer 1 is solved; layer 2 needs energizing.

## 5. Doctrine

### 5.1 The canonical source is never duplicated, only referenced
Every surface reads `AGENTS.md`, the kernel principles, and the skill-pack
through a pointer. The spine adds enforcement and distribution around that
source; it must not fork the rules into per-surface copies.
(`single-source-of-truth`)

### 5.2 Enforcement is harness-level, not memory-level
Any discipline that matters must be enforced by a hook, gate, or test — not
by the agent choosing to remember it. A rule that lives only in prose is a
suggestion. (`architecture-over-shortcuts`)

### 5.3 Parity of enforcement across surfaces
Build Studio's always-on gate posture is the target. Claude and Codex should
reach the same outcomes through hooks and triggers, using the same canonical
source, even though their enforcement primitives differ.

### 5.4 Refinement is data, not prose
A review finding worth keeping is emitted as a structured proposal
(`ImprovementProposal`), not buried in a PR body. The loop that turns
proposals into canonical-source updates is itself a tracked, scheduled
process.

### 5.5 The spine is versioned
The process spine carries a version. Installs record the spine version they
were provisioned with so drift is detectable and re-sync is routine.

## 6. Proposed Foundation

### 6.1 Versioned spine + conformance test

Introduce a single `PROCESS_SPINE_VERSION` constant and a conformance test
(extending the existing mirror-field invariant test, BI-98683E68) that asserts:

- each surface pointer (`CLAUDE.md`, Codex config template, BS
  `build-project-context.ts`) references `AGENTS.md` and the skill-pack,
- the enforcement hooks named in this spec are present in the seeded
  `.claude/settings.json` and git hook paths,
- the skill-pack manifest and `seed-skills.ts` enumerate the same skill set.

The version is stamped into install state so an install can detect it is
behind and re-run the bootstrap.

### 6.2 Energize bootstrap Phase 5 (distribution backbone)

Land the stubbed Phase 5 of `2026-05-26-agent-toolchain-bootstrap-design.md`:
live HTTP token mint and the kernel-principle smoke probe, so a fresh install
provably has (a) a working MCP token, (b) the plugin enabled on both Claude and
Codex, and (c) the commandment-tier principles seeded to contributor memory.
Distribution is the precondition for every other layer; until this is real,
"every install runs the process" is aspirational.

### 6.3 Enforcement edges (hook parity)

Seed two new guards through the bootstrap so every install and worktree gets
them:

- **Uncommitted-work guard.** A `SessionEnd`/`Stop` hook plus a git
  `post-checkout` / `pre-checkout`-equivalent guard that warns when
  tracked-but-uncommitted or untracked files exist under
  `docs/superpowers/specs/`, `docs/superpowers/plans/`, or other configured
  durable-artifact paths. Directly prevents the §2 loss. Escape hatch via env
  var, consistent with existing `DPF_SKIP_*` gates.
- **Spec/plan review trigger.** A `PostToolUse` hook that fires when a file
  under `docs/superpowers/specs|plans/` is written/edited and surfaces a
  reminder to run `dpf-verify-substrate-first` then `dpf-architecture-review`
  before committing. This lifts the Claude/Codex surfaces toward Build Studio's
  always-on gate without forcing a blocking gate on an interactive surface.

### 6.4 Surface parity: Claude/Codex → Build Studio posture

Build Studio runs the architecture advisory automatically at Ideate/Plan gates.
The external surfaces reach equivalence through 6.3's trigger hook plus the
existing skill triggers in `AGENTS.md` §16. The conformance test (6.1) asserts
the trigger is wired on each surface. No surface gets a *weaker* default than
Build Studio for the same artifact type.

### 6.5 Refinement loop closure

Close the two open edges of capture → triage → **promote** → **redistribute**:

- **Promote (emit as data).** Extend `dpf-architecture-review` (and the
  checklist reviewers) so a `[reference-doc]` finding auto-calls
  `propose_improvement` / `propose_skill_improvement` with the target doc and
  the concrete edit. Findings become rows, not prose.
- **Promote (digest → PR).** A scheduled routine batches accumulated
  `ImprovementProposal` rows of the relevant categories into canonical-source
  update PRs (against `AGENTS.md`, a principle file, or a `SKILL.md`),
  routed through the existing review surfaces for human approval.
- **Redistribute.** On approval/merge, `seed-skills.ts` reload republishes
  skills to coworkers, and the spine version bump (6.1) signals existing
  installs to re-run the idempotent bootstrap on next session.

## 7. Implementation Sequence

1. **P0 — Uncommitted-work guard.** Hook + bootstrap seed (6.3, first bullet).
   Cheapest fix for the §2 failures; ship standalone.
2. **P0 — Energize bootstrap Phase 5.** Distribution backbone (6.2).
3. **P1 — Spec/plan review trigger hook** + surface-parity wiring (6.3 second
   bullet, 6.4).
4. **P1 — Promote edge.** Review skills emit structured proposals (6.5, first
   bullet).
5. **P1 — Digest routine.** Scheduled proposal → canonical-PR loop (6.5,
   second bullet).
6. **P2 — Versioned spine + conformance test** (6.1) and redistribution signal
   (6.5, third bullet).

## 8. Non-Goals

- No new canonical rulebook; `AGENTS.md` + kernel stay the single source.
- No per-surface forks of the rules.
- No blocking gate on the interactive Claude/Codex surfaces — they get
  triggers and warnings, not hard stops (Build Studio keeps its gates).
- No automatic, unreviewed edits to `AGENTS.md` or principles — the digest
  proposes PRs; humans approve.
- No replacement of the founder-kernel review board for principle changes.

## 9. Acceptance Criteria

- A fresh install of any surface provably receives the plugin, token, and
  seeded principles (Phase 5 smoke probe passes).
- An attempt to abandon uncommitted work under a durable-artifact path
  produces a visible warning before the work can be lost.
- Writing a spec/plan file on the Claude or Codex surface surfaces the
  substrate-verify + architecture-review prompt automatically.
- A `[reference-doc]` finding from an architecture review appears as an
  `ImprovementProposal` row without manual filing.
- The scheduled digest opens at least one canonical-source update PR from
  accumulated proposals, routed for human approval.
- The conformance test fails if any surface pointer, enforcement hook, or
  skill-set drifts from the canonical set, and installs can detect they are
  behind the current `PROCESS_SPINE_VERSION`.

## 10. Open Questions / Escalatable Decisions

- **Guard severity (warn vs block).** Should the uncommitted-work guard warn
  or hard-block on the interactive surfaces? Leaning warn (consistent with
  non-blocking interactive posture), but this is a genuine trade-off for
  `dpf-decision-via-kernel`.
- **Digest cadence and autonomy.** How often does the promote-digest run, and
  does it open PRs autonomously or require a human to trigger the batch?
- **Spine version storage.** Where does an install record its provisioned
  spine version — install state file, a `Principal`-linked record, or env? A
  schema-audit is required before adding any new field.
- **Durable-artifact path set.** Which paths count as "durable artifacts" for
  the uncommitted-work guard beyond specs/plans (migrations, ADRs, kernel
  pages)?

## 11. Architecture Review (Advisory — Self-Dogfood)

Per the recursion this spec describes, it was run through the
`dpf-architecture-review` lens before finalizing.

- **Alignment summary:** aligned. The spec extends existing substrate
  (bootstrap, hooks, reviewers, refinement tools) rather than creating a
  parallel engine, and keeps `AGENTS.md`/kernel as the single source.
- **Findings folded in:**
  - `[important]` Initial draft implied a new "process engine" module →
    rewritten as wiring between existing substrates (§3 verdict, §5.1).
  - `[important]` Spine-version storage risked a new ad-hoc field → flagged as
    an open question requiring schema-audit (§10), not asserted.
  - `[minor]` Conformance check duplicated the mirror-field test → specified as
    an *extension* of BI-98683E68, not a new test harness (§6.1).
- **Escalated decision:** guard severity (warn vs block) handed to §10 rather
  than decided here.
- **Recommended next step:** file the epic + P0–P2 backlog items, promote to
  Build Studio, start with the P0 uncommitted-work guard.

## 12. Addendum — Enforcement edge landed (2026-06-18)

This spec sat as an orphaned `draft` from 2026-05-30: it diagnosed the gap and
recommended "file the epic + P0–P2 BIs, start with the guard," and then nothing
closed the loop — `search_specs_and_plans` returned **0 matches** for it and no
process-spine epic existed. That is itself the §2 failure in miniature: a
durable design artifact authored by an external client, never turned into
tracked, enforced work. The 2026-06-18 session resolving the *"Claude/Codex skip
specs, plans, and docs"* goal closes the first enforcement edge and files the
epic the spec called for.

**The documentation dimension (extends §6.3/§6.4).** The §6.3 "spec/plan review
trigger" was a `PostToolUse` reminder. This addendum strengthens it into the
**Spec/Plan/Doc Gate** — the harness-level (§5.2) PR-chokepoint enforcement,
modeled exactly on the UX-Fit Gate (BI-65DEE968):

- **Hard PR gate** (`scripts/check-spec-plan-doc.mjs`, wired as the
  `Spec/Plan/Doc Gate` job in `.github/workflows/ci.yml`). A PR that adds a
  substantial implementation surface — a new source module/route/migration, or
  a large in-place rewrite (≥120 added source lines) — must ALSO touch a
  durable-knowledge artifact (a spec, plan, doc, `AGENTS.md`, a kernel
  principle, or a `SKILL.md`) **or** carry a `Process-Spine-Decision:`
  attestation trailer. Surface-agnostic by construction: it reads the evidence,
  never which surface produced it (§5.1, §5.3; AGENTS.md §17
  governance-approves-evidence-not-provenance). This is what lifts Claude/Codex
  to Build Studio's always-on posture for the spec/plan/doc artifact.
- **Soft interactive nudge** (`scripts/hooks/spec-plan-doc-precheck.mjs`,
  `PreToolUse` `Write`). Fires when a session creates a new source module and
  reminds it — before the PR gate — to write the plan and update the docs in the
  same PR. Non-blocking, fails open (per §8: no hard stop on the interactive
  surface; the hook is guidance, CI is the gate).

**Decision record.** Guard severity (the §10 open question) was scored with
`principle_decide` (callingPopulation `external_coding_agent`, governing profile
`platform`): recommendation **`pr-gate-plus-soft-hook`** — the UX-Fit posture of
a hard PR gate plus a soft interactive nudge, over hard-block-everywhere or
nudge-only. Confidence was `low` because the platform decision dimensions are
not yet seeded with eval data (the known input gap from the Perplexity-lessons
analysis), but the recommendation matches the operator-ratified UX-Fit
precedent for the identical failure mode.

**Still open (tracked under EP-PROCESS-SPINE).** The uncommitted-work guard
(§6.3 first bullet, P0), bootstrap Phase 5 energization (§6.2), the refinement
promote/digest loop (§6.5), and the versioned-spine conformance test (§6.1)
remain unbuilt and are filed as backlog items, not done here — this PR is the
one enforcement edge that directly closes the "skipped specs/plans/docs" goal.

## 13. Addendum (2026-07-09) — EP-5560770F completion slice

Landed on `feat/process-spine-finish`:

- **BI-C82D58A3** — `local-integration-ci.mjs` already runs `prisma generate` after merge (CI parity); test contract in `scripts/lib/local-integration-ci.test.mjs` asserts the step.
- **BI-38578194** — `uncommitted-work-guard.mjs` on plugin `SessionEnd`/`Stop`, `.claude/settings.json` `SessionEnd`/`Stop`, and `.githooks/post-checkout`; escape hatch `DPF_SKIP_UNCOMMITTED_WORK_GUARD=1`.
- **BI-8996BBBB** — Build Studio architecture review auto-files `[reference-doc]` findings via `promoteReferenceDocFindings`; weekly `ops/canonical-improvement-digest` Inngest cron batches process-category proposals into a doc chore BI.
- **BI-C98D003B** — `bootstrap-worktree-deps.mjs` passes `--config.minimumReleaseAge=0` on the explicit worktree bootstrap path; `update_agent_toolchain.py` writes LF via `write_bytes` (no Python 3.10 `newline=` kwarg).
- **BI-EF42607A** — `PROCESS_SPINE_VERSION` in `packages/dpf-skill-pack/process-spine-version.mjs`; `scripts/process-spine-conformance.test.mjs` + extended `plugin-hooks-wired.test.mjs`; worktree readiness records `processSpineVersion`.

## 14. Addendum (2026-07-19) — live backlog coverage for plan deliverables

BI-C24C83FA closes a second enforcement gap: the existing spine proved that a
plan existed, but did not prove that independently shippable future work in the
plan existed in PostgreSQL. An umbrella xlarge BI could therefore ship its first
slice while every successor remained a Markdown checkbox.

The selected architecture (kernel decision DI-150BA6EB980F) reuses
`BacklogItemActivity` as the auditable receipt instead of adding a parallel plan
registry. `record_plan_backlog_coverage` owns the invariant: a decomposed plan
maps every independent deliverable to a live new or existing BI, while an atomic
plan records why its phases are sequencing rather than independent work.
`check_plan_backlog_coverage` revalidates that receipt against live state.

Enforcement is deliberately earlier than PR CI. The versioned plugin ships a
cross-surface pre-source guard that revalidates changed delivery plans through
MCP and fails closed on missing coverage, unreachable MCP, or insufficient
scope. Build Studio emits the same receipt when it creates child BIs or accepts
an atomic override. `scripts/check-plan-backlog-coverage.mjs` is the repository
backstop for canonical plan evidence; it is not the primary creation boundary.
The plan records the receipt, BI mappings, and dependencies so a reviewer can
connect durable design intent to live backlog state without duplicating that
state in Markdown.
