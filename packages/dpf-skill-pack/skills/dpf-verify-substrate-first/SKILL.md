---
name: dpf-verify-substrate-first
description: "Use when tempted to propose a new DPF substrate concept — a table, type, enum value, capability, epic, MCP tool, or agent role."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Grep Glob mcp__dpf__search_code_graph mcp__dpf__list_epics mcp__dpf__list_backlog_items mcp__dpf__query_backlog Bash(git log *)

# DPF coworker fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["build-specialist", "platform-engineer", "external-coding-agent", "software-engineer"]
capability: null
taskType: research
triggerPattern: "new table|new type|new capability|new epic|new tool|new agent|new schema|propose .* new|we'll need|need to add"
userInvocable: true
agentInvocable: true
allowedTools: ["Grep", "Glob", "mcp__dpf__search_code_graph", "mcp__dpf__list_epics", "mcp__dpf__list_backlog_items", "mcp__dpf__query_backlog", "Bash"]
composesFrom: []
contextRequirements: []
riskBand: low

# Kernel principle enforcement
enforces:
  - kernel/principles/verify-substrate-before-proposing-new
  - kernel/principles/sweep-main-before-trusting-worktree-specs
  - kernel/principles/single-source-of-truth
---

# DPF Verify Substrate First

**Before proposing any new substrate concept — table, type, enum value, capability, epic, MCP tool, agent role — grep the live codebase, query the live backlog, and sweep `origin/main` for the noun.** DPF's architecture is denser than first reads suggest; the most common reflex of "we'll need a new X" is wrong because X already exists, or because X is in-flight on a sibling worktree that hasn't merged yet, or because the spec frontmatter saying "not implemented" is 3 days stale.

This skill carries forward the substrate-sweep discipline added by [PR #1104](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1104) into a DPF-pack skill (audit delta D1 from [BI-98BDFA75](../../../../docs/superpowers/audits/2026-05-24-superpowers-snapshot-drift.md)) so it survives the retirement of the manual superpowers snapshot.

## When to use

- About to propose a new Prisma model, type union, enum value, or schema concept.
- About to file a new Epic via `mcp__dpf__create_epic`.
- About to author a spec or backlog item naming a new substrate noun.
- Operator says "we should have an X for this" and X sounds like it might already exist.
- Worktree spec frontmatter says "research stub — not implemented" and you're about to act on that.

## When NOT to use

- Purely additive feature work that obviously composes from existing substrate (e.g. "add a new column to existing model" — the column is not a substrate concept, the model is).
- Operator has already verified the substrate is absent and is asking you to implement.
- The work is bug-fixing in an existing surface; no new substrate involved.

## Read first

| Source | Path | What to extract |
|---|---|---|
| Code graph | `mcp__dpf__search_code_graph({ query: "<noun>", limit: 10 })` | Curated subgraph of code matching the noun — fastest first sweep |
| Prisma schema | `packages/db/prisma/schema/*.prisma` (26 domain files — there is no monolithic `schema.prisma`) | Many candidate "new tables" turn out to be columns or relations on existing models |
| Type unions / enums | `apps/web/lib/`, `packages/db/src/` | Some "new states" are already values in existing string-union types (per AGENTS.md §3) |
| Live backlog | `mcp__dpf__list_epics`, `mcp__dpf__list_backlog_items`, `mcp__dpf__query_backlog` | Active epics + open BIs may already cover the work |
| Main-branch history | `git log origin/main --oneline -- <topic-path>` | Worktrees can be 100+ PRs behind; verify the spec's "not implemented" claim against `origin/main` |
| Specs and plans | `mcp__dpf__search_specs_and_plans`, or `docs/superpowers/specs/` and `docs/superpowers/plans/` directly | An approved design may already exist. The tool fails with `spec_plan_corpus_unavailable` on installs that ship no `docs/superpowers` tree (consumer and runtime-host images exclude it); that is not a no-match, so sweep a source checkout before concluding nothing exists |
| Canonical UI primitives | `apps/web/lib/canonical-primitives.ts`, `apps/web/components/ui/report-kit/README.md`; `read_codebase_manifest().canonicalPrimitives`; `analyze_reusability` surfaces matches | Reporting/data-display UI (status badges, tables, KPI cards, filters, charts) is a solved palette — compose `report-kit`, don't hand-roll (principle `compose-report-kit-for-reporting-ux`) |

## Enforces

- `kernel/principles/verify-substrate-before-proposing-new` — this skill IS that principle, operationalized.
- `kernel/principles/sweep-main-before-trusting-worktree-specs` — the "spec says not implemented" trap; main may have shipped the substrate.
- `kernel/principles/single-source-of-truth` — duplicate substrate is the SSoT violation the principle was created to prevent.

## Steps

1. **State the candidate noun.** Be precise: "new model `FeatureBuildArtifact`" or "new enum value `pending-review` on `BacklogItem.status`" — not "new artifact tracking."

2. **First sweep — Prisma schema, read from the merge target.** The schema is SPLIT across `packages/db/prisma/schema/*.prisma`; a grep against the old monolithic `packages/db/prisma/schema.prisma` matches nothing and exits 0, which is indistinguishable from a real absence.
   ```
   # confirm the path exists BEFORE trusting any null result (see "Null results" below)
   ls packages/db/prisma/schema/*.prisma

   # sweep the worktree
   grep -rn "model <NameOfThing>" packages/db/prisma/schema/
   grep -rn "<thing>" packages/db/prisma/schema/

   # sweep the MERGE TARGET — the worktree may be many PRs behind main
   git fetch origin main -q
   git grep -n "model <NameOfThing>" origin/main -- packages/db/prisma/schema/
   ```
   Prefer the `origin/main` sweep as authoritative: it answers "does this exist on the branch I will merge into", which is the question that matters. Check for: existing model with the same name; existing model with a column that would carry your concept; existing relation that already expresses the linkage.

3. **Second sweep — code graph (currently degraded; corroborate, never conclude).** Run `mcp__dpf__search_code_graph({ query: "<noun>", limit: 10 })`. A HIT is useful evidence. An EMPTY RESULT IS NOT EVIDENCE OF ABSENCE and must never be reported as one.
   Per BI-86EF5900 the platform code graph is indexed from a non-default branch with 0/5 structural relationship types populated and a `low` trust tier, so it returns an empty array for models that are demonstrably on `main`. Confirm its state with `mcp__dpf__get_code_graph_freshness` and read the `trust` vector: if `trust.tier` is `low` or `trust.action` is `qualify`, treat every empty result from this graph as NO EVIDENCE and rely on the grep sweep above.
   Restore this to the first sweep only once `get_code_graph_freshness` reports all five relationship types populated and `lastIndexedBranch` equal to the default branch.

4. **Third sweep — type unions and enums.**
   ```
   grep -rn "type <NameOfThing>\\|enum <NameOfThing>" packages/db/src/ apps/web/lib/
   ```
   Many candidate "new states" turn out to be values that should be added to an existing `EPIC_STATUSES` / `BacklogItem.status` / similar union (per AGENTS.md §3 strongly-typed string enums rule).

5. **Fourth sweep — live backlog.**
   ```
   mcp__dpf__list_epics({ status: "open", hasOpenItems: true })
   mcp__dpf__list_backlog_items({ /* relevant filters */ })
   mcp__dpf__query_backlog({ /* keyword */ })
   ```
   Active epics + open BIs covering the same noun mean the work is in-flight; coordinate, don't duplicate. Per `feedback_pr_overlap_check_before_pushing`, also sweep open PRs:
   ```
   gh pr list --state open --limit 50
   ```

6. **Fifth sweep — main-branch history.**
   ```
   git log origin/main --oneline -- <topic-path> --since="2 weeks ago"
   ```
   If the worktree's spec says "research stub — not implemented" but `origin/main` shows commits landing the substrate in the last few days, the spec is stale. Per `kernel/principles/sweep-main-before-trusting-worktree-specs`, trust main over the worktree.

7. **Decide.**
   - **Substrate exists** → propose an extension (new column on existing model, new value in existing enum, new BI under existing epic) instead of new substrate.
   - **Substrate exists but doesn't fit** → say so concretely; cite the file/line where the existing substrate falls short. This is the legitimate path to new substrate, and the cite is the record.
   - **Substrate truly absent + no in-flight work** → proceed with the new-X claim and reference this verification in the proposal body.

## Null results — a clean sweep is not the same as an absence

A grep that matches nothing exits 0 whether the thing is genuinely absent or the path you swept is wrong, moved, or deleted. A tool that returns an empty array exits successfully whether the substrate is absent or the index behind it is stale. **In both cases absence reads as evidence, which is the exact failure this skill exists to prevent.**

Before recording any "X does not exist" conclusion:

1. **Prove the path you swept exists.** `ls` the directory or file first. If it does not exist, your null result carries no information — fix the path and re-sweep.
2. **Prove the instrument is live.** For the code graph, call `mcp__dpf__get_code_graph_freshness` and read `trust.tier` / `trust.action`. A `low` tier or a `qualify` action means an empty result is NO EVIDENCE.
3. **Prove you swept the merge target.** A worktree can be 100+ PRs behind. `git grep ... origin/main` answers the question that actually matters.
4. **Say which sweep produced the null.** Report "not found on `origin/main` in `packages/db/prisma/schema/`" — never a bare "does not exist". The cite is what lets a reviewer catch a bad sweep.
5. **Prove your filter did not eat the hits.** If the sweep excluded anything — `grep -v`, `--exclude`, a suppression pattern chosen to cut noise — re-run it with NO exclusions and state the raw count. A filtered-to-zero result is indistinguishable from a real absence, and it reads as *more* rigorous than a plain grep because it cites a methodology.

Worked failure (BI-FA950F74): an agent grepped `packages/db/prisma/schema.prisma`, a path deleted by the schema split, got silence, and reported `PayRun` and `Payslip` as missing. Both were already on `main`. The sweep was clean; the conclusion was false.

Worked failure (BI-5798BBA3): a brief recorded "Nothing in the repo queries `/engines/_configure` — confirmed by grep across apps, packages, scripts, docs; every hit is `not_configured` or `user_configured`." The path was right and the grep matched 95 times. The exclusion added to cut those two tokens removed every true hit along with them. Six source files queried the endpoint, including a boot-and-interval reconcile that already did the work the brief went on to recommend building. One `grep -rc` with no exclusions would have caught it.

## Output template

```
**Substrate verification for `<noun>`.**

- Code graph sweep: <hits or "no match">
- Prisma schema sweep: <hits or "no match">
- Type/enum sweep: <hits or "no match">
- Live backlog sweep: <related epics/BIs or "no overlap">
- Open PR sweep: <related PRs or "no overlap">
- Main-branch sweep: <recent commits or "no recent activity">

**Verdict:** <substrate exists, extending | substrate exists but insufficient, citing <ref> | substrate truly absent, proceeding>

<If proceeding:> New substrate justified because <one-line gap statement>.
```

## Guardrails

- **Never skip step 5** (live backlog sweep). The single most common substrate-verification failure is "the model didn't exist but the epic for it did" — and you discover this after filing the duplicate BI.
- **Never skip step 6** in autonomous runs longer than a few hours. `feedback_continuous_overlap_check` is explicit: re-sweep before every push, not just session start.
- **Never use this skill as a replacement for substrate research.** It's the cheap negative test ("does X already exist?"). Affirmative architecture decisions still need design work.

## Worked example

Authoring [BI-90793048](../../../../docs/superpowers/drafts/2026-05-24-dpf-skill-pack-formalization-bi-bundle.md) (DPF skill pack formalization), the agent considered creating a new epic `EP-AGENT-RULEBOOK`. Verification sweep:

- Code graph: hits for `Skill` (model), `SkillDefinition`, `SkillAssignment`, `seed-skills.ts` — substrate exists.
- Prisma schema: `model SkillDefinition` and `model SkillAssignment` already exist (substrate for Surface B is fully in place).
- Type sweep: `SKILL_LIFECYCLE_STATES` enum exists for Hermes axis.
- Live backlog: **`EP-SKILL-001`** ("AI Coworker Skills Marketplace") and **`EP-REDUCTION-GEAR-ARCH`** (priority 2, 67 items, substrate-consolidation framing) both cover adjacent territory.
- Main-branch sweep: PR #1104 added the substrate-sweep hint; PR #1083 landed topology naming work — recent activity in the area.
- Open PR sweep: #1115 and #1114 unrelated.

**Verdict:** substrate exists in adjacent epics; new epic would violate `check-epic-overlap-before-creating`. Parent chosen: `EP-REDUCTION-GEAR-ARCH` (operator-ratified in §5 question 1 of the BI memo). Saved one redundant epic and surfaced the right parent — exactly the failure mode this skill prevents.

## See also

- Kernel principle: [`verify-substrate-before-proposing-new`](../../../../docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md)
- Kernel principle: [`sweep-main-before-trusting-worktree-specs`](../../../../docs/founder-kernel/wiki/principles/sweep-main-before-trusting-worktree-specs.md)
- Origin of the search_code_graph hint: [PR #1104](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1104)
- Audit that carried this forward: [docs/superpowers/audits/2026-05-24-superpowers-snapshot-drift.md](../../../../docs/superpowers/audits/2026-05-24-superpowers-snapshot-drift.md) delta D1
