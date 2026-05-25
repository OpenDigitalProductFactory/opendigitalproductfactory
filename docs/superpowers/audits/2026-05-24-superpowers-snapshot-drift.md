# Superpowers snapshot drift audit — 2026-05-24

> **BI:** [BI-98BDFA75](docs/superpowers/drafts/2026-05-24-dpf-skill-pack-formalization-bi-bundle.md) (DPF skill pack formalization — child 1 of 7 under [BI-90793048](docs/superpowers/drafts/2026-05-24-dpf-skill-pack-formalization-bi-bundle.md)).
> **Purpose:** Identify every DPF-specific delta in the manually-imported `obra/superpowers` v5.0.5 snapshot at [docs/Reference/superpowers/](../../Reference/superpowers/) and [.claude/commands/](../../../.claude/commands/) so nothing is lost when those locations are retired (BI-446E169C).
> **Method:** Grep across both directories for DPF markers (`mcp__dpf__`, `docs/superpowers/`, `docs/founder-kernel/`, `EP-`, `BI-`, `packages/db`, `apps/web`, `dpf-`, `DPF`). All hits enumerated below; no other markers found.
> **Status:** Complete; report ready for operator sign-off per BI 3.1 acceptance criterion.

## 1. File inventory

| Location | File count | Upstream-derived | DPF-only |
|---|---|---|---|
| [docs/Reference/superpowers/skills/](../../Reference/superpowers/skills/) | 12 | 12 | 0 |
| [docs/Reference/superpowers/prompts/](../../Reference/superpowers/prompts/) | 5 | 5 | 0 |
| [docs/Reference/superpowers/README.md](../../Reference/superpowers/README.md) | 1 | 1 (with DPF additions) | 0 |
| [.claude/commands/](../../../.claude/commands/) | 19 | 17 (bytes-equivalent mirrors of the docs/Reference files above) | 2 |

Total upstream-derived files: 17 (each appearing once in `docs/Reference/superpowers/` and once mirrored in `.claude/commands/`). Total wholly-DPF files: 2.

## 2. DPF deltas in upstream-derived files

Five distinct deltas, enumerated in retirement-priority order (most important to carry forward first).

### Delta D1 — `mcp__dpf__search_code_graph` hint (4 files)

**What:** A one-line block inserted near the top of four superpowers skills/prompts pointing agents at the DPF MCP code-graph tool for substrate sweeps. Exact text:

> Before manual file reads for substrate sweeps, try `mcp__dpf__search_code_graph({ query: "<topic>", limit: 10 })` for a curated subgraph. Example: `mcp__dpf__search_code_graph({ query: "principle wiki frontmatter ingest", limit: 10 })`.

**Where:**
- [docs/Reference/superpowers/skills/writing-plans.md:13](../../Reference/superpowers/skills/writing-plans.md) (and mirror at [.claude/commands/writing-plans.md:13](../../../.claude/commands/writing-plans.md))
- [docs/Reference/superpowers/skills/executing-plans.md:11](../../Reference/superpowers/skills/executing-plans.md) (and mirror)
- [docs/Reference/superpowers/skills/subagent-driven-development.md:11](../../Reference/superpowers/skills/subagent-driven-development.md) (and mirror)
- [docs/Reference/superpowers/prompts/spec-document-reviewer.md:6](../../Reference/superpowers/prompts/spec-document-reviewer.md) (and mirror)

**Provenance:** Added by [PR #1104](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1104) (commit `515d3eec`, *"docs(agent): nudge code graph before substrate sweeps"*).

**Carry-forward destination:** `dpf-verify-substrate-first` skill (BI-AD86EE4E, child 2). The hint belongs in a DPF-pack skill body, not embedded in superpowers — once superpowers is plugin-installed fresh, any in-body injection is lost on update. A standalone DPF skill that gets composed in before substrate sweeps is the correct architectural home for this guidance. The new skill body should also strengthen the hint with the `principle_decide` and `wiki_query` callouts not present in the original.

### Delta D2 — `docs/superpowers/specs/` path convention (brainstorming.md)

**What:** Two references inside brainstorming.md instructing agents to save design docs to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.

**Where:**
- [docs/Reference/superpowers/skills/brainstorming.md:24](../../Reference/superpowers/skills/brainstorming.md) (Checklist step 6)
- [docs/Reference/superpowers/skills/brainstorming.md:46](../../Reference/superpowers/skills/brainstorming.md) (After-the-design step 1)
- Mirror at [.claude/commands/brainstorming.md](../../../.claude/commands/brainstorming.md) (lines 25, 49)

**Provenance:** Present in the original v5.0.5 snapshot; unclear whether DPF-specific path or upstream default. Visual inspection of upstream `obra/superpowers/skills/brainstorming.md` recommended during BI 3.6 cleanup to confirm.

**Carry-forward destination:** AGENTS.md §16 (BI-439BC89B) under "DPF spec/plan locations" block. AGENTS.md is the canonical place for project-specific file layout conventions; encoding it in a superpowers skill body was an accident of the manual import.

### Delta D3 — `docs/superpowers/plans/` path convention (writing-plans.md)

**What:** One reference inside writing-plans.md instructing agents to save plans to `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`.

**Where:**
- [docs/Reference/superpowers/skills/writing-plans.md:15](../../Reference/superpowers/skills/writing-plans.md)
- Mirror at [.claude/commands/writing-plans.md:15](../../../.claude/commands/writing-plans.md)

**Provenance:** Same as D2 — present in v5.0.5 snapshot, may be upstream default with no DPF customization. Confirm during BI 3.6.

**Carry-forward destination:** Same as D2 — AGENTS.md §16 (BI-439BC89B).

### Delta D4 — README block listing DPF-only command

**What:** A "Platform-Specific (1)" section in the snapshot README enumerating `/project:tool-evaluation` and its EP-GOVERN-002 linkage.

**Where:** [docs/Reference/superpowers/README.md:42–43](../../Reference/superpowers/README.md).

**Provenance:** Added when `tool-evaluation.md` was first created (predates current git horizon in this audit).

**Carry-forward destination:** AGENTS.md §16 (BI-439BC89B) under a new "DPF-only commands not in the plugin" block. The README itself is retired with the rest of `docs/Reference/superpowers/` (BI-446E169C), so the EP-GOVERN-002 reference needs a new permanent home.

### Delta D5 — None other

No other DPF markers found in upstream-derived files. The bodies of `code-quality-reviewer.md`, `dispatching-parallel-agents.md`, `finishing-a-development-branch.md`, `implementer.md`, `plan-document-reviewer.md`, `receiving-code-review.md`, `requesting-code-review.md`, `spec-reviewer.md`, `systematic-debugging.md`, `test-driven-development.md`, `verification-before-completion.md`, `writing-skills.md` are bytes-equivalent to upstream v5.0.5 and can be retired without loss once the auto-install replacement (BI-98683E68) is live.

## 3. Wholly-DPF files (not derived from superpowers)

### W1 — `.claude/commands/tool-evaluation.md`

**Source:** EP-GOVERN-002 Tool Evaluation Pipeline (per its frontmatter `source:` field).

**Scope:** Initiates the 6-agent tool evaluation pipeline for vetting external MCP servers, npm packages, and dependencies. Cited in [AGENTS.md §9](../../../AGENTS.md).

**Carry-forward decision:** Keep in `.claude/commands/` as-is for now (BI-446E169C explicitly preserves it). Optional follow-up — consider re-homing into the `dpf-platform` plugin as `dpf-tool-evaluation` SKILL.md in a separate BI once the plugin substrate is proven stable. The DPF-coworker surface already has equivalents under `skills/platform/` (e.g. `add-provider.skill.md`), so this is a Surface A-only command for now.

### W2 — `.claude/commands/build-studio-operator.md`

**Source:** DPF Build Studio pseudo-human operator workflow.

**Scope:** Defines the "I am the pseudo-human operator" role for BS lifecycle gate management — design doc review, plan review, PR check, portal verification.

**Carry-forward decision:** Same as W1 — keep in `.claude/commands/` as-is for now. Possibly re-home into the `dpf-platform` plugin as `dpf-build-studio-operator` SKILL.md after the plugin substrate is proven, but only if it's genuinely Claude-Code-specific. (The role itself is operator-shaped and might better live as a coworker skill — Build Studio's `coo` or `build-specialist` coworker is the natural home. Decide during the re-homing BI.)

## 4. Surface B coworker skill substrate — no audit needed

The 57 coworker skills under [skills/](../../../skills/) are NOT in scope for retirement by BI-446E169C. They remain under the existing `seed-skills.ts` loader path. They will be progressively migrated to the superset SKILL.md format under the plugin per the operator-ratified opportunistic migration approach (memo §5 question 4) — that work is tracked separately under EP-SKILL-001 follow-up, not under this BI bundle.

No DPF deltas in those files are at risk of loss by this bundle's cleanup.

## 5. Risk assessment

**Risk if BI-446E169C runs without these deltas carried forward:**

| Delta | Severity | Loss without carry-forward |
|---|---|---|
| D1 (search_code_graph hint) | High | Agents lose the substrate-sweep guidance added in PR #1104; reverts to manual file reads, increasing context burn and time per task. |
| D2 (spec path) | Medium | Agents save design docs to ad-hoc paths; spec discovery via `search_specs_and_plans` MCP tool degrades. |
| D3 (plan path) | Medium | Same as D2 for plans. |
| D4 (README EP-GOVERN-002 mention) | Low | A discoverability hint disappears; the tool-evaluation command still works because it's the file body, not the README, that defines it. |
| D5 (none) | n/a | n/a |
| W1/W2 (DPF-only commands) | None | Explicitly preserved by BI-446E169C scope. |

## 6. Operator sign-off

Per BI-98BDFA75 acceptance criterion: operator sign-off on this report before BI-AD86EE4E (author 7 skills) starts.

**Mark — to sign off, reply with "audit OK" or with specific changes. Once signed off, BI-AD86EE4E can start, and its first skill body (`dpf-verify-substrate-first`) must include the D1 hint per the carry-forward mapping above.**
