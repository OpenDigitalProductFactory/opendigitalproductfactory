---
title: Build Studio Right-Sizing — Lifecycle as a Function of (Work Type, Size)
authoredAt: 2026-05-30
authoredBy: claude
status: draft
specKind: design
relatedSpecs:
  - docs/superpowers/specs/2026-05-29-fix-flow-through-build-studio-design.md
  - docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
  - docs/superpowers/specs/2026-04-16-build-studio-process-improvements.md
  - docs/superpowers/specs/2026-03-26-build-studio-it4it-value-stream-alignment-design.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md
  - docs/founder-kernel/wiki/principles/single-source-of-truth.md
  - docs/founder-kernel/wiki/principles/responsible-capacity-utilization.md
  - docs/professions/data-architect/wiki/strongly-typed-string-enums.md
externalReferences:
  - https://docs.github.com/en/issues/tracking-your-work-with-issues/configuring-issues/managing-issue-types-in-an-organization
  - https://support.atlassian.com/jira-cloud-administration/docs/configure-a-workflow-scheme/
  - https://linear.app/docs/cycles
  - https://docs.scrumalliance.org/Scrum-Foundations/Scrum-Guide.html
  - https://docs.microsoft.com/en-us/azure/devops/boards/work-items/guidance/agile-process
---

> **⚠️ SUPERSEDED (2026-07-12).** The `(work-type, size)` matrix landed and is authoritative in code
> (`apps/web/lib/explore/build-process-matrix.ts`), but the *defaults and axes* described here were
> reversed and extended by [`2026-06-23-quality-first-risk-aware-build-rightsizing-design.md`](2026-06-23-quality-first-risk-aware-build-rightsizing-design.md):
> this draft leans **cheap-by-default**; the quality-first spec makes **quality the default** and
> adds the **deliverable-sensitivity** and **golden-triangle** axes. Model-tier routing (once its own
> [`2026-06-22-build-studio-model-tier-routing-design.md`](2026-06-22-build-studio-model-tier-routing-design.md))
> is folded into `getModelTier` under the quality-first flag. Read this spec for the matrix *mechanism*
> only; for current defaults and axes, follow the quality-first spec and the code. Narrative map:
> [`2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md`](2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md) §11.

# Build Studio Right-Sizing — Lifecycle as a Function of (Work Type, Size)

| Field | Value |
| ----- | ----- |
| Status | Draft |
| Date | 2026-05-30 |
| Backlog item | To file on approval (`feat-gap`, build, effortSize=medium). |
| Epic recommendation | Extend the open Build Studio lifecycle epic. Do not file a new epic — this is a generalization of an existing pipeline branch, not a new substrate. |
| Related substrate | [`apps/web/lib/explore/feature-build-types.ts`](../../../apps/web/lib/explore/feature-build-types.ts); [`apps/web/lib/explore/backlog.ts`](../../../apps/web/lib/explore/backlog.ts); [`apps/web/lib/integrate/build-agent-prompts.ts`](../../../apps/web/lib/integrate/build-agent-prompts.ts); [`apps/web/lib/build/size-design-doc.ts`](../../../apps/web/lib/build/size-design-doc.ts); [`apps/web/lib/governed-backlog-tee-up.ts`](../../../apps/web/lib/governed-backlog-tee-up.ts); [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts); [`apps/web/lib/actions/build.ts`](../../../apps/web/lib/actions/build.ts) |
| Scope | A data-driven **process matrix** that maps `(work-type, work-size) → lifecycle policy` (visible phases, required gate evidence, prompt variant, review intensity). Generalizes today's binary `kind ∈ {feature, fix}` branching in `getBuildPhasePrompt` and `checkPhaseGate` so a one-line bug fix is not driven by the same playbook as a large new feature, a chore is lighter than either, and a doc-gap is lighter still. Sources the type and size from the originating `BacklogItem`. |
| Out of scope | Adding `tool` / `skill` process kinds (separate governance pipelines — EP-GOVERN-002 tool evaluation, skill authoring); replacing the design-time decomposition gate (this spec composes with it, does not supersede it); changing the IT4IT value-stream alignment (stage mapping is per-phase, unchanged); operator-facing UI for picking type/size (derived from BI, not chosen). |

---

## 1. Problem

Build Studio's lifecycle is **one playbook** that runs on every build. The fix-flow design ([2026-05-29](2026-05-29-fix-flow-through-build-studio-design.md)) carved out a `fix` branch, but the split is binary: every non-fix runs the full feature playbook regardless of how small the work is, and every fix runs the full fix playbook regardless of how large. The system has no notion that "a one-line copy change" and "a 3-week new capability" deserve different ceremony.

Today's pipeline applies the same:
- Ideate phase prompt (substantial — ~80 lines, expects design research + clarification questions).
- Design-doc-required `ideate→plan` gate (or its fix-flow analogue requiring a complete `fixContext`).
- Plan phase with `reviewBuildPlan` deliberation.
- Build phase with full sandbox cycle.
- Review phase with acceptance evaluation + UX verification.
- Ship phase with deployment window + contribution assessment.

This is correct for a medium/large feature. It is **disproportionate** for:

- A **small fix** — a one-line copy correction with a regression test does not need a "design document" (even framed as fix diagnosis), three deliberation rounds, or a UX verification dance.
- A **chore** — a refactor with zero behavior change does not need design research, a portfolio anchor, or an acceptance-criteria evaluation.
- A **doc-gap** — a typo or missing README section does not need a sandbox, a build agent, or UX verification.
- A **large feature** — already gets the existing design-time decomposition gate ([2026-05-24](2026-05-24-build-studio-design-time-decomposition-design.md)), but its "is this too big to plan as one build?" check fires *after* a full ideate cycle. A size-aware lifecycle could pre-trigger decomposition for `xlarge` work.

The cost is real:
- LLM tokens burnt on irrelevant ceremony (Responsible Capacity Utilization — kernel principle).
- Operator friction (the fix-flow dogfood session showed the binary split works, but small chores still feel heavy).
- Pipeline mis-signal — when every build passes through every gate, gate failures stop conveying useful information.

The infrastructure for size-awareness **already exists**:
- `BacklogItem.effortSize ∈ {small, medium, large, xlarge}` ([`backlog.ts:133`](../../../apps/web/lib/explore/backlog.ts)).
- `sizeDesignDoc()` ([`size-design-doc.ts`](../../../apps/web/lib/build/size-design-doc.ts)) — deterministic post-design recheck producing a `decompose-recommended | decompose-required` decision.
- `FeatureBuild.kind ∈ {feature, fix}` ([`feature-build-types.ts:28`](../../../apps/web/lib/explore/feature-build-types.ts)).
- The `getBuildPhasePrompt(phase, kind)` + `checkPhaseGate(..., {kind, ...})` selector pattern ([`build-agent-prompts.ts:560`](../../../apps/web/lib/integrate/build-agent-prompts.ts); [`feature-build-types.ts:755`](../../../apps/web/lib/explore/feature-build-types.ts)).

What is missing is the *function* that maps `(type, size) → lifecycle policy` and the data threading so prompts and gates consult it.

### 1.1 Relationship to adjacent specs

- **Fix-flow design** ([2026-05-29](2026-05-29-fix-flow-through-build-studio-design.md)) — landed the `kind` discriminator and the feature/fix branching this spec generalizes. The seed of the matrix.
- **Design-time decomposition** ([2026-05-24](2026-05-24-build-studio-design-time-decomposition-design.md)) — `sizeDesignDoc()` already exists for post-ideate size escalation. This spec adds *pre-ideate* size routing (from `BacklogItem.effortSize`) and composes with the post-design re-check.
- **Process improvements** ([2026-04-16](2026-04-16-build-studio-process-improvements.md)) — flagged "No right-sizing of interaction" as Problem 3 but proposed only a complexity-assessment step. This spec is the structural answer: the lifecycle itself adapts, not just one mid-pipeline step.
- **Parallel "unified BI work-type attribute" work** (`feat/unify-backlog-worktype` — branch reserved, no commits). When that lands and rationalizes `BacklogItem.source`/`type`/`workType` (today: `source ∈ {feature-gap, bug, tool-gap, skill-gap, doc-gap, user-request, automated-detection}` plus `type ∈ {portfolio, product}`), this spec's `deriveBuildProcessType(bi)` becomes a one-line read from the unified attribute. The matrix shape is unchanged.

## 2. Current Repo Truth

| Area | Verified current behavior | Design implication |
| ---- | ------------------------- | ------------------ |
| Work-kind discriminator | `FEATURE_BUILD_KIND_VALUES = ["feature", "fix"]` ([`feature-build-types.ts:28`](../../../apps/web/lib/explore/feature-build-types.ts)). `FeatureBuild.kind String @default("feature")` ([`schema.prisma:4413`](../../../packages/db/prisma/schema.prisma)). | Extend the closed enum with `chore` and `doc`. No migration — the column is plain TEXT, default still `"feature"`. |
| Backlog source | `BACKLOG_SOURCE_VALUES = ["feature-gap","bug","tool-gap","skill-gap","doc-gap","user-request","automated-detection"]` ([`backlog.ts:122`](../../../apps/web/lib/explore/backlog.ts)). | Map `source → kind` at promote: today `bug → fix`; extend to `doc-gap → doc`. `chore` has no source today — accept it as an explicit BI field (Phase 2) or via a body keyword (Phase 1, conservative). Other sources default to `feature`. |
| Effort size | `BACKLOG_EFFORT_SIZES = ["small","medium","large","xlarge"]` ([`backlog.ts:133`](../../../apps/web/lib/explore/backlog.ts)). `BacklogItem.effortSize String?` ([`schema.prisma:965`](../../../packages/db/prisma/schema.prisma)). The eligibility gate excludes `xlarge` ([`governed-backlog-tee-up.ts:8`](../../../apps/web/lib/governed-backlog-tee-up.ts)). | Promote already reads `effortSize`. Carry it into `FeatureBuild.plan.processSize` (no migration). Default to `medium` when null. `xlarge` is intentionally not eligible for direct build promotion today — the matrix preserves that, then routes it to the existing design-time decomposition path. |
| Prompt selector | `getBuildPhasePrompt(phase, kind = "feature") → loadPrompt("build-phase", phase or phase-fix, hardcoded)` ([`build-agent-prompts.ts:560-577`](../../../apps/web/lib/integrate/build-agent-prompts.ts)). DB-overridable via `PromptTemplate` (category `build-phase`, slug per variant). | Extend the selector to consult a `LifecyclePolicy` derived from `(kind, size)`. The slug becomes `<phase>` for feature/standard, `<phase>-fix` for fix, `<phase>-chore` for chore, `<phase>-doc` for doc; size feeds *intensity* hints in the prompt body but does not split into yet more slugs (combinatorial explosion is worse than parameterization). |
| Gate | `checkPhaseGate(from, to, evidence)` ([`feature-build-types.ts:755`](../../../apps/web/lib/explore/feature-build-types.ts)) branches on `evidence.kind === "fix"` for the `ideate→plan` and `review→ship` transitions. Other transitions are kind-blind. | Replace the binary `isFix` switch with a *policy lookup*: `policy = getProcessPolicy(kind, size)`. Each transition consults `policy.gates[transition]` for the required evidence. The default policy is byte-identical to today's `feature/medium` flow. |
| Promote | `governed-backlog-tee-up.ts:217` derives `kind = item.source === "bug" ? "fix" : "feature"` and writes it to `FeatureBuild.kind`. `item.effortSize` is the eligibility filter; it is **not** carried onto the build today. | Generalize the kind derivation to `deriveBuildProcessType(item)` and additionally write `plan.processSize = item.effortSize ?? "medium"`. Both writes inside the existing `prisma.$transaction`. |
| Build context | `BuildContext.kind` is threaded through `getBuildContextSection` ([`build-agent-prompts.ts:691,844`](../../../apps/web/lib/integrate/build-agent-prompts.ts)); `BuildContext` has no `size` field. | Add `BuildContext.size?: BuildProcessSize` and read it from `build.plan.processSize` at all call sites. |
| Post-design size re-check | `sizeDesignDoc()` ([`size-design-doc.ts`](../../../apps/web/lib/build/size-design-doc.ts)) returns `decompose-recommended | decompose-required` from a deterministic count over the approved `BuildDesignDoc`. Already runs at `reviewDesignDoc` time. | Compose with `processSize`: if BI said `large` and the design re-check says `decompose-required`, the operator-facing reason should explain both signals. If BI said `small` and the design re-check tries to escalate, that is a useful divergence signal — record it; do not silently override. |

## 3. Research & Benchmarking

How established systems vary process by work type and work size. The pattern matters; vendor specifics are illustrative.

| System | Model (verified from product docs) | Adopt | Reject |
| ------ | ---------------------------------- | ----- | ------ |
| **GitHub Issue Types + Workflow Forms** | Org-level issue **types** (Bug, Feature, Task) are a first-class field; per-type issue **forms** collect structured fields and per-type **action workflows** can run different automations. Sources: [GitHub issue types](https://docs.github.com/en/issues/tracking-your-work-with-issues/configuring-issues/managing-issue-types-in-an-organization). | Type drives different forms / automation; the closed type enum is small. | Do not let type proliferate into Bug/Defect/Regression/Hotfix/etc. — keep four values now. |
| **Jira Workflow Schemes** | Different issue **types** can be bound to different **workflows** (with different transitions, fields, validators, conditions, post-functions); workflow schemes are administered per project and not chosen per ticket. Sources: [Jira workflow schemes](https://support.atlassian.com/jira-cloud-administration/docs/configure-a-workflow-scheme/). | Drive **per-type pipelines** in the same Build Studio engine, configured (not coded) per type. The "workflow scheme" idea maps cleanly to a `LifecyclePolicy` table. | Do not expose policy configuration to the non-technical operator; derive it from BI fields. Do not let policy diverge per *project*, only per `(type, size)`. |
| **Linear Cycles + Estimates** | Issues carry an **estimate** (small/medium/large or numeric), and cycles right-size the work-in-progress; "small" tasks can ship without a design pass, larger tasks get more review. Sources: [Linear cycles](https://linear.app/docs/cycles). | Treat size as a first-class lifecycle driver, not a tag — match Linear's idea that estimate informs how much ceremony is appropriate. | Do not require numeric estimates; the existing `small | medium | large | xlarge` ordinal is enough and matches what BIs already carry. |
| **Scrum / "Definition of Done" per type** | Scrum guides (and most agile playbooks) define DoD per work type — a spike has a different DoD than a story, which has a different DoD than a bug. The DoD is the *gate*, not a label. Sources: [Scrum Guide](https://docs.scrumalliance.org/Scrum-Foundations/Scrum-Guide.html). | Gate evidence per `(type, size)` — the matrix is essentially "Definition of Done per work cell". | Do not write 24 prose definitions; encode the gate requirements as a closed `GateRequirement` enum the matrix can compose. |
| **Azure DevOps / Microsoft Agile Process** | Different work item types (User Story, Bug, Task, Epic) have different state machines and different mandatory fields, all derived from the chosen Process template. Sources: [Azure DevOps Agile process](https://docs.microsoft.com/en-us/azure/devops/boards/work-items/guidance/agile-process). | A small closed set of process templates + a "process scheme" per type is industry-standard; nothing exotic here. | Do not export an editable XML process template to operators (Azure's complexity tax). Keep the matrix as TypeScript data the platform owns. |
| **GitHub Actions reusable workflows** | A single workflow definition is parameterized and called with inputs; routing is configuration, not code duplication. Sources: [Reusable workflows](https://docs.github.com/en/actions/sharing-automations/reusing-workflows). | Implement the matrix as **one** orchestration engine consuming a parameterized policy, not N forked pipelines. The fix-flow split already showed branches sprawl quickly. | Do not fork the orchestrator per type. |

**Patterns adopted:**
- Closed work-type enum, platform-derived from BI (not operator-chosen).
- Size as an ordinal first-class lifecycle driver, not a tag.
- "Definition of Done per type" expressed as a closed `GateRequirement` enum that the matrix composes.
- One orchestration engine, parameterized by a `LifecyclePolicy`, configured per `(type, size)`.

**Anti-patterns rejected:**
- Free-text type/size with operator-facing config.
- Per-type pipeline forks ("we'll just copy the feature path and prune it").
- Combinatorial prompt-slug explosion (`<phase>-<type>-<size>` is 4×5×4 = 80 slugs; use 4 slugs and parameterize by size in the body).
- Coupling the matrix to project / portfolio (universal across DPF).

**Gaps the design fills:**
- DPF has no per-type *workflow schemes* — the fix-flow PR added the second; this spec turns the binary branch into a closed matrix that other types plug into without orchestrator forks.
- DPF has size data on BIs but does not propagate it into the build's prompts/gates. This spec closes that loop.

## 4. Design

### 4.1 Process type and size enums

In [`apps/web/lib/explore/feature-build-types.ts`](../../../apps/web/lib/explore/feature-build-types.ts):

```ts
// Extends FEATURE_BUILD_KIND_VALUES. Each value names a process flavor that
// the matrix knows how to drive. Adding a value requires updating the matrix
// (§4.3) and any MCP mirror in the same commit, before any data uses it.
export const BUILD_PROCESS_TYPE_VALUES = ["feature", "fix", "chore", "doc"] as const;
export type BuildProcessType = (typeof BUILD_PROCESS_TYPE_VALUES)[number];

// Mirrors BACKLOG_EFFORT_SIZES so the build inherits the BI's sizing
// without re-classification. The matrix may collapse adjacent sizes
// (e.g. small+medium share a policy) — that's an internal detail of the
// LifecyclePolicy table, not a separate enum.
export const BUILD_PROCESS_SIZES = ["small", "medium", "large", "xlarge"] as const;
export type BuildProcessSize = (typeof BUILD_PROCESS_SIZES)[number];
```

`FEATURE_BUILD_KIND_VALUES` becomes an **alias** of the first slice of `BUILD_PROCESS_TYPE_VALUES` for back-compat:

```ts
// Retained for back-compat; new code should import BUILD_PROCESS_TYPE_VALUES.
// Kept as an alias rather than removed so existing imports (mcp-tools.ts,
// schema-mirror tests) keep compiling without a wide rename pass.
export const FEATURE_BUILD_KIND_VALUES = BUILD_PROCESS_TYPE_VALUES;
export type FeatureBuildKind = BuildProcessType;
```

`FeatureBuild.kind`'s DB column already stores a TEXT; no migration. Existing rows are `"feature"`. New `chore`/`doc` values are valid the moment the enum extension lands.

### 4.2 Gate requirement primitive

Replace the inline branchy gate logic with a closed `GateRequirement` enum the policy composes:

```ts
export const GATE_REQUIREMENTS = [
  // Evidence shapes
  "designDoc-present",
  "designReview-passed",
  "fixContext-complete",
  "buildPlan-present",
  "planReview-passed",
  "verification-typecheck-passed",
  "acceptance-all-met",
  "uxVerification-passed-or-skipped",
  // Intake/portfolio anchors
  "happyPathIntake-ready",
  "happyPathIntake-ready-or-skipped",
] as const;
export type GateRequirement = (typeof GATE_REQUIREMENTS)[number];
```

`checkPhaseGate` (§4.4) walks the policy's required list for the transition and short-circuits at the first miss. Each requirement is implemented by a pure function over the existing `evidence` shape — no new evidence types. **Today's branchy gate is the union of these requirements composed correctly; no behavior change for the default policy.**

### 4.3 The matrix — `LifecyclePolicy` per `(type, size)`

```ts
export type BuildTransition =
  | "ideate->plan"
  | "plan->build"
  | "build->review"
  | "review->ship";

export type LifecyclePolicy = {
  /** Visible phases in operator UI + agent dispatch. Always a contiguous
   *  prefix-of-the-canonical-order (you cannot have "build" without "plan")
   *  but trailing phases can be skipped via merge (chore-small merges
   *  "ideate" into "plan"). */
  phases: BuildPhase[];
  /** Prompt slug suffix. Selected by getBuildPhasePrompt; if a custom slug
   *  isn't present in DB / hardcoded, the loader falls back to the next
   *  generalization (e.g. chore -> feature). */
  promptVariant: "feature" | "fix" | "chore" | "doc";
  /** Suggested intensity for review deliberation (review/debate
   *  pattern selection). Read by the deliberation framework; advisory. */
  reviewIntensity: "minimal" | "standard" | "thorough";
  /** What each transition requires. Missing transitions are allowed by
   *  default (transitions outside the policy's phase set never fire). */
  gates: Partial<Record<BuildTransition, ReadonlyArray<GateRequirement>>>;
};
```

The **default matrix** (Phase 1 implementation):

| type \ size | small | medium | large | xlarge |
| ----------- | ----- | ------ | ----- | ------ |
| **feature** | full lifecycle, *standard* review, all gates (today's behavior). Promote eligibility unchanged. | full lifecycle, *standard* review, all gates. **Default policy** — byte-identical to today. | full lifecycle, *thorough* review, all gates + design-time-decomposition warning surfaced. | full lifecycle, *thorough* review, **promote-eligible only after decomposition** — preserves today's `governed-backlog-tee-up.ts:8` exclusion of `xlarge` from auto-tee-up; design-time decomposition (`sizeDesignDoc`) is the explicit gate. |
| **fix**     | merged ideate+plan, regression-test gate, no portfolio intake, no UX verification (smoke check only — "the defect no longer reproduces"). | full fix lifecycle (today's fix flow). | full fix lifecycle + decomposition warning if `sizeDesignDoc` trips. | route to decomposition: large fixes are almost always misclassified large features. Operator confirmation required to proceed monolithically. |
| **chore**   | plan→build→ship, no ideate, no design doc, no UX verification, no acceptance evaluation. *Minimal* review (typecheck + tests only). | plan→build→review→ship, design doc replaced by a one-line "what + why", *minimal* review. | full lifecycle, *standard* review (chores at this size usually hide a refactor that needs design). | route to decomposition. |
| **doc**     | author→review→ship (single Plan+Build merged phase that edits content files; no sandbox boot, no UX verification). *Minimal* review (link check + typecheck of any embedded code). | author→review→ship, *minimal* review. | author→review→ship, *standard* review (large docs cross-reference platform contracts). | route to decomposition. |

**Why these cells.** The choices encode a small set of principles, not 16 independent decisions:

1. **Default cell is unchanged.** `(feature, medium)` is the existing path, byte-identical. No risk of regression for the dominant case.
2. **Small fixes merge ideate into plan.** The fix-flow dogfood session showed that a one-line fix's "diagnosis" and "plan" are the same act. The matrix encodes that.
3. **Chores skip ideate.** A chore is *intent-driven*, not problem-driven — there is nothing to ideate. The plan + verification is the whole story.
4. **Docs don't need a sandbox.** A doc-gap fix is a content edit; sandbox + UX verification are pure overhead.
5. **xlarge always routes to decomposition.** Today's `governed-backlog-tee-up.ts` already excludes `xlarge` from promote eligibility. The matrix surfaces the *why* — it's not a special case, it's the matrix's xlarge column policy.
6. **`sizeDesignDoc` composes, not duplicates.** The post-ideate re-check still runs and can escalate any cell to "decompose-recommended/required" if the design grew beyond its BI size. The pre-promote BI size is the *intent*; the design-time re-check is the *truth*.

### 4.4 Selector + gate generalization

```ts
// apps/web/lib/explore/build-process-matrix.ts (NEW)

export function getProcessPolicy(
  type: BuildProcessType,
  size: BuildProcessSize,
): LifecyclePolicy { /* table lookup */ }

// Derivation from BI. Single source of truth so the parallel
// "unified BI work-type attribute" work changes one function, not 12 sites.
export function deriveBuildProcessType(bi: { source: string | null; body?: string | null }): BuildProcessType {
  if (bi.source === "bug") return "fix";
  if (bi.source === "doc-gap") return "doc";
  // Phase 1 conservative: detect "chore" via a body-line marker that
  // BI-filing skills can write (see §4.7). Phase 2 promotes this to a
  // dedicated BacklogItem.workType field via the parallel unify work.
  if (/^chore:/im.test(bi.body ?? "")) return "chore";
  return "feature";
}

export function deriveBuildProcessSize(bi: { effortSize: string | null }): BuildProcessSize {
  const s = bi.effortSize as BuildProcessSize | null;
  return s && (BUILD_PROCESS_SIZES as readonly string[]).includes(s) ? s : "medium";
}
```

`getBuildPhasePrompt` generalizes:

```ts
export async function getBuildPhasePrompt(
  phase: BuildPhase,
  type: BuildProcessType = "feature",
  size: BuildProcessSize = "medium",
): Promise<string> {
  const policy = getProcessPolicy(type, size);
  // Try DB override at <phase>-<variant>, then <phase>-<variant> hardcoded,
  // then fall back to <phase> hardcoded (feature). Preserves terminal-phase
  // empty-prompt behavior (return "" for phases outside policy.phases).
  if (!policy.phases.includes(phase)) return "";
  const variant = policy.promptVariant;
  const slug = variant === "feature" ? phase : `${phase}-${variant}`;
  const fallback = PHASE_PROMPTS_BY_VARIANT[variant]?.[phase] ?? PHASE_PROMPTS[phase] ?? "";
  return loadPrompt("build-phase", slug, fallback);
}
```

`checkPhaseGate` generalizes:

```ts
export function checkPhaseGate(
  from: BuildPhase,
  to: BuildPhase,
  evidence: Record<string, unknown>,
): PhaseGateResult {
  // Failed transitions and review->build cycles bypass policy.
  if (to === "failed") return { allowed: true };
  if (from === "review" && to === "build") return { allowed: true };

  const type = (evidence.kind as BuildProcessType | undefined) ?? "feature";
  const size = (evidence.processSize as BuildProcessSize | undefined) ?? "medium";
  const policy = getProcessPolicy(type, size);

  const transition = `${from}->${to}` as BuildTransition;
  const required = policy.gates[transition] ?? [];

  for (const req of required) {
    const result = checkRequirement(req, evidence);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}
```

`checkRequirement` is a pure function that for each `GateRequirement` returns `{allowed, reason?}`. The implementation is a direct translation of today's gate body — each branch becomes a named requirement function. **No behavior change for the default `(feature, medium)` policy.**

### 4.5 Promote — write type + size onto the build

In [`governed-backlog-tee-up.ts`](../../../apps/web/lib/governed-backlog-tee-up.ts), inside the existing `prisma.$transaction`:

1. Replace `const kind = item.source === "bug" ? "fix" : "feature"` with `const kind = deriveBuildProcessType(item)`.
2. Compute `const processSize = deriveBuildProcessSize(item)`.
3. Pass `processSize` into `mergeHappyPathStateIntoPlan` so `plan.processSize = processSize`.
4. Continue writing `kind` to `FeatureBuild.kind` (unchanged column).

Eligibility (`isEligibleCandidate`) keeps excluding `xlarge`. The matrix's xlarge cells are reached when an operator manually promotes (admin override) or when post-ideate decomposition produces children that are themselves not `xlarge`.

### 4.6 Threading `processSize` through `BuildContext`

`BuildContext` gains `size?: BuildProcessSize`. The single line in `getBuildContextSection` becomes:

```ts
lines.push(await getBuildPhasePrompt(ctx.phase, ctx.kind ?? "feature", ctx.size ?? "medium"));
```

`build-pipeline.ts` and `actions/agent-coworker.ts` each read `processSize` from `build.plan.processSize` (with `"medium"` default) and pass it through. `actions/build.ts` `checkPhaseGate` call adds `processSize` to the evidence record.

### 4.7 Filing chores — Phase 1 conservative path

Until the parallel "unified BI work-type" work lands and gives chores a first-class source value, `deriveBuildProcessType` recognizes a `^chore:` line in the BI body. The `dpf-file-backlog-item` skill is updated to emit that marker when the operator says the BI is a chore. This is conservative — it does not pollute the source enum, it does not require a migration, and it converts cleanly to a real `BacklogItem.workType="chore"` read in Phase 2.

### 4.8 Surfacing the policy to the operator

A small "Process: feature · medium · standard review" chip on the Build Studio header (read-only, derived) so the operator can see *which* lifecycle is running. Click expands to the policy detail (phases, gates, prompt variant). No write affordance — the policy is derived.

### 4.9 What is unchanged

- `PHASE_ORDER`, `PHASE_LABELS`, `PHASE_COLOURS`, `VISIBLE_PHASES`, `canTransitionPhase` — phase identity is global; the matrix selects a *subset* of phases per policy, it does not invent new ones.
- IT4IT mapping (`BUILD_PHASE_IT4IT`) — still keyed on phase, unchanged.
- `sizeDesignDoc()` — still runs at design-review time and can escalate the decision regardless of BI-declared size.
- The deliberation framework — `reviewIntensity` is advisory; the framework's existing pattern selection stays in charge.

## 5. Implementation Phasing

| Phase | Scope | Standalone? |
| ----- | ----- | ----------- |
| **1** (this spec, this PR) | `BUILD_PROCESS_TYPE_VALUES` + `BUILD_PROCESS_SIZES` enums; `getProcessPolicy(type, size)` matrix; `GateRequirement` enum + `checkRequirement` decomposition; generalized `getBuildPhasePrompt(phase, type, size)`; generalized `checkPhaseGate`; promote writes `plan.processSize` + uses `deriveBuildProcessType`; minimal chore + doc prompt variants (one paragraph each, can land thin); BuildContext threading; tests across the matrix; **default `(feature, medium)` cell byte-identical to today**. | Yes. Closes the basic right-sizing loop end-to-end. |
| **2** (deferred) | `tool` and `skill` process types (separate governance pipelines — out of scope of this spec); `BacklogItem.workType` first-class column when the unify branch lands → drop the `^chore:` body sniff; `FeatureBuild.processSize` first-class column (migration) — Phase 1 carries it in `plan.processSize`; richer chore + doc prompt content (Phase 1 is intentionally thin); operator header chip with policy detail. | Hardening + extensibility. |
| **3** (deferred) | Per-archetype matrix overrides (a vertical can tune `reviewIntensity` for its own work). Composes with the existing reduction-gear architecture. | Polishing. |

## 6. Verification Gates

Implementation (Phase 1) must meet the AGENTS.md §5 build gate:

| Layer | What to run / show |
| ----- | ------------------ |
| Unit tests | `pnpm --filter web exec vitest run` covering: `getProcessPolicy(type, size)` returns the expected `LifecyclePolicy` for every cell; `deriveBuildProcessType` + `deriveBuildProcessSize` derivation for representative BIs; **`(feature, medium)` policy yields the exact same gate decisions as today's `checkPhaseGate` over a battery of fixtures** (back-compat invariant); `chore-small` skips ideate; `doc-small` skips the sandbox-required transitions; `fix-small` merges ideate+plan; `xlarge` cells return a gate-blocked result pointing at decomposition; prompt selector returns a non-empty string for each `(type, phase)` in the policy's `phases` set, and an empty string for terminal phases. |
| Typecheck / build | `pnpm --filter web typecheck`; `cd apps/web && pnpm exec next build` with zero errors. |
| Migration | None required for Phase 1 (TEXT column already accepts new enum values; size lives in `plan` JSON). |
| UX | Against the Docker-served portal: promote a `bug`+`small` BI → confirm the build opens in the merged-fix-small lifecycle (no portfolio anchor demand at ideate, regression-test required at ship). Then promote a `feature-gap`+`medium` BI → confirm the build runs the existing feature path with no visible change. Use the `build-studio-operator` skill for the lifecycle gates. |

This spec's own quality gate (pre-implementation): `dpf-architecture-review` lens applied; live MCP duplicate-spec check done (`feat/unify-backlog-worktype` empty; fix-flow design landed; design-time decomposition landed; process improvements spec from 2026-04-16 names but does not solve right-sizing); every code reference ground-truthed against the current tree.

## 7. Risks & Open Decisions

| Item | Resolution |
| ---- | ---------- |
| Back-compat for in-flight builds | `processSize` defaults to `"medium"`; `kind` defaults to `"feature"`; the `(feature, medium)` policy is byte-identical to today. Existing builds read as today's behavior with zero migration. **Low risk.** |
| Slug explosion in `PromptTemplate` | Slugs grow from `{phase, phase-fix}` to `{phase, phase-fix, phase-chore, phase-doc}` — 5 phases × 4 variants = 20 slugs max. Bounded. The size dimension parameterizes the prompt body via a hint block, not via new slugs. |
| `deriveBuildProcessType` body-sniff for chore | Phase 1 conservative: a `^chore:` line marker. Brittle but isolated to one function. Phase 2 replaces with `BacklogItem.workType`. |
| Coexistence with the parallel unify branch | `deriveBuildProcessType(bi)` is the single read site. When unify lands, that function changes one line. No call-site churn elsewhere. |
| Operator-perceived behavior change | Most operators will not notice — the default policy is unchanged. New cells only fire when a BI is explicitly a bug + small, a chore, or a doc-gap. The operator header chip (Phase 2) makes the active policy visible when curiosity arises. |
| Size from BI vs from re-check | The pre-promote BI size is the *intent*. `sizeDesignDoc()` is the *post-design truth* and can escalate, never silently. When they disagree, the disagreement itself is operator-visible (the existing `sizeAssessment` panel already shows trips). |
| Gate decomposition risk | The `GateRequirement` enum must encode *every* check today's `checkPhaseGate` performs, including the UX-status branches. A test fixture that asserts byte-identical gate decisions over a representative battery is the primary defense. |

## 8. Next Step After Sign-Off

On approval, file the implementation BI, then implement **Phase 1 directly in this repo** — the "Build Studio for ALL development" rule is intentionally overridden here because Build Studio is currently not running end-to-end (per the session memory record from 2026-05-29) — on a topic branch off `origin/main`, via a DCO-signed PR, meeting the full §5 build gate. Phase 2 and Phase 3 are filed as follow-up backlog and not started until Phase 1 has landed and accrued evidence.
