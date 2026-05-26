# DPF Skill Pack Formalization — Backlog Item Drafts

> **Status:** DRAFT — awaiting operator ratification before any BI is filed.
> Per `feedback_spec_commit_plan_process`, on ratification this memo gets committed to `main` and the parent BI is filed; per-child BIs follow.
> **Authored:** 2026-05-24, worktree `gifted-banzai-3be1fb`.
> **Origin:** WWMD-against-principles design audit, 2026-05-24 session (research synthesis captured inline in §1 — no separate audit memo was written).

---

## 1. Framing — why this is one bundle

DPF has three skill substrates today that are not reconciled, all using the word "skill" to mean different things:

- **Surface A (Claude Code contributors):** generic agentic skills come from a manually-copied snapshot of `obra/superpowers` v5.0.5 in the retired reference mirror, with bytes-equivalent duplicates at [.claude/commands/](../../../.claude/commands/) and two DPF-native skills under [.claude/skills/](../../../.claude/skills/). No installer, no plugin manifest, no auto-update, no AGENTS.md cross-reference. A fresh contributor inherits a frozen 5.0.5 snapshot and has no documented path to discover what exists or how to invoke it.
- **Surface B (in-portal coworkers):** 57 skills under [skills/&lt;category&gt;/*.skill.md](../../../skills/), parsed by [packages/db/src/seed-skills.ts](../../../packages/db/src/seed-skills.ts) and upserted to `SkillDefinition` + `SkillAssignment` on every portal seed run. Live and mature: each skill carries DPF-specific frontmatter (`category`, `assignTo`, `capability`, `taskType`, `triggerPattern`, `userInvocable` / `agentInvocable`, `composesFrom`, `contextRequirements`, `riskBand`) and rides a governance lifecycle (`active | stale | pinned | quarantined | archived`) per the Hermes learning loop ([packages/db/src/skill-lifecycle](../../../apps/web/lib/skills/lifecycle.ts)). The runtime is the in-portal coworker — not Claude Code.
- **Surface C (founder kernel):** principles at [docs/founder-kernel/wiki/principles/](../../founder-kernel/wiki/principles/), retrievable via `wiki_query` and consulted by `principle_decide` ([apps/web/lib/wiki/principle-decide.ts](../../../apps/web/lib/wiki/principle-decide.ts)). Governance for both A and B but installed on neither.

The originating trigger (this morning's `2026-05-24-build-studio-design-time-decomposition-design.md` design with 7 open questions) showed that the WWMD-against-principles procedure exists as a *kernel* and a *tool* but has zero references in Surface A or Surface B procedural skills. **The 2026-05-24 operator correction made the scope explicit: skills must apply to AI coworkers too.** Bifurcating by surface — shipping A now and B as a follow-up — would itself be the substrate violation we're trying to fix. This bundle therefore lands skills on BOTH surfaces from day one, with a single authoritative source per skill.

**The bridging problem is real, not naming.** The two surfaces' frontmatter formats are incompatible in non-trivial ways:

| Concern | Surface A (Claude Code) | Surface B (in-portal coworker) |
|---|---|---|
| File layout | `<plugin>/skills/<slug>/SKILL.md` (directory) | `skills/<category>/<slug>.skill.md` (flat file) |
| Required frontmatter | `description` (recommended) | `name`, `description`, `category`, `assignTo`, `taskType`, `userInvocable`, `agentInvocable`, `riskBand` |
| Invocation control | `disable-model-invocation`, `user-invocable` | `userInvocable`, `agentInvocable` (inverse naming, same semantics) |
| Tools | `allowed-tools` (space-separated) | `allowedTools` (YAML list) |
| Composition | (none in standard) | `composesFrom: [skill-id, ...]` |
| Lifecycle | (none) | Hermes axis: `active \| stale \| pinned \| quarantined \| archived` |
| Discovery | `description` + auto-listing | `triggerPattern` regex + `assignTo` agent filter |

Designed correctly, this is a single-source-of-truth problem with a known solution: the Agent Skills open standard tolerates additional frontmatter fields (it just ignores ones it doesn't recognize). Authoring skills in a **superset frontmatter** — Agent Skills standard fields for Surface A plus DPF custom fields for Surface B — lets one SKILL.md file drive both runtimes, with the seed loader extended to parse the same file.

External research (previous turn) confirms the Surface-A ecosystem has converged on plugin-distributed, three-scope (enterprise/personal/project) namespaced skills with AGENTS.md as the discovery anchor. The 57 existing Surface-B skills stay in their current format; the new dpf-platform pack adds the superset format and a roadmap (separate BI under EP-SKILL-001) for migrating the legacy files when the team is ready. No big-bang refactor, no SSoT violation.

## 2. Parent BI

```
Title:        DPF skill pack — formalize agent skills as auto-installed plugin, retire manual superpowers snapshot
Type:         portfolio
Parent epic:  EP-REDUCTION-GEAR-ARCH
Cross-refs:   EP-SKILL-001 (coworker skill marketplace — same artifacts must be discoverable there once it lands)
              EP-BUILD-9DB5B0 (Build Studio — Surface B consumer of dpf-decision-via-kernel)
Size:         L (estimated 7 child BIs; ~2 weeks elapsed if Build-Studio capacity is healthy)
```

**Body**

DPF's skill substrate is currently a three-way Frankenstein: a stale manual snapshot of `obra/superpowers` v5.0.5 mirrored as both reference docs and slash commands for Claude Code contributors; a mature but parallel coworker-skill registry seeded from 57 `.skill.md` files for in-portal agents; and a kernel-principle wiki neither surface references procedurally. There is no installer for the contributor side, no plugin manifest, no auto-update path, no AGENTS.md discovery anchor, and no formal home for DPF-specific procedural skills like the BI lifecycle, Build Studio promotion, worktree-per-session discipline, DCO sign-off, and WWMD-via-kernel consultation. The two surfaces' skill formats diverge in non-trivial ways (see §1 table), so DPF-specific skills authored once and seen by both surfaces is itself a substrate problem.

This BI formalizes a **DPF skill pack** authored once in superset-SKILL.md format, delivered to **both** the Claude Code contributor surface (as a checked-in plugin auto-installed on portal install and worktree creation, with conflict resolution against upstream `superpowers`) **and** the in-portal coworker surface (by extending the existing `seed-skills.ts` loader to consume the same SKILL.md files as authoritative `SkillDefinition` rows, with conflict resolution against the legacy `.skill.md` files). It adds an AGENTS.md §16 discovery catalogue covering both surfaces. It retires the manual superpowers snapshot. Surface C kernel consultation becomes a procedural step inside `dpf-decision-via-kernel`, which is one of the skills the pack ships. Big-bang migration of the 57 legacy coworker skills is deliberately out of scope and handed off to EP-SKILL-001 as a follow-up.

**Acceptance criteria**

- *Surface A:* A fresh clone + portal install ends with a contributor who can type `/dpf-decision-via-kernel` (or any DPF skill) and have it work, with no manual `/plugin install` step. A worktree created with `git worktree add` inherits the plugin without manual file copying. Upstream `obra/superpowers` installed alongside the DPF pack does not produce name collisions or ambiguous resolutions.
- *Surface B:* The same SKILL.md files are visible in the portal at `/admin/skills` as `SkillDefinition` rows after a portal seed run, assigned to the agents named in their frontmatter `assignTo` array. An in-portal coworker invoked on a route that matches the skill's `triggerPattern` resolves the skill from the plugin source, not from a duplicate legacy `.skill.md` file. When a slug collides between plugin and legacy, the plugin wins and a startup warning names the legacy file.
- *Surface C:* `dpf-decision-via-kernel` invocation from EITHER surface (Claude Code session or in-portal coworker) calls `principle_decide`, surfaces the contribution ledger to the operator, and defers if commandment conflict is flagged.
- *Cleanup:* The retired superpowers reference mirror is deleted; [.claude/commands/](../../../.claude/commands/) is reduced to DPF-only commands not better expressed as skills. AGENTS.md gains a §16 enumerating both surfaces' skill discovery paths in one place.
- *Bug fix:* `principle_decide` semantic-fallback path returns non-zero alignment on a `features: {}` call — i.e. the dead-code embedding plumbing at [principle-decide.ts:117](../../../apps/web/lib/wiki/principle-decide.ts:117) is wired through the MCP handler.
- *Verification evidence:* dynamic-analysis report covering BOTH surfaces (drove every DPF skill from a fresh worktree via Claude Code; verified each appears as a `SkillDefinition` row and is invocable by the assigned coworker via the portal UI; ledger surfaced for `dpf-decision-via-kernel` on both paths).

## 3. Child BIs

### 3.1 BI — Pre-work audit of existing snapshot edits

```
Title:        Audit .claude/commands/ and the retired superpowers reference mirror for DPF-specific edits
Type:         product (audit-only)
Parent:       [parent BI from §2]
Size:         S
```

Before deletion, diff every file under the retired superpowers reference mirror and [.claude/commands/](../../../.claude/commands/) against the upstream `obra/superpowers` v5.0.5 release tag. Identify any DPF-specific additions, removals, or wording shifts that someone made on top of the snapshot and that would be lost in the retirement step. Examples of what to look for: the [tool-evaluation.md](../../../.claude/commands/tool-evaluation.md) command (DPF-only, must be preserved); the [build-studio-operator.md](../../../.claude/commands/build-studio-operator.md) command (DPF-only); MCP-tool references like the `search_code_graph` hint in the retired `writing-plans.md` skill; any cross-references to DPF specs/paths inside generic-looking skill bodies.

**Acceptance criteria**

- Report saved to `docs/superpowers/audits/YYYY-MM-DD-superpowers-snapshot-drift.md` enumerating every file and every DPF-specific delta.
- Each DPF-specific delta is mapped to its destination in the new skill pack (carried forward, retired, or merged into another skill).
- Operator sign-off on the report before BI-2 starts authoring.

### 3.2 BI — Author 7 DPF-native skills with superset SKILL.md frontmatter (dual-surface)

```
Title:        Author DPF-native skill pack (7 skills) with superset SKILL.md frontmatter consumable by both Claude Code plugin and coworker seed loader
Type:         product
Parent:       [parent BI from §2]
Blocked by:   BI 3.1
Size:         M
```

Author the following seven skills under `packages/dpf-skill-pack/skills/<slug>/SKILL.md`. Each composes with a named upstream `superpowers` skill where one exists (callout in the body) rather than replacing it.

| Slug | Composes with (Surface A) | Coworker `assignTo` (Surface B) | What it adds |
|---|---|---|---|
| `dpf-file-backlog-item` | superpowers:writing-plans (predecessor) | `["build-specialist", "ops-coordinator", "platform-engineer"]` | Verify substrate → file BI → size → triage → link epic. Encodes `verify-substrate-before-proposing-new`. |
| `dpf-promote-to-build-studio` | (no analog) | `["build-specialist", "ops-coordinator"]` | BI → promote → approve Ideate → let BS run. Encodes the `Build Studio for ALL development` standing rule. |
| `dpf-decision-via-kernel` | superpowers:brainstorming (predecessor) | `["*"]` | The WWMD-against-principles step. Maps options to `PRINCIPLE_DIMENSIONS`, invokes `principle_decide`, surfaces the contribution ledger, defers if commandment conflict flagged. |
| `dpf-worktree-per-session` | superpowers:finishing-a-development-branch (predecessor) | `["build-specialist", "platform-engineer"]` | `git worktree add` + MCP seed + `COMPOSE_PROJECT_NAME` discipline. Encodes kernel `worktree-per-session` and `propose-acknowledge-reassign`. |
| `dpf-pr-with-dco` | superpowers:finishing-a-development-branch (successor) | `["build-specialist", "platform-engineer"]` | Branch from origin/main, `-s` sign-off, push, overlap-sweep, PR-when-ready. |
| `dpf-verify-substrate-first` | (no analog) | `["*"]` | Grep + live-backlog query + main-branch sweep before naming new types/tables/epics. |
| `dpf-evidence-before-diagnosis` | superpowers:systematic-debugging (predecessor) | `["*"]` | Query DB/status before claiming cause; structural-verification-is-not-functional reminder; dynamic-analysis output discipline. |

**Superset frontmatter contract.** One file, both runtimes. The Agent Skills open standard tolerates extra frontmatter; Claude Code ignores fields it doesn't recognize; the extended `seed-skills.ts` loader (delivered by BI 3.4) consumes the DPF fields. Worked example for `dpf-decision-via-kernel`:

```yaml
---
# ─── Agent Skills standard (consumed by Claude Code plugin runtime) ──────
name: dpf-decision-via-kernel
description: |
  Use when working in the DPF codebase and facing an open question with ≥2 architecturally-distinct options.
  Maps each option to the closed PRINCIPLE_DIMENSIONS registry, invokes the principle_decide MCP tool,
  surfaces the contribution ledger to the operator, and defers if a commandment conflict is flagged.
  Composes with superpowers:brainstorming as the predecessor step.
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__principle_decide mcp__dpf__wiki_query

# ─── DPF coworker fields (consumed by extended seed-skills.ts) ──────────
category: governance
assignTo: ["*"]
capability: null
taskType: deliberation
triggerPattern: "open question|trade-off|which approach|2-3 options|architectural decision"
userInvocable: true                # mirrors Agent Skills `user-invocable` semantics
agentInvocable: true               # mirrors inverse of Agent Skills `disable-model-invocation`
allowedTools: ["mcp__dpf__principle_decide", "mcp__dpf__wiki_query"]
composesFrom: ["brainstorming"]
contextRequirements: ["principle_decide MCP tool reachable"]
riskBand: low

# ─── DPF kernel cross-reference (informational, both surfaces) ──────────
enforces:
  - kernel/principles/structural-verification-is-not-functional
  - kernel/principles/architecture-over-shortcuts
---
```

**Authoring rules** (apply to every skill in the pack):

- (a) Body cites the kernel principle slug(s) it enforces in an `## Enforces` section after the title.
- (b) Both invocation paths must be tested: `/dpf-<slug>` from Claude Code AND a triggerPattern match from the assigned coworker in the portal.
- (c) Body under 500 lines per Claude Code skill best practice.
- (d) At least one concrete worked example with real DPF context (not toy data).
- (e) The mirror-field invariant — `user-invocable` ↔ `userInvocable`, `allowed-tools` ↔ `allowedTools`, `disable-model-invocation: false` ↔ `agentInvocable: true` — is asserted by a unit test in BI 3.4's seed-loader work, so divergence between the two field families is detected on every CI run.

**Acceptance criteria**

- All 7 SKILL.md files exist; lint clean (no PowerShell unicode etc per AGENTS.md §2); frontmatter validates against both the [Agent Skills open standard](https://agentskills.io) and the existing `seed-skills.ts` schema (`packages/db/src/seed-skills.ts:12–26`).
- Each composes-with reference is bidirectional: the DPF skill body names the superpowers/coworker skill; the AGENTS.md catalogue (BI 3.5) names both.
- `dpf-decision-via-kernel` includes a worked example using the live `principle_decide` tool against the 7 open questions from this morning's design.
- Spec review loop: dispatch spec-document-reviewer (max 3 iterations).
- Mirror-field invariant unit test passes for every skill in the pack (delivered by BI 3.4 but assertion-style is locked here).

### 3.3 BI — Package as Claude Code plugin with manifest (Surface A delivery)

```
Title:        Package DPF skill pack as Claude Code plugin (.claude-plugin/plugin.json)
Type:         product
Parent:       [parent BI from §2]
Blocked by:   BI 3.2
Size:         S
```

Wrap the seven skills (plus the two existing DPF-native skills `dev-portal-start` and `ui-ux-pro-max`) as a Claude Code plugin at `packages/dpf-skill-pack/` with a `.claude-plugin/plugin.json` manifest. Plugin name: `dpf-platform` (so skills are auto-namespaced as `dpf-platform:dpf-decision-via-kernel` etc — defensive against future name collisions with other plugins beyond superpowers).

**Note on dual consumption.** The plugin's `skills/<slug>/SKILL.md` directory layout is the canonical authoring location. The Surface B seed loader (delivered by BI 3.4) reads from the same directory at portal-seed time — no copying, no symlinks, no separate `.skill.md` mirror. This is the single-source-of-truth contract.

**Acceptance criteria**

- Plugin installable via `/plugin install ./packages/dpf-skill-pack` from any DPF repo root.
- Manifest declares author (DPF), version (semver, starts at 0.1.0), and a per-skill listing.
- Plugin includes a top-level `README.md` describing the pack's purpose, the namespace contract, AND the fact that the same SKILL.md files seed coworker `SkillDefinition` rows on portal install.
- Local install on a clean Claude Code session resolves all 7 skills under the `dpf-platform:` namespace and they appear in `/skills`.

### 3.4 BI — Auto-install on portal install + worktree creation, with dual-surface conflict resolution

```
Title:        Auto-install dpf-platform skill pack on portal install and worktree creation across BOTH Claude Code and coworker runtimes, with conflict resolution against superpowers (Surface A) and legacy .skill.md files (Surface B)
Type:         portfolio (substrate)
Parent:       [parent BI from §2]
Blocked by:   BI 3.3
Size:         L (was M; expanded for Surface B)
```

(**This child captures two operator requirements from 2026-05-24: (a) "installed locally automatically with the portal, with conflicting skills sorted too"; (b) "skills need to apply to the AI coworkers too." Both surfaces install at portal-install time; conflict resolution is per-surface.**)

#### Surface A — Claude Code contributor runtime

1. **Portal install (Windows installer + future macOS/Linux):** the installer (currently the `dpf-installer.ps1` family per [AGENTS.md §2 "Deployment doctrine"](../../../AGENTS.md)) detects a Claude Code installation (`~/.claude/` present) and, if found, runs `/plugin install file://<repo-root>/packages/dpf-skill-pack` as the installing user. If Claude Code is absent, the installer records the deferred install in a state file and the portal's first-launch contributor onboarding flow offers the install. **Never** asks the user to run a command (per `never-ask-user-to-run-commands`).
2. **Worktree creation:** [scripts/seed-worktree-mcp.ps1](../../../scripts/seed-worktree-mcp.ps1) (existing worktree-seed script per [AGENTS.md §4](../../../AGENTS.md)) gains a step that ensures the worktree's `.claude/settings.local.json` references the plugin path. Idempotent. Bash equivalent ships in the same BI per the cross-platform doctrine.
3. **Surface-A conflict resolution against superpowers:** plugin skills are namespaced (`dpf-platform:slug`), so literal collision is impossible. The real conflict surface is **agent invocation ambiguity** — when both `superpowers:writing-plans` and `dpf-platform:dpf-file-backlog-item` are available, which does the agent invoke for "I need to plan this feature"? Policy:

   - DPF skill `description` fields begin with a DPF-context selector (*"Use when working in the DPF codebase before any feature work — the BI lifecycle gate sits in front of superpowers:writing-plans"*).
   - For every DPF skill with a composes-with relationship (5 of 7), the description explicitly says *"invokes superpowers:&lt;name&gt; as a sub-step."*
   - For DPF skills with no analog, descriptions emphasize the DPF-specific trigger.
   - **Hard precedence rule** in AGENTS.md §16: *"When both a DPF skill and a superpowers skill could apply, the DPF skill wins because it encodes platform-specific gates (BI, BS, DCO, kernel) the superpowers skill is unaware of."*

#### Surface B — In-portal coworker runtime

4. **Extend `packages/db/src/seed-skills.ts` to scan the plugin directory.** Current loader walks `skills/<category>/*.skill.md` (line 10 — `SKILLS_DIR = join(__dirname, "..", "..", "..", "skills")`). Add a second pass that walks `packages/dpf-skill-pack/skills/<slug>/SKILL.md`, parses the superset frontmatter, and upserts `SkillDefinition` + `SkillAssignment` rows. The loader maps frontmatter field names so the existing DB schema is unchanged: `user-invocable` → `userInvocable`, `allowed-tools` → `allowedTools`, `disable-model-invocation: false` → `agentInvocable: true` (inverse). The DPF-only `category`, `assignTo`, `taskType`, `triggerPattern`, `composesFrom`, `contextRequirements`, `riskBand` flow through unchanged.
5. **Portal install seeds Surface B automatically.** The portal's existing seed run (already part of `portal-init` per AGENTS.md §2) covers this once the loader extension lands — no new install hook needed. A fresh portal install gets `SkillDefinition` rows for all 7 new skills + the existing 57 legacy skills, with the 7 new ones marked `source: dpf-platform-plugin` and the legacy ones marked `source: repo-skills-directory` so the admin UI can distinguish.
6. **Surface-B conflict resolution — plugin wins over legacy:** when a slug appears in both `skills/<category>/<slug>.skill.md` (legacy) AND `packages/dpf-skill-pack/skills/<slug>/SKILL.md` (plugin), the plugin file is the source of truth and seeds the `SkillDefinition` row. The loader emits a startup warning (`[seed-skills] plugin source overriding legacy for <slug>; consider migrating skills/<category>/<slug>.skill.md`) and writes the warning into a `SkillSeedWarning` table so the admin observatory can list pending migrations. No legacy file is deleted by this BI — that's the explicit handoff to EP-SKILL-001's migration work.
7. **Mirror-field invariant test:** unit test in `packages/db/src/seed-skills.test.ts` walks every plugin SKILL.md and asserts the Agent-Skills-standard fields and DPF-coworker fields are non-contradictory (e.g. `user-invocable: true` MUST coexist with `userInvocable: true`; `disable-model-invocation: true` MUST coexist with `agentInvocable: false`). Skills failing the invariant fail CI.

**Acceptance criteria**

- *Surface A:* Fresh Windows install of DPF on a machine with Claude Code already present results in `/dpf-decision-via-kernel` working with no user action other than the install. `git worktree add` produces a worktree where the plugin is already resolved. An agent in a fresh session asked to "plan out the WWMD integration work" chooses `dpf-platform:dpf-file-backlog-item` over `superpowers:writing-plans` because the description triggers correctly (integration test asserts this). No regressions in upstream `superpowers` invocation when the DPF pack doesn't apply.
- *Surface B:* After portal install, `SELECT name, source FROM "SkillDefinition" WHERE name LIKE 'dpf-%'` returns the 7 new skills with `source = 'dpf-platform-plugin'`. The portal's `/admin/skills` page lists them alongside the legacy 57. Invoking `dpf-decision-via-kernel` from an assigned in-portal coworker (e.g. build-specialist on `/build`) reaches the same `principle_decide` MCP tool and surfaces the same contribution ledger as the Claude Code path. The mirror-field invariant test passes for all 7 skills.
- *Surface B conflict policy:* a manufactured collision test (drop a stub `skills/governance/dpf-decision-via-kernel.skill.md` with a divergent body) results in the plugin body winning, a startup warning emitted, and a `SkillSeedWarning` row created — verified by integration test.
- *Customer install gating:* customer-side install (non-contributor — e.g. Dale's HVAC) gets the Surface B `SkillDefinition` rows (coworkers need them to do their jobs) but NOT the Surface A plugin auto-install (no Claude Code expected). The Surface A install is gated on a signal to be decided in §5 question 3.

### 3.5 BI — AGENTS.md §16 dual-surface discovery catalogue

```
Title:        Add §16 "Skill discovery" to AGENTS.md covering both Claude Code and coworker surfaces
Type:         product
Parent:       [parent BI from §2]
Blocked by:   BI 3.2 (skills must exist before being catalogued)
Size:         XS
```

Add a §16 to [AGENTS.md](../../../AGENTS.md) per the OpenAI Codex AGENTS.md convention (catalogue reference, not duplication). Four blocks:

1. **The dual-surface contract** — one paragraph stating: DPF skills are authored once in superset SKILL.md format at `packages/dpf-skill-pack/skills/<slug>/SKILL.md`; the Claude Code plugin runtime loads them for contributors; the `seed-skills.ts` loader seeds them as `SkillDefinition` rows for in-portal coworkers; both surfaces converge on the same body and the same kernel-principle enforcement.
2. **Generic skills (Surface A only)** — install upstream `superpowers` via the official marketplace command; coworkers do not consume superpowers.
3. **DPF platform skills (both surfaces)** — the 7 DPF skills + 2 existing DPF skills enumerated one per line, each entry showing: `name`, the Surface-A trigger phrase, the Surface-B `assignTo` set, kernel principle slugs enforced.
4. **Legacy coworker skills (Surface B only, for now)** — pointer to `skills/<category>/*.skill.md` (the 57 existing files) and the EP-SKILL-001 migration roadmap. Note that legacy files use the older frontmatter format; new skills MUST use the superset format and live in the plugin.
5. **Disambiguation rules:**
   - *Surface A:* "When both a DPF skill and a superpowers skill could apply, the DPF skill wins because it encodes platform-specific gates (BI, BS, DCO, kernel) the superpowers skill is unaware of."
   - *Surface B:* "When the same slug exists as both a plugin SKILL.md and a legacy `.skill.md`, the plugin file wins. The startup warning in the admin observatory lists pending legacy migrations."
6. **Kernel principles (Surface C)** — pointer to [docs/founder-kernel/wiki/principles/](../../founder-kernel/wiki/principles/), `wiki_query` / `principle_decide` MCP tools, and the `dpf-decision-via-kernel` skill that operationalizes consultation from either runtime.

**Acceptance criteria**

- §16 is under 80 lines (it's a catalogue, not a manual; 60-line target was pre-dual-surface).
- Every DPF skill listed has a one-line trigger phrase a reader can grep against the SKILL.md frontmatter AND the seed loader's resulting `SkillDefinition.triggerPattern` to verify both surfaces agree.
- Both disambiguation rules are restated verbatim so AGENTS.md remains operationally complete when MCP is offline (per the existing AGENTS.md §1 note).
- §16 references the Surface-C kernel consultation path explicitly, closing the three-substrate loop identified in §1 of this memo.

### 3.6 BI — Retire manual superpowers snapshot and duplicate slash commands

```
Title:        Delete the retired superpowers reference mirror and the duplicated .claude/commands/ files
Type:         chore
Parent:       [parent BI from §2]
Blocked by:   BI 3.1, BI 3.4, BI 3.5
Size:         XS
```

Once the audit (3.1) has carried forward DPF-specific edits, the auto-install (3.4) provides equivalent or better skills via the plugin, and AGENTS.md (3.5) tells future contributors where to look, delete:

- The entire retired superpowers reference mirror.
- The duplicated [.claude/commands/](../../../.claude/commands/) files that are bytes-equivalent to superpowers (12 skill commands + 5 prompt commands).
- Keep [.claude/commands/tool-evaluation.md](../../../.claude/commands/tool-evaluation.md) and [.claude/commands/build-studio-operator.md](../../../.claude/commands/build-studio-operator.md) (DPF-only) for now; consider re-homing them into the plugin in a separate BI if it makes sense after the dust settles.

**Acceptance criteria**

- `git grep` for any reference to the retired superpowers reference path returns no matches outside of changelog/audit entries.
- An agent session started from a fresh clone (with the plugin installed via 3.4) can still answer "what skills do you have for planning?" correctly.

### 3.7 BI — Fix principle_decide semantic-fallback embedding plumbing

```
Title:        Wire option-description embedding and principle direction-embedding fetching into principle_decide MCP handler
Type:         product (defect fix)
Parent:       [parent BI from §2]
Size:         S
```

The semantic-fallback code path at [principle-decide.ts:117](../../../apps/web/lib/wiki/principle-decide.ts:117) is dead code in production: per the inline comment at [mcp-tools.ts:10954–10956](../../../apps/web/lib/mcp-tools.ts:10954), Qdrant-sourced principles have no direction embedding fetched, and option descriptions are never embedded server-side. A `features: {}` call collapses to all-zero alignment — confirmed by the 2026-05-24 morning session's first invocation.

Fix:
1. When loading core/contextual principles, also fetch their `directionEmbedding` from Qdrant (or compute once and cache).
2. When the caller passes options without `features` and without `embedding`, embed each option's `description` server-side before invoking `decide()`.
3. Behavior on mixed input (some options with features, some without) follows the existing per-principle structured-vs-semantic selection logic — no caller API change.

**Acceptance criteria**

- Unit test in [mcp-tools-principle-decide.test.ts](../../../apps/web/lib/mcp-tools-principle-decide.test.ts) covers the `features: {}` path and asserts non-zero alignment for an option-description that semantically aligns with at least one principle.
- The 2026-05-24 morning failure scenario, replayed, returns a recommendation with non-degenerate composite scores.
- `dpf-decision-via-kernel` skill body can drop its "you MUST manufacture features" instruction in favor of a softer "supply features when you want stronger structured alignment; semantic fallback works otherwise."

## 4. Dependency graph

```
3.1 audit ──┐
            ├──> 3.2 author ──> 3.3 package ──> 3.4 auto-install + conflict resolution
            │                                       │
            └─> (carries DPF deltas forward)         ├──> 3.5 AGENTS.md catalogue ──> 3.6 retire snapshot
                                                    │
                                                    └─> 3.7 (independent, parallel)
```

3.7 is technically independent and could start any time, but its acceptance criteria mention loosening the `dpf-decision-via-kernel` skill body, so it should land before 3.2's spec review closes.

## 5. Open questions for ratification

1. **Parent epic** — EP-REDUCTION-GEAR-ARCH is the proposal (substrate consolidation across A/B/C, gear-boundary contract). Alternative is a new EP-AGENT-RULEBOOK epic dedicated to agent-procedural-skill governance across surfaces. The Reduction-Gear option co-locates this with the broader substrate consolidation; a new epic isolates it for separate prioritization. **My recommendation:** Reduction-Gear — now even stronger after the dual-surface revision, since the bundle is literally a reduction-gear interface (one skill body, two consumers, one source of truth). Standing up a new epic for it would violate `check-epic-overlap-before-creating`.

2. **Plugin name** — `dpf-platform` proposed. Alternative: `dpf` (shorter but might collide with a future official DPF plugin distributed via Anthropic marketplace). **My recommendation:** `dpf-platform` for now, rename trivially if marketplace publishing is later approved.

3. **Customer-side Surface A gating** — Surface B (coworker `SkillDefinition` rows) installs on every portal install because coworkers need their skills to function regardless of contributor status. Surface A (Claude Code plugin) is only useful for installs that have Claude Code present. Three options for the Surface A gate: (a) presence-detect `~/.claude/` and install if found; (b) explicit `DPF_CONTRIBUTOR=1` env var in the installer; (c) ship as a separate sub-package `dpf-contributor-skills` that the contributor-onboarding flow installs. **My recommendation:** (a) presence-detect — zero-config matches `feedback_zero_click_provider_setup` and the customer never sees the Surface A install unless they've already chosen to install Claude Code, in which case they almost certainly want the DPF plugin.

4. **Legacy coworker skill migration timing** — the 57 existing `skills/<category>/*.skill.md` files are NOT migrated by this bundle (out of scope). When should they move to the superset SKILL.md format under the plugin? Three options: (a) opportunistically — every time someone edits a legacy skill, migrate it as part of that edit; (b) one dedicated migration BI under EP-SKILL-001 that flips all 57 in a single PR; (c) never — let legacy and plugin formats coexist indefinitely, with the loader supporting both forever. **My recommendation:** (a) opportunistic, with a tracking BI under EP-SKILL-001 that lists the 57 and ticks them off as they're touched. Big-bang migration (b) is high-risk for low-value; coexistence forever (c) leaves the SSoT violation as a permanent fixture. The seed loader's per-skill warning system from BI 3.4 surfaces the legacy list to the admin observatory so migration progress is visible without manual tracking.

## 6. What to ratify

If you OK this memo, the next steps per `feedback_spec_commit_plan_process` are:

1. Commit this memo to `main` on a new branch (no PR opened yet — single-commit doc change).
2. File the parent BI from §2 with body verbatim, referencing this memo.
3. File the 7 child BIs from §3, each with the body verbatim, blocked-by relationships per §4.
4. Feed the parent BI to `writing-plans` to produce the first plan (likely BI 3.1 + 3.2 since they're the unblocked head of the dependency chain).

If you want changes — different parent epic, different skill list, different installer surface, different conflict-resolution policy — say so before I file anything. Filing 7 BIs is reversible but noisy; getting the framing right here saves churn.
