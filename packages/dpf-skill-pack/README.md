# dpf-platform skill pack

DPF-native agent skills shipped to **two surfaces** from one set of source files:

1. **Contributor coding clients** — installed as the `dpf-platform` plugin for Claude Code (`.claude-plugin/marketplace.json`) and Codex (`.agents/plugins/marketplace.json` + `.codex-plugin/plugin.json`), invoked as `/dpf-<slug>` / `$dpf-<slug>` or auto-loaded by `description` match. Auto-installed or made discoverable on portal install when the matching client home is present.
2. **In-portal coworkers** — seeded as `SkillDefinition` + `SkillAssignment` rows by an extended [packages/db/src/seed-skills.ts](../../packages/db/src/seed-skills.ts) loader per [BI-98683E68](../../docs/superpowers/drafts/2026-05-24-dpf-skill-pack-formalization-bi-bundle.md), invoked by `triggerPattern` match or directly by the assigned coworker.

The single-source-of-truth contract is the **superset SKILL.md frontmatter**: Agent Skills open-standard fields (`name`, `description`, `disable-model-invocation`, `user-invocable`, `allowed-tools`) consumed by Claude Code, plus DPF coworker fields (`category`, `assignTo`, `capability`, `taskType`, `triggerPattern`, `userInvocable`, `agentInvocable`, `allowedTools`, `composesFrom`, `contextRequirements`, `riskBand`, `enforces`) consumed by the seed loader. The mirror-field invariant — `user-invocable ↔ userInvocable`, `allowed-tools ↔ allowedTools`, `disable-model-invocation: false ↔ agentInvocable: true` — is asserted by a unit test (BI-98683E68) so divergence between the two field families fails CI.

**One documented asymmetry: `allowed-tools` ↔ `allowedTools` containment, not bytes-equivalence.** The Agent Skills standard supports fine-grained scoping like `Bash(git log *)` (Claude Code uses these as pre-approval rules). The DPF coworker `allowedTools` schema in [seed-skills.ts](../../packages/db/src/seed-skills.ts) accepts only bare tool names. The mirror invariant test therefore checks that every BASE tool name in `allowed-tools` (with the scope-suffix stripped) appears in `allowedTools` — the coworker side is the broader permission. Strict bytes-equivalence would force us to drop Claude Code's pre-approval feature, which is worth keeping; broader-on-Surface-B is the safe direction.

## Conflict-resolution policy

- **Surface A (Claude Code / Codex) — DPF wins over non-DPF skills** when both could apply. DPF skill `description` fields begin with a DPF-context selector to make the agent's load decision unambiguous. Generic upstream packs are optional local/user-scope aids, not the project default.
- **Surface B (coworker) — plugin wins over legacy `.skill.md`** when the same slug appears in both [skills/&lt;category&gt;/](../../skills/) and `packages/dpf-skill-pack/skills/<slug>/SKILL.md`. The loader emits a startup warning and writes a `SkillSeedWarning` row so the admin observatory lists pending migrations. No legacy file is deleted by the loader — migration is opportunistic per EP-SKILL-001 follow-up.

## Skills shipped in v0.1.0

| Slug | Composes with (Surface A) | Coworker `assignTo` (Surface B) | What it adds |
|---|---|---|---|
| [`dpf-decision-via-kernel`](skills/dpf-decision-via-kernel/SKILL.md) | superpowers:brainstorming | `["*"]` | Maps options to `PRINCIPLE_DIMENSIONS`, invokes `principle_decide`, surfaces ledger, defers on commandment conflict |
| [`dpf-verify-substrate-first`](skills/dpf-verify-substrate-first/SKILL.md) | (no analog) | `["*"]` | Grep + live-backlog + main-branch sweep before naming new types/tables/epics |
| [`dpf-file-backlog-item`](skills/dpf-file-backlog-item/SKILL.md) | superpowers:writing-plans (predecessor) | `["build-specialist", "ops-coordinator", "platform-engineer"]` | Verify substrate → file BI → size → triage → link epic |
| [`dpf-promote-to-build-studio`](skills/dpf-promote-to-build-studio/SKILL.md) | (no analog) | `["build-specialist", "ops-coordinator"]` | BI → promote → approve Ideate → let BS run |
| [`dpf-worktree-per-session`](skills/dpf-worktree-per-session/SKILL.md) | superpowers:finishing-a-development-branch (predecessor) | `["build-specialist", "platform-engineer"]` | `git worktree add` + MCP seed + `COMPOSE_PROJECT_NAME` discipline |
| [`dpf-pr-with-dco`](skills/dpf-pr-with-dco/SKILL.md) | superpowers:finishing-a-development-branch (successor) | `["build-specialist", "platform-engineer"]` | Branch from `origin/main`, `-s` sign-off, overlap-sweep, PR-when-ready |
| [`dpf-evidence-before-diagnosis`](skills/dpf-evidence-before-diagnosis/SKILL.md) | superpowers:systematic-debugging (predecessor) | `["*"]` | Query DB/status before claiming cause; dynamic-analysis output discipline |

## Authoring contract for new skills

When adding a skill to this pack:

1. Pick a slug starting with `dpf-` (Surface A namespace + reader discoverability).
2. Author `skills/<slug>/SKILL.md` with the superset frontmatter (see any existing skill for the field set). Mirror-field invariants are enforced.
3. Cite at least one kernel principle slug in the `enforces:` frontmatter list AND in an `## Enforces` body section. If no kernel principle covers the skill's discipline, that's a signal to author the principle first (kernel-PR workflow via the existing `draft-kernel-edit-pr` coworker skill).
4. Include at least one worked example using real DPF context (not toy data).
5. Body under 500 lines per the Claude Code skill best practice. If the procedure is bigger, factor sub-skills.
6. Run the mirror-field invariant test (BI-98683E68) before committing.

## Plugin manifests

The `.claude-plugin/plugin.json` manifest turns this directory into an installable Claude Code plugin. The `.codex-plugin/plugin.json` manifest exposes the same `skills/` directory to Codex. Repo-level marketplace files live at the repository root:

- `.claude-plugin/marketplace.json` — Claude Code project marketplace, enabled by `.claude/settings.json` as `dpf-platform@dpf-platform-local`.
- `.agents/plugins/marketplace.json` — Codex repo marketplace, marked `INSTALLED_BY_DEFAULT` for the same plugin directory.

The auto-install hook (BI-98683E68) wires these into portal install + worktree creation so contributors do not need to hand-run client plugin commands.

## See also

- Parent BI: [BI-90793048](../../docs/superpowers/drafts/2026-05-24-dpf-skill-pack-formalization-bi-bundle.md)
- AGENTS.md §16 dual-surface catalogue (BI-439BC89B — not yet landed; will reference this README)
- Reduction Gear Architecture: [docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md](../../docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md) (parent epic substrate framing)
