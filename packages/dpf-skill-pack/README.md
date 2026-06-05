# dpf-platform plugin / skill pack

DPF-native agent workflows shipped as one **plugin substrate** plus one **coworker seed source**:

1. **Contributor coding clients** — installed as the `dpf-platform` plugin for Claude Code (`.claude-plugin/marketplace.json`) and Codex (`.agents/plugins/marketplace.json` + `.codex-plugin/plugin.json`), invoked as `/dpf-<slug>` / `$dpf-<slug>` or auto-loaded by `description` match. The plugin is the installable unit; skills, MCP server descriptors, future hooks, and runtime assets belong inside it.
2. **In-portal coworkers** — seeded as `SkillDefinition` + `SkillAssignment` rows by an extended [packages/db/src/seed-skills.ts](../../packages/db/src/seed-skills.ts) loader per [BI-98683E68](../../docs/superpowers/drafts/2026-05-24-dpf-skill-pack-formalization-bi-bundle.md), invoked by `triggerPattern` match or directly by the assigned coworker.

The single-source-of-truth contract is the **superset SKILL.md frontmatter**: Agent Skills open-standard fields (`name`, `description`, `disable-model-invocation`, `user-invocable`, `allowed-tools`) consumed by Claude Code, plus DPF coworker fields (`category`, `assignTo`, `capability`, `taskType`, `triggerPattern`, `userInvocable`, `agentInvocable`, `allowedTools`, `composesFrom`, `contextRequirements`, `riskBand`, `enforces`) consumed by the seed loader. The mirror-field invariant — `user-invocable ↔ userInvocable`, `allowed-tools ↔ allowedTools`, `disable-model-invocation: false ↔ agentInvocable: true` — is asserted by a unit test (BI-98683E68) so divergence between the two field families fails CI.

**One documented asymmetry: `allowed-tools` ↔ `allowedTools` containment, not bytes-equivalence.** The Agent Skills standard supports fine-grained scoping like `Bash(git log *)` (Claude Code uses these as pre-approval rules). The DPF coworker `allowedTools` schema in [seed-skills.ts](../../packages/db/src/seed-skills.ts) accepts only bare tool names. The mirror invariant test therefore checks that every BASE tool name in `allowed-tools` (with the scope-suffix stripped) appears in `allowedTools` — the coworker side is the broader permission. Strict bytes-equivalence would force us to drop Claude Code's pre-approval feature, which is worth keeping; broader-on-Surface-B is the safe direction.

## 2026-05-26 client-plugin research

Official client docs now make plugins the stronger project/team packaging primitive:

- Claude Code plugins can bundle skills, agents, hooks, MCP servers, LSP servers, monitors, and persistent runtime data. Project `.claude/settings.json` can require a marketplace and enable default plugins for trusted repos; container images can pre-populate plugin caches with `CLAUDE_CODE_PLUGIN_SEED_DIR`.
- Codex plugins bundle skills, app integrations/connectors, MCP servers, hooks, and install-surface assets. Repo marketplaces live at `.agents/plugins/marketplace.json`; workspace sharing is available inside the Codex app; enterprise managed configuration can constrain security-sensitive settings, plugin sharing, and MCP server enablement.
- Skills remain the workflow authoring format. Plugins are the deployment and governance unit when the workflow must travel with MCP configuration, connectors, hooks, helper scripts, or curated install policy.

DPF therefore treats `dpf-platform` as the project-default plugin, not merely a skill folder. Generic upstream packs are useful raw material, but they are local/user-scope aids unless their behavior has been recast as DPF-governed skills in this package.

## Conflict-resolution policy

- **Surface A (Claude Code / Codex) — DPF wins over non-DPF skills** when both could apply. DPF skill `description` fields begin with a DPF-context selector to make the agent's load decision unambiguous. Generic upstream packs are optional local/user-scope aids, not the project default.
- **Surface B (coworker) — plugin wins over legacy `.skill.md`** when the same slug appears in both [skills/&lt;category&gt;/](../../skills/) and `packages/dpf-skill-pack/skills/<slug>/SKILL.md`. The loader emits a startup warning and writes a `SkillSeedWarning` row so the admin observatory lists pending migrations. No legacy file is deleted by the loader — migration is opportunistic per EP-SKILL-001 follow-up.

## Skills shipped in v0.1.0

| Slug | Composes with (Surface A) | Coworker `assignTo` (Surface B) | What it adds |
|---|---|---|---|
| [`dpf-decision-via-kernel`](skills/dpf-decision-via-kernel/SKILL.md) | dpf-brainstorming | `["*"]` | Maps options to `PRINCIPLE_DIMENSIONS`, invokes `principle_decide`, surfaces ledger, defers on commandment conflict |
| [`dpf-verify-substrate-first`](skills/dpf-verify-substrate-first/SKILL.md) | (no analog) | `["*"]` | Grep + live-backlog + main-branch sweep before naming new types/tables/epics |
| [`dpf-file-backlog-item`](skills/dpf-file-backlog-item/SKILL.md) | dpf-verify-substrate-first (`dpf-writing-plans` pending — slice 2) | `["build-specialist", "ops-coordinator", "platform-engineer"]` | Verify substrate → file BI → size → triage → link epic |
| [`dpf-promote-to-build-studio`](skills/dpf-promote-to-build-studio/SKILL.md) | (no analog) | `["build-specialist", "ops-coordinator"]` | BI → promote → approve Ideate → let BS run |
| [`dpf-worktree-per-session`](skills/dpf-worktree-per-session/SKILL.md) | dpf-finishing-a-development-branch (predecessor) | `["build-specialist", "platform-engineer"]` | `git worktree add` + MCP seed + `COMPOSE_PROJECT_NAME` + compile-ready/source-only verification discipline |
| [`dpf-pr-with-dco`](skills/dpf-pr-with-dco/SKILL.md) | dpf-finishing-a-development-branch (successor) | `["build-specialist", "platform-engineer"]` | Branch from `origin/main`, `-s` sign-off, overlap-sweep, PR-when-ready |
| [`dpf-evidence-before-diagnosis`](skills/dpf-evidence-before-diagnosis/SKILL.md) | dpf-systematic-debugging (predecessor) | `["*"]` | Query DB/status before claiming cause; dynamic-analysis output discipline |
| [`dpf-brainstorming`](skills/dpf-brainstorming/SKILL.md) | (DPF-native; predecessor to `dpf-decision-via-kernel`) | `["*"]` | Generate 2-4 substrate-grounded options before converging; replaces upstream `brainstorming` |
| [`dpf-systematic-debugging`](skills/dpf-systematic-debugging/SKILL.md) | dpf-evidence-before-diagnosis, dpf-verify-substrate-first | `["*"]` | 4-phase root cause, DPF-gated: evidence-first, peer-session check, substrate check, functional (not structural) verification; replaces upstream `systematic-debugging` |
| [`dpf-finishing-a-development-branch`](skills/dpf-finishing-a-development-branch/SKILL.md) | (DPF-native; successor `dpf-pr-with-dco`) | `["*"]` | Decide integration shape (one PR / stack / split), confirm green + signed, then hand off PR mechanics; replaces upstream `finishing-a-development-branch` |
| [`dpf-writing-plans`](skills/dpf-writing-plans/SKILL.md) | dpf-file-backlog-item (predecessor) | `["*"]` | Phased implementation plan for a filed BI, grounded in substrate, saved to `docs/superpowers/plans/`; replaces upstream `writing-plans` |
| [`dpf-tdd`](skills/dpf-tdd/SKILL.md) | (DPF-native) | `["*"]` | Test-first red-green-refactor, DPF-gated: failing test first for fixes, functional (not structural) green, never report an unrun pass; replaces upstream `test-driven-development` |
| [`dpf-retrieve-decision-context`](skills/dpf-retrieve-decision-context/SKILL.md) | dpf-verify-substrate-first | `["*"]` | Pull repo, specs, live backlog, and kernel context before WWMD scoring |
| [`dpf-compare-options`](skills/dpf-compare-options/SKILL.md) | dpf-retrieve-decision-context | `["*"]` | Score 2-4 options through `principle_decide` and return operator-safe recommendations |
| [`dpf-record-decision-outcome`](skills/dpf-record-decision-outcome/SKILL.md) | dpf-decision-via-kernel | `["*"]` | Persist decision result, evidence summary, and next action through governed MCP |
| [`dpf-capture-kernel-gap`](skills/dpf-capture-kernel-gap/SKILL.md) | dpf-decision-via-kernel | `["*"]` | Route low-confidence, evidence, principle, ownership, or volunteers-dilemma gaps to founder review |
| [`dpf-external-evidence-handoff`](skills/dpf-external-evidence-handoff/SKILL.md) | dpf-evidence-before-diagnosis | `["build-specialist", "platform-engineer"]` | Record Claude/Codex branch, files, tests, and unresolved questions for Build Studio |
| [`dpf-use-shared-nonprod-environment`](skills/dpf-use-shared-nonprod-environment/SKILL.md) | dpf-worktree-per-session | `["build-specialist", "platform-engineer", "ops-coordinator"]` | Claim and release governed shared localhost environments instead of unmanaged servers |
| [`dpf-local-merge-ci-before-push`](skills/dpf-local-merge-ci-before-push/SKILL.md) | dpf-pr-with-dco | `["build-specialist", "platform-engineer"]` | Run merged-code local integration gates and record results before push or PR |
| [`dpf-architecture-review`](skills/dpf-architecture-review/SKILL.md) | dpf-retrieve-decision-context, dpf-decision-via-kernel | `["ea-architect", "build-specialist", "platform-engineer"]` | Chief-architect lens: review a spec/design/plan for architectural alignment against DPF standards, propose concrete edits, feed new standards back to the reference docs. Advisory `architect` reviewer at the Build Studio Ideate + Plan gates |
| [`dpf-ux-fit-review`](skills/dpf-ux-fit-review/SKILL.md) | dpf-architecture-review, dpf-verify-substrate-first | `["ea-architect", "build-specialist", "platform-engineer"]` | UX/IA fit gate for UI-impacting feature plans: route family, persona, nav layer, component convergence, empty/failure states, coworker boundaries, and merge evidence |

### Upstream superpowers capabilities NOT re-authored (do not re-propose)

The pack owns DPF-native equivalents only for the superpowers capabilities it actually composed with. The rest are deliberately not re-authored — assessed under BI-E3638D04:

- **Already covered by DPF — don't duplicate:** `spec-reviewer` / `plan-document-reviewer` → `dpf-architecture-review`; `code-quality-reviewer` / `requesting-`/`receiving-code-review` → harness `/code-review`, `/review`, `/security-review`, `/simplify`; `subagent-driven-development` / `dispatching-parallel-agents` → `dpf-worktree-per-session` + Build Studio orchestrator-worker + the `Workflow` tool; `writing-skills` → `skill-creator` + this authoring contract.
- **Left as optional upstream install:** `implementer`, `executing-plans` (Build Studio's build-specialist + `dpf-promote-to-build-studio` cover the DPF path).
- **Folded, not authored:** `verification-before-completion` → `build-gate-mandatory` + `/verify` + `dpf-systematic-debugging` Phase 4 (kernel-ratified fold-in, not a standalone skill).

## Build Studio capability packs

Build Studio groups these skills through [`capability-packs.json`](capability-packs.json). Packs keep the human workflow simple while letting the platform select the right governed skills for architecture, design, implementation, verification, review/ship, and recovery phases.

## Authoring contract for new skills

When adding a skill to this pack:

1. Pick a slug starting with `dpf-` (Surface A namespace + reader discoverability).
2. Author `skills/<slug>/SKILL.md` with the superset frontmatter (see any existing skill for the field set). Mirror-field invariants are enforced.
3. Cite at least one kernel principle slug in the `enforces:` frontmatter list AND in an `## Enforces` body section. If no kernel principle covers the skill's discipline, that's a signal to author the principle first (kernel-PR workflow via the existing `draft-kernel-edit-pr` coworker skill).
4. Include at least one worked example using real DPF context (not toy data).
5. Body under 500 lines per the Claude Code skill best practice. If the procedure is bigger, factor sub-skills.
6. Run the mirror-field invariant test (BI-98683E68) before committing.

## Plugin manifests

The `.claude-plugin/plugin.json` manifest turns this directory into an installable Claude Code plugin. The `.codex-plugin/plugin.json` manifest exposes the same package to Codex. Both manifests point to the same `skills/` directory and to client-specific DPF MCP descriptors:

- `claude.mcp.json` — Claude Code MCP descriptor using `${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1}` and `${DPF_MCP_BEARER_TOKEN:-}`.
- `codex.mcp.json` — Codex MCP descriptor using local `http://127.0.0.1:3000/api/mcp/v1` plus `bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"`.

Repo-level marketplace files live at the repository root:

- `.claude-plugin/marketplace.json` — Claude Code project marketplace, enabled by `.claude/settings.json` as `dpf-platform@dpf-platform-local`.
- `.agents/plugins/marketplace.json` — Codex repo marketplace, marked `INSTALLED_BY_DEFAULT` for the same plugin directory.

The auto-install hook (BI-98683E68) wires these into portal install + worktree creation so contributors do not need to hand-run client plugin commands. MCP authentication still stays outside git: issue or rotate `DPF_MCP_BEARER_TOKEN` from Admin > Platform Development > MCP. The plugin supplies the client wiring; the portal owns the token.

### Version bumps propagate automatically

When this package's `.claude-plugin/plugin.json` version bumps (e.g. `0.1.0` → `0.2.0`), the `scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}` adapter reads the new version from the manifest at install time and the planning library at `packages/dpf-bootstrap/` plans an upgrade write for contributors whose installed entry is at the older version. No manual `claude plugin install` is required. Contributors pick up the new skills on the next time the installer (or `install-dpf`, `fresh-install`, `setup`, or a fresh `git worktree add`) runs — and a re-run when nothing has drifted is a true no-op.

Upstream-owned plugins (`superpowers@openai-curated`) follow a different rule: their pinned version lives in `packages/dpf-bootstrap/src/agent-toolchain/upstream-versions.ts` and drift is surfaced as an advisory line under the install banner. DPF does not auto-upgrade upstream plugins.

## See also

- Parent BI: [BI-90793048](../../docs/superpowers/drafts/2026-05-24-dpf-skill-pack-formalization-bi-bundle.md)
- AGENTS.md §16 dual-surface catalogue (BI-439BC89B)
- Reduction Gear Architecture: [docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md](../../docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md) (parent epic substrate framing)
- Claude Code plugin docs: [Create plugins](https://code.claude.com/docs/en/plugins), [Plugins reference](https://code.claude.com/docs/en/plugins-reference), [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- Codex plugin docs: [Plugins](https://developers.openai.com/codex/plugins), [Build plugins](https://developers.openai.com/codex/plugins/build), [Agent Skills](https://developers.openai.com/codex/skills)
