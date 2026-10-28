---
status: active
---

# Worktree provisioning under GPP

Implementation parent: BI-D1FB8C4D. Epic: EP-B932453F. Workroom: WC-5DD492B9.
WWMD: DI-C1731313EB9B (capability split, option B, proceed, high confidence).
WWMD: DI-F603138224BB (hook behaviour, option H1, proceed, high confidence; consulted
on commandment-tier principles only because the embedding provider was unavailable,
so treat it as an incomplete consult and re-run when the provider is back).

## Problem

Founder direction, 2026-10-14: prose rules do not hold at scale, and GPP exists to make the
right path systematic. An evaluation against Anthropic's "Redesigning source control"
write-up (source control as an API, optional working copies, few refs) found that every DPF
thread gets a full worktree, a branch and a dependency install. That includes review,
diagnosis and research threads that never write. `D:\DPF-source-root` carries 402
registered worktrees and 1,556 local branches.

On source `804ca0150b3` (origin/main, 2026-10-14), four facts make this a structural gap
rather than a behavioural one:

1. **No read-only work shape.** `apps/web/lib/work-management/work-shapes.ts` registers
   delivery, standing, orchestration and acceptance shapes. None is for reviewing,
   diagnosing or researching source.
2. **Provisioning has no capability of its own.** `plan_workroom_worktree` and
   `claim_workroom_scope` require `work_capsule_write` (`apps/web/lib/tak/agent-grants.ts`
   `TOOL_TO_GRANTS`). The §7.1 class `write-internal`
   (`WORK_SHAPE_CAPABILITY_GRANTS`, `room-turn-authority.ts`) bundles that grant with the
   evidence writes. A shape cannot admit evidence writes without also admitting worktree
   planning.
3. **Room grants do not reach external callers.** `roomAuthorizesTool` narrows only
   in-portal coworker turns. The `/api/mcp/v1` route sets no `roomAuthority`, so an
   external CLI's call is never narrowed by the room it works in. A room with no declared
   grants admits everything (`roomAuthorizesTool` returns true for `null`).
4. **Worktree creation is client-side, binds afterwards and fails open.**
   `packages/dpf-skill-pack/hooks/worktree-create.mjs` runs `git worktree add`, then binds
   through `adopt_worktree`, warning on any failure and falling back to a nested
   `.claude/worktrees/` location. The bind library is imported relative to the plugin file
   (`../../../scripts/lib/workroom-bind.mjs`). In the installed plugin cache that path
   does not exist, so **the installed hook has never bound a worktree**: it always prints
   "binding unavailable". Measured 2026-10-14: 5 of the last 40 worktrees in the root
   clone carry a claim marker. `scripts/new-dev-worktree.sh` creates worktrees with no
   binding at all.

## Objectives and acceptance

**OBJ-WPG-1:** Read-only work has a governed shape, and a room on that shape cannot reach
worktree provisioning from either the portal or an external client.

**OBJ-WPG-2:** Worktree provisioning is its own capability in the GPP vocabulary. What
delivery shapes and standing principals can reach stays the same.

**OBJ-WPG-3:** Provisioning is admitted and bound before the worktree exists, and fails
closed. The only override is the operator break-glass for an unreachable platform, and it
never overrides a refusal.

**OBJ-WPG-4:** The effect on the worktree estate is measured.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-WPG-1 | OBJ-WPG-1 | `source-inquiry@1.0.0` is registered with `grants: ["tool:read"]`. Its stages declare only the source-read tools (`read_source_at_version`, `search_source_at_version`, `list_source_directory`, `read_project_file`). It passes `validateWorkShape`, the C-2 guard and the stage-tool parity test. |
| AC-WPG-2 | OBJ-WPG-1 | A GPP reach test (C-9 class, `worktree-provision-reach.test.ts`) proves that, for a `source-inquiry` room, `roomAuthorizesTool` is false for `plan_workroom_worktree`, `claim_workroom_scope`, `adopt_worktree` and their legacy aliases. It also proves that the server admission refuses all three with `worktree_provision_not_admitted` when an external caller targets that room, or when that room is the caller session's live room. |
| AC-WPG-3 | OBJ-WPG-2 | A new grant `worktree_provision` is in the grant catalog. `plan_workroom_worktree`, `plan_capsule_worktree`, `claim_workroom_scope` and `claim_capsule_scope` require it. The class `worktree-provision` resolves to it. `write-internal` keeps its five grants and no longer satisfies those tools. |
| AC-WPG-4 | OBJ-WPG-2 | The C-2 test (`work-shape-grants-resolve.test.ts`) and a reach snapshot show that, for every delivery shape, the set of catalog tools that `roomGrantsFromWorkShape` admits is identical before and after. The resolved grant set differs only by `worktree_provision`. |
| AC-WPG-5 | OBJ-WPG-2 | A principal parity test proves that every in-code principal grant list holding `work_capsule_write` (agent registry, hardcoded coworker grants, OAuth scope bundles, workroom session token, ephemeral ship token, source registry) still satisfies `worktree_provision`. `GRANT_IMPLICATIONS` maps `work_capsule_adopt` to `worktree_provision` one way, so DB-held adopt grants keep their reach. |
| AC-WPG-6 | OBJ-WPG-3 | Hook test, delivery or unshaped room: the hook calls the admission and bind (`adopt_worktree` with the planned path) first, then `git worktree add`, then writes the claim marker, then prints the path. The order is asserted through injected effects. |
| AC-WPG-7 | OBJ-WPG-3 | Hook test, refused: no `git worktree add` runs, the exit is non-zero, and stderr names the refusal code, the room, and the source-read tools to use instead. The nested `.claude/worktrees/` fallback is removed. |
| AC-WPG-8 | OBJ-WPG-3 | Hook test, platform unreachable (no token, network error or timeout): the hook refuses. With `DPF_WORKTREE_BREAK_GLASS=<reason>` set, it creates the worktree, writes a `dpf-workroom-pending.json` marker carrying the reason (never the claim marker) and says so on stderr. Break-glass never applies to a refusal. |
| AC-WPG-9 | OBJ-WPG-3 | The hook loads the provisioning library from the repository's main root (`<mainRoot>/scripts/lib/worktree-provision.mjs`). For a repository without it (not DPF source), creation is plain `git worktree add` and unchanged. `scripts/new-dev-worktree.sh` runs the same library in the same order. |
| AC-WPG-10 | OBJ-WPG-4 | On the dev install, record as evidence the new worktrees per day for the 7 days before release and the 7 days after, plus the share of rooms created on `source-inquiry`. |
| AC-WPG-11 | OBJ-WPG-1, OBJ-WPG-2, OBJ-WPG-3 | `docs/architecture/gated-permissions-process.md` (§7.1 table, Annex A rows) and `docs/architecture/branch-and-worktree-runbook.md` (the read-only path and the break-glass path) are updated in the same branch. |

## Research

The standards and comparable implementations considered:

- **Anthropic, "Redesigning source control".** Reads are served by an API, working copies
  are optional, and long-lived refs are few. *Adopted:* read-only work reads through the
  existing source-read tools and gets no working copy. *Not adopted here:* replacing git
  worktrees for writers. That is a larger change and is not needed to close this gap.
- **Kubernetes admission webhooks, `failurePolicy: Fail` vs `Ignore`.** An admission
  controller either fails closed when the webhook is unreachable, or ignores it. Security
  admission uses `Fail`, with a documented operator escape hatch (removing the webhook
  configuration). *Adopted:* H1 is `Fail` plus a named, recorded break-glass. *Rejected:*
  `Ignore` (H2), which is today's behaviour and the cause of the 35% unbound rate
  (BI-0B292D84).
- **Fine-grained permission splitting (Kubernetes RBAC verbs, GitHub fine-grained PAT
  `contents:read`/`contents:write`, AWS IAM actions).** A capability that creates
  resources is separated from the ones that read or annotate them, so a read-only role
  holds no create verb. *Adopted:* `worktree_provision` is a distinct grant, not a renamed
  bundle (option A) or a shape allowlist in the handler (option C). The grant-catalog
  precedent is `workroom_evidence_write`, split out of `work_capsule_write` with a one-way
  implication.

## Existing substrate and design

No new table, enum value, tool or agent role. One new grant key, one new §7.1 class and
one new work shape, all declarations in existing registries.

### 1. The read-only shape

`source-inquiry@1.0.0` is added to the work-shape registry (a new
`source-inquiry-shape.ts`, merged into `ALL_SHAPES` like the other shape modules):

- `triggers: ["claim"]`, `grants: ["tool:read"]`, `collaborationShape: null`.
- Stages: `inquire` (author reads source through the four source-read tools) and
  `answer` (author records the answer, a finding or a backlog item). Each stage declares
  `tools` with the source-read tools only.
- Stop conditions: success when answered. On failure, when the work turns out to need a
  change, the room stops with `awaiting-input` and the author claims the item with a
  delivery shape. That claim is the only route to a worktree.

A read-only room is created with the existing `create_workroom` (or `adopt_worktree`)
`workShape: "source-inquiry@1.0.0"` property. No new tool is needed.

### 2. The capability split (DI-C1731313EB9B)

- `grant_catalog.json`: add `worktree_provision` ("Plan, claim or bind a source worktree
  and branch for a Workroom").
- `TOOL_TO_GRANTS`: `plan_workroom_worktree`, `plan_capsule_worktree`,
  `claim_workroom_scope`, `claim_capsule_scope` → `["worktree_provision"]`, and the same in
  the work-capsules pack's grant map. `adopt_worktree` keeps `work_capsule_adopt`, which no
  room surface carries, so it stays unreachable inside every room. It is gated for
  external callers by the admission in §3.
- `GRANT_IMPLICATIONS`: `work_capsule_adopt → worktree_provision` (one-way).
- `WORK_SHAPE_CAPABILITY_GRANTS`: add `"worktree-provision": ["worktree_provision"]`.
  `write-internal` is unchanged.
- `DELIVERY_ACTIVITY_GRANTS` adds `"tool:worktree-provision"`. This is a make-explicit
  revision under GPP §2.1.1: the reachable tool set of each delivery shape is unchanged, so
  the shapes keep `1.0.0` and pinned rooms need no rebind. AC-WPG-4 holds the claim.
- Principal grant lists that carry `work_capsule_write` without `work_capsule_adopt`
  (`WORKROOM_SESSION_SCOPES`, `EPHEMERAL_SHIP_SCOPES`) add `worktree_provision`
  explicitly, so their reach is unchanged. AC-WPG-5 guards every such list.

### 3. Server-side admission

A pure module `apps/web/lib/work-capsules/worktree-provision-admission.ts`:

```text
admitWorktreeProvision({ rooms: [{ capsuleId, workShapeRef }] }) ->
  { admitted: true, unshaped: boolean } |
  { admitted: false, code: "worktree_provision_not_admitted" | "unknown_work_shape", capsuleId, workShapeRef }
```

- A shape is resolved with `getWorkShapeVersion`. Its surface is
  `roomGrantsFromWorkShape(shape.grants)`. It admits provisioning when
  `grantsSatisfyRequirement(["worktree_provision"], surface)` holds: the same resolver the
  in-portal turn uses, so one rule serves both paths.
- An unknown or unresolvable shape ref refuses (fail closed).
- An unshaped room (no `workShape`) is admitted and reported as `unshaped` for the measure.
  Closing gap 4 (an unshaped room admits everything) is a separate item, because it
  changes every legacy room.

It is called in the handlers of `plan_workroom_worktree` and `claim_workroom_scope` (the
target room) and `adopt_worktree` (the branch's existing room, plus every live room held
by the caller's `sessionRef`). It runs before any write. A refusal is an ordinary typed
tool error with the source-read tools named in `nextAction`. External callers are gated
here even though no `roomAuthority` reaches them.

### 4. Bind-before-create, failing closed (DI-F603138224BB)

`scripts/lib/worktree-provision.mjs` (new, built on `workroom-bind.mjs`) exposes one
function, `provisionWorktree({ mainRoot, plan, env, effects })`:

1. `plan` = canonical target and branch (`planWorktree`, unchanged).
2. Resolve MCP access. If absent or unreachable, go to step 6.
3. Call `adopt_worktree` with the planned path and branch and the session's `sessionRef`.
   The server runs §3. A refusal returns `{status: "refused", code, message}` and stops.
   No worktree is created.
4. `git worktree add` (existing branch or `-b <branch> origin/main`).
5. Write the claim marker into the new worktree's git dir and return the path.
6. Unreachable: refuse, unless `DPF_WORKTREE_BREAK_GLASS` holds a non-empty reason. With
   it, create the worktree, write `dpf-workroom-pending.json` (reason, time, branch,
   sessionRef) and report it on stderr. The claim guard treats a pending marker as unbound,
   and the estate watch (BI-328AE7BE) reconciles it once the platform is back.

If step 4 fails after step 3 bound the room, the hook exits non-zero. The bound room
stays, and a retry reuses it because `adopt_worktree` is idempotent per branch.

`worktree-create.mjs` resolves the main root, then dynamically imports
`<mainRoot>/scripts/lib/worktree-provision.mjs`. If that file does not exist, the
repository is not DPF source and the hook does a plain `git worktree add`, so other
repositories are unaffected. The nested fallback is removed. Every outcome goes to
stderr, and stdout carries only the path.

`scripts/new-dev-worktree.sh` calls the same library through `node`, so the manual and
automatic paths cannot diverge.

## Out of scope (filed separately)

- An unshaped room admits every tool (gap 4). It needs its own migration and decision.
- Raw `git worktree add` run by an agent through a shell tool bypasses both the hook and
  the script. A PreToolUse guard should route it to the same library.
- Merged-branch reaping (BI-88D75BA3), the platform-owned worktree base (BI-0B2F0546) and
  the estate watch (BI-328AE7BE).
- Stage-level provisioning bindings for delivery shapes (delivery shapes bind at shape
  level today, GPP Annex A).

## Ordered delivery and verification

1. Capability split and the admission module, test-first: the C-2 snapshot (AC-WPG-4),
   principal parity (AC-WPG-5) and admission unit tests.
2. `source-inquiry@1.0.0` and the reach test (AC-WPG-1, AC-WPG-2).
3. Handler wiring for the three tools, with handler tests for external callers.
4. `worktree-provision.mjs`, then the hook and `new-dev-worktree.sh` (AC-WPG-6 to
   AC-WPG-9).
5. Documentation (AC-WPG-11).
6. After release, the 7-day measure (AC-WPG-10).

Run affected unit tests and typecheck, `pnpm gate:local --committed`, then
`pnpm run pregate`.

## Risks and rollback

- **A principal loses provisioning it had.** Guarded by AC-WPG-5 and the adopt
  implication. Rollback: revert the `TOOL_TO_GRANTS` rows. The grant key is additive.
- **The hook blocks worktree creation when MCP is down.** This is intended. The
  break-glass is the recovery path, and an operator sets it explicitly. Rollback: revert
  the hook to the previous file.
- **A session holding a stale read-only room is refused a delivery worktree.** The refusal
  names the room. Ending it, or claiming the item with a delivery shape, clears it.

## Backlog coverage

Parent BI-D1FB8C4D covers OBJ-WPG-1 to OBJ-WPG-4. Follow-ups are filed for the
out-of-scope items above. No protected delivery or live acceptance is claimed by this
document.
