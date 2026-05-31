# Tiered Dev-Loop Isolation — design

- Status: **DRAFT** (planning artifact — wires existing substrate; no new schema)
- Authored: 2026-05-31
- Builds on: PR #1389 (isolated upgrade workspace), the existing `RuntimeTarget` model, the existing `nonprod-environment-lease` MCP surface, the existing dev-DB stack, and the existing `dpf-use-shared-nonprod-environment` skill.
- BI cluster: BI-F7E02898 (auto-claim leases), BI-6701C6BF (active-candidate stack), BI-166C59F3 (local-CI gate), BI-AD949172 (janitor activation), BI-C05E79AF (skill auto-trigger), **BI-0856A4CE (install-time tier separation — the structural root)**, **BI-6B02FEE5 (Claude/Codex worktree-lifecycle parity)**
- Epic: EP-WORKTREE-HYGIENE (extending — see §8 for whether to spin a dedicated EP)

---

## 1. Problem

Multiple agent surfaces (Claude Code in many concurrent sessions, Codex sessions, Build Studio coworkers, the operator themselves) operate against the same DPF install at `~/dpf`. The install clone is simultaneously: the running portal source, the multi-agent dev tree, and the worktree root. Three roles in one place.

Concrete collision evidence (substrate-verified 2026-05-31 on Mark's install):

| Surface | Today's behavior | Symptom |
|---|---|---|
| 63 worktrees on disk | Many created over weeks, never pruned | Disk pressure, branch-hopping confusion, agent-A's WIP carried into agent-B's tree via uncommitted branch switches |
| 0 nonprod-environment leases active | Tooling exists, no one uses it | No who-touches-what audit; agents collide on ports + the install's checked-out branch |
| `RT-DEV-PORTAL` registered but `status: planned` since 2026-05-28 | Tier defined, never started | No pre-production verification surface |
| `RT-BUILD-SANDBOX-FB-892ECD67` shows `status: running` 24h+ stale | No heartbeat sweep | Coordination map lies about live state |
| `dpf-dev-postgres-1` / `dpf-dev-qdrant-1` / `dpf-dev-neo4j-1` running on :5433/:6334/:7475 | Parallel data plane, nothing consumes it | Resources spent for no gain |
| Self-upgrade (PRE-#1389) tried to merge `origin/main` into the operator's checked-out clone | Merge-conflict on every run for a week (SUR-4170A843, ...) | Production deploys blocked while operator's dev work was active |

The pattern: **the substrate exists for everything the operator is asking for; the wiring + adoption is the gap.**

## 2. The tier model the substrate already names

| Tier | Substrate id | Today's state | Role |
|---|---|---|---|
| **Production** | `RuntimeTarget.kind: "root-portal"` (`RT-ROOT-PORTAL`, :3000) | Running. Final-acceptance role. | Customer-visible portal. Self-upgrade's eventual deploy target. |
| **Active candidate** | `RuntimeTarget.kind: "dev-portal"` (`RT-DEV-PORTAL`, :3001) + `nonprod-environment-lease.environmentKey: "active-candidate"` | `planned` (never started) + zero leases | Where merged-`main` lands FIRST for integration testing before promotion to production. |
| **Local CI** | `nonprod-environment-lease.environmentKey: "local-integration-ci"` + per-worktree compose stack | Schema exists, never used | Pre-push gate for a single worktree's changes. |
| **Worktree instance** | `RuntimeTarget.kind: "external-preview"` or `"ad-hoc-debug"` + per-worktree `COMPOSE_PROJECT_NAME` | Schema exists, worktrees never register | Active dev surface for one agent / contributor session. |
| **Build sandbox** | `RuntimeTarget.kind: "build-sandbox"` (already used by Build Studio) | Working when alive | Isolated build execution for BS-driven feature work. |
| **Git-promotion sandbox** | `RuntimeTarget.kind: "git-promotion-sandbox"` | Defined, unclear if used | Reserved for promotion-flow verification. |

`acceptanceRole` is derived from `kind`: `root-portal` → `final-acceptance`, the rest → `non-prod-verification`. The promotion gate is already conceptually wired — the runtime-coordination-map's `verifications` array is the audit surface.

## 3. Lifecycle of a single change (target state)

```
┌──────────────────┐    1) git worktree add → claim lease (local-integration-ci)
│  Worktree inst.  │    2) Agent edits, commits in worktree
│  (ad-hoc-debug)  │    3) pregate: vitest + typecheck + next build in isolated stack
└────────┬─────────┘    4) push → CI on remote → PR open → review
         │              5) merge to main → release worktree lease
         ▼
┌──────────────────┐    6) Inngest fires on merge: pull main into active-candidate
│  Active candidate│    7) Rebuild :3001 portal stack from main
│  (dev-portal)    │    8) Curated UX verification suite runs
└────────┬─────────┘    9) verification record attaches to RT-DEV-PORTAL
         │
         ▼
┌──────────────────┐   10) Self-upgrade trigger checks: was this SHA verified
│  Production      │       on active-candidate? If yes → proceed.
│  (root-portal)   │   11) PR #1389's isolated-workspace merge + promote.sh
│  :3000           │       (workspace operates against a fresh clone, never
└──────────────────┘       the operator's working tree)
```

The lifecycle is **already supported by today's substrate**. Today most steps are skipped: no lease at (1), no `pregate` at (3), no merge trigger at (6), no verification at (8-9), no gate check at (10).

## 4. The 7 BIs — what each one wires

| BI | Surface | Adds |
|---|---|---|
| **BI-0856A4CE** | Installer (install-dpf.sh / install-dpf.ps1 + 'dpf install relocate') | **The structural root.** Splits the install into TWO trees: production install (read-only after setup, owned by the platform, lives under `~/.dpf/install/` or platform-conventional path) AND dev workspace (`~/dpf` or contributor's preferred root — where worktrees branch from). The conflation of these two roles is the single cause of every collision in §1. Until this lands, every other BI is fighting structure. |
| **BI-F7E02898** | Claude Code, Codex, BS coworkers | SessionStart hook → `claim_nonprod_environment_lease`; SessionEnd → release. Every agent session shows up in the coordination map. |
| **BI-6B02FEE5** | Claude Code + Codex + 'dpf worktree' CLI wrapper | Client-tool worktree-lifecycle parity. A `dpf worktree new/rm/list` wrapper that both clients call (via their own hooks); seeds MCP, claims lease, registers RuntimeTarget, refuses creation inside the production install path. Both clients behave the same regardless of which one the contributor uses. |
| **BI-6701C6BF** | Compose + Inngest + UI | Long-lived `RT-DEV-PORTAL` at :3001 backed by dev DBs. Auto-merge-into-active-candidate Inngest job. Promotion gate: production self-upgrade refuses unless same SHA passed verification on active-candidate. `/ops/self-upgrade` shows both tiers. |
| **BI-166C59F3** | Per-worktree script + pre-push hook | `pnpm run pregate` claims `local-integration-ci` lease, runs vitest + typecheck + next build, marks `gatePassed=true`. Pre-push hook refuses ungated pushes (with `DPF_SKIP_PREPUSH=1` bypass). |
| **BI-AD949172** | Inngest scheduled + `/ops/dev-loop` UI | Worktree janitor (no commits + no PR + no lease + no build linkage → prune after grace). RuntimeTarget heartbeat sweep (stale `running` → `expired`). |
| **BI-C05E79AF** | Skill auto-trigger registry | Extends `dpf-use-shared-nonprod-environment` trigger pattern to include action verbs (`verify`, `preview`, `start the portal`) + Bash-tool-boundary heuristic for `docker compose up`, `pnpm dev`, etc. |

## 5. Composition + ordering

```
BI-0856A4CE (install-time separation) ─── the STRUCTURAL ROOT; all others assume it
        │
        ├──→ BI-6B02FEE5 (client-tool parity: Claude + Codex behave identically
        │                  against the new two-tree install layout)
        │           │
        │           └──→ BI-F7E02898 (auto-claim leases, per-client wiring)
        │                       │
        │                       ├──→ BI-C05E79AF (skill auto-trigger reinforces it)
        │                       └──→ BI-AD949172 (janitor uses lease state to prune)
        │
        ├──→ BI-166C59F3 (local-CI gate runs in the dev workspace, never in install)
        │
        └──→ BI-6701C6BF (active-candidate stack ≠ production install; clean lineage)
                        │
                        └──→ Promotion gate to production self-upgrade
```

Suggested build order (revised):

1. **BI-0856A4CE** (install-time separation) — the structural root. **Land first or every other BI is fighting collision-by-construction.** Includes the 'dpf install relocate' migration command so existing installs (including the founder's) move cleanly.
2. **BI-6B02FEE5** (client-tool parity) — gives both Claude and Codex a uniform worktree wrapper that respects the new install/dev split. Without this, one client could still drop worktrees in the wrong place.
3. **BI-F7E02898** (auto-claim leases) — both clients' hooks now have a shared substrate to call into. Foundational for the next two.
4. **BI-AD949172** (janitor) — immediate visible cleanup; gives the operator one screen.
5. **BI-166C59F3** (local-CI gate) — pre-push enforcement; pairs naturally with the auto-claim lease.
6. **BI-C05E79AF** (skill auto-trigger) — small, can land anywhere in the sequence.
7. **BI-6701C6BF** (active-candidate stack) — biggest piece; needs the other tiers in place to be useful, and is the substantive promotion-gate enforcer.

Each BI is independently shippable AFTER its predecessor in the chain. None require new schema (the install-time BI changes ON-DISK layout + PlatformConfig fields, but the existing models cover both).

## 6. What does NOT belong in this cluster

- **Customer-install behavior**: customer installs only see production. No active-candidate, no worktrees, no Claude/Codex hooks. This is contributor-install / contributor-fork infrastructure.
- **Multi-machine separation**: this is single-machine tier isolation. Cross-machine promotion (CI runners, remote staging) is the existing GitHub Actions surface.
- **Replacing GitHub Actions**: local CI is the PRE-push gate. Remote CI on the PR is still authoritative for merge.
- **Build Studio re-architecture**: BS already uses `build-sandbox` correctly. This cluster doesn't change how BS works; it adds peer surfaces.

## 7. Open questions for founder review

1. **Promotion gate strength**: should self-upgrade HARD-REFUSE without an active-candidate verification (proposed §3 step 10) or just WARN? Hard-refuse is safer but adds a manual unblock when active-candidate is down.
2. **Worktree janitor default grace**: 14 days proposed. Too long? Mark has worktrees from May 17 (workspace-hygiene-system) that may still matter.
3. **Codex hook parity**: Claude has `.claude/settings.json` with hooks. Codex has `~/.codex/config.toml`. Whose responsibility is it to author the Codex equivalent — DPF, Codex upstream, or a DPF-skill-pack contribution?
4. **Lease as the only signal**: should janitor pruning consider ONLY lease state, or also git activity / open-PR state? Proposed: all three (lease + commits + PR), so a dormant branch with an open PR is preserved.
5. **`/ops/dev-loop` UI placement**: new tab, or fold into `/ops/self-upgrade` which already shows runtime state?

## 8. Epic placement

Filed under `EP-WORKTREE-HYGIENE` because the existing epic already owns the janitor + COMPOSE_PROJECT_NAME isolation BIs. The cluster fits.

If the founder prefers a dedicated epic (e.g. `EP-DEV-LOOP-ISOLATION`) for surfacing in the backlog UI, the BIs can be re-linked cheaply — no body changes needed.

## 9. Acceptance (cluster-level, when all 7 land)

- Mark's install: migrated via `dpf install relocate` to the two-tree layout (production install at the platform path, dev workspace at `~/dpf`). 63 worktrees → curated count after janitor's first cycle; one operator-facing UI shows every active surface.
- Starting a new Claude / Codex session in a worktree auto-creates a lease, visible in the coordination map within seconds.
- A push from a worktree without a passing local-CI gate is refused (with bypass).
- A PR merge to main lands on the active-candidate :3001 stack within 60s; verification runs; production self-upgrade waits for the gate.
- `RT-BUILD-SANDBOX-FB-892ECD67` (and equivalents) no longer linger past their heartbeat.
- Zero new schema. The substrate map in §2 stays accurate after the cluster ships — we just made it true.

## 10. Install-time tier separation (BI-0856A4CE — the structural root, expanded)

The user's framing at session-end 2026-05-31: *"we need to consider the installation options, and how we move the development off a production worktree, and firmly into the sub prod worktree. This is where the collision is setup to happen from the beginning."*

The current install pattern conflates three roles into one tree at `~/dpf`:

1. **Production install** — what the running portal reads (docker-compose source, bind-mounts, the bytes the user pays for).
2. **Dev tree** — the contributor's daily-driver branch + WIP + editor cwd.
3. **Worktree base** — the `.git` directory that every `git worktree add` branches from.

PR #1389's isolated upgrade workspace was role #1's escape hatch (the upgrade no longer touches the dev tree during a merge). But roles #2 and #3 still overlap on the SAME physical clone. The first wrong action — an agent or operator switching branches with uncommitted WIP, an agent creating a worktree at the wrong root, a self-upgrade racing operator commits — happens because the install IS the dev tree.

**Target layout (BI-0856A4CE):**

```
~/.dpf/install/                          ← Production install (role #1)
├── docker-compose.yml                   ← Bind-mounted into containers
├── .env                                 ← Runtime config
├── .upgrade-workspace/                  ← PR #1389's isolated merge target
└── (... DPF source tree ...)            ← Read-only after setup

~/dpf/                                   ← Dev workspace (roles #2 + #3)
├── .git/                                ← Worktree base
├── (... DPF source tree, contributor-writable ...)
└── (active branch the contributor edits)

~/dpf-worktrees/                         ← Created BY contributor work
├── <topic-1>/
└── <topic-2>/
```

The dev workspace and production install share a remote (github.com/...) but are physically separate clones. The `dpf install relocate` migration command does the one-shot split for existing installs without losing local commits or worktrees.

Customer installs (non-contributor mode) only get role #1 — no dev workspace, no contributor prompts.

## 11. Client-tool worktree-lifecycle parity (BI-6B02FEE5)

Claude Code and Codex each ship their own worktree management. They differ in non-trivial ways:

| Concern | Claude Code | Codex |
|---|---|---|
| Session hook mechanism | `.claude/settings.json` hooks (SessionStart, SessionStop, PreToolUse, etc.) | `~/.codex/config.toml` + startup wrapper script |
| MCP config seeding | `.mcp.json` per worktree | `bearer_token_env_var` in `~/.codex/config.toml`; per-worktree MCP block |
| Worktree creation surface | Slash commands + skill triggers (manual or auto) | Built-in `/worktree` command |
| Agent identity for DCO sign-off | From `git config user.email` in worktree | Same, but reads from a different env path |
| Default cwd after worktree creation | Claude may auto-cd via the slash command | Codex auto-cd's into the new worktree |

A DPF-layer contract makes both clients call the same `dpf worktree new/rm/list` CLI wrapper. The wrapper:

1. Refuses to create a worktree inside the production install path (`~/.dpf/install/`) — points the operator at the dev workspace.
2. Creates the worktree under `<dev-workspace>-worktrees/<topic>/`.
3. Runs `scripts/seed-worktree-mcp.sh` to write both `.mcp.json` (Claude) and the Codex MCP block.
4. Sets `COMPOSE_PROJECT_NAME=dpf-<topic>` in the worktree's `.env`.
5. Calls `mcp__dpf__register_runtime_target` (kind=`external-preview` or `ad-hoc-debug`).
6. Calls `mcp__dpf__claim_nonprod_environment_lease` (kind=`local-integration-ci`, owner = `claude` or `codex` depending on caller, sessionId = client-provided).
7. Returns the worktree path + lease id to the calling client, which then handles its own UX (auto-cd, open editor, etc.).

Both clients now produce the same on-disk + DB state regardless of which CLI initiated the worktree.

## 12. Worktree sweep snapshot (taken authoring this spec)

For posterity (and as the janitor's first input when BI-AD949172 ships):

- Total: 63 worktrees → 60 after the manual conservative sweep alongside this spec authoring.
- Pruned: `doc/tts-apple-silicon-local`, `fix/voice-recording-playback-mime`, `doc/voice-apple-silicon-retro` (all merged + clean).
- With open PRs (preserve): ~4 (corpus-enrichment [#1374], upgrade-workspace-isolation [#1389], dev-loop-isolation-spec [this PR #1391], plus the post-merge `bs-ideate-dispatch` already pruned via the spec's earlier session).
- Inactive-for-weeks unmerged candidates: ~50. Real cleanup needs BI-AD949172's no-commits-in-N-days + no-open-PR heuristics — manual pruning is too risky without those signals.
- This thread alone created 4 worktrees today; net contribution after pruning + PR-merge cycles: 0 (acceptable steady state).
