# Governed rebind of a live Workroom to a new work-shape version

- **Backlog:** BI-CB5C0DCE · Epic EP-B932453F
- **Unblocks:** BI-EBF0F6EE (branch `feat/standing-room-read-tools`, held)
- **Doctrine:** kernel decision DI-E4DAF14D9343 (bump-and-rebind, margin 0.80); GPP working draft 0.2 §2.1.1 ([gated-permissions-process.md](../../architecture/gated-permissions-process.md))
- **Status:** design

## 1. Problem

A Workroom pins its activity shape as `key@version` inside `scopeClaims`
([workroom-shape-claim.ts](../../../apps/web/lib/work-management/workroom-shape-claim.ts)).
`resolveWorkShapeClaim` returns `null` when the pinned version differs from the
one version the registry holds (`getWorkShape(key)` in
[work-shapes.ts](../../../apps/web/lib/work-management/work-shapes.ts)). So the
moment a shape's version is bumped, every live room on it stops resolving and
the drive can no longer plan for it. Nothing tells the owner, and nothing
re-points the room in a governed way.

GPP §2.1.1 needs both sides of that:

- **Narrowing** a binding, or making explicit a capability the envelope
  already admits, may apply to pinned work in place.
- **Widening** a binding takes a new binding version and a fresh gate
  decision.

BI-EBF0F6EE is a widening: it declares four new read tools on the
pull-request-flow, contributor-intake, vendor-renewal and payables stages. It
is held until a widening can land without either stopping those rooms or
reaching them without a decision.

## 2. What already exists (grounding)

| Need | Existing substrate | Use |
|---|---|---|
| Re-point a room's claim | `adoptionScopePatch` / `replaceShape` in [scope-input.ts](../../../apps/web/lib/work-capsules/scope-input.ts), compare-and-set via `scopeWriteWhere`, audit via `scopeChangeEvidence` | Reuse as the write. No new column, no new table. |
| Record a gate decision on a room | `decision-record` stage evidence and the stage decision control (BI-DA85D37B, [workroom-stage-decision.server.ts](../../../apps/web/lib/work-management/workroom-stage-decision.server.ts)) | Reuse the evidence kind and the authority check. |
| Tell an owner something waits on them | drive `attention` plans with `attentionPrincipalRef` | Reuse the attention projection. |
| Accountable owner | room owner, else org accountable owner (DI-A76F0C10EF14, BI-78B4116A) | The rebind decider. |
| Stage tools / grants / evidence | `WorkShapeStage.tools`, `stageDeclaredTools`, `stage-tool-parity.test.ts` (BI-43C3E914) | The diff reads these. |

The only net-new pieces are a retained prior-version registry, a binding diff,
one governed action over the existing write, and its two entry points.

## 3. Research & Benchmarking

| System | How a running instance meets a new definition version | DPF adopts | DPF rejects |
|---|---|---|---|
| **Temporal** worker versioning | A workflow is *pinned* to the build it started on, or set to *auto-upgrade*. Pinned executions finish on their version; a separate operation moves them. | Pinned is the default. A room cycle in progress finishes on the version it opened with. | Auto-upgrade as a default. Under GPP it would widen reach with no decision. |
| **Camunda 8** process instance migration | Running instances move between definition versions under an explicit *migration plan* that maps element ids. The plan is validated before it runs, and unmapped active elements refuse. | An explicit, validated plan: stages map by stage key. A stage that is mid-flight refuses the rebind rather than being remapped. | Arbitrary element remapping. A stage keeps its key across versions, or it is a different stage. |
| **AWS IAM** managed policy versions | Old versions are kept (up to five). Changing the default version is an explicit act, and attachments follow the default. | Old versions stay resolvable after a bump, so pinned rooms keep running until someone decides. | Attachments silently following the new default. That is the auto-upgrade case. |

**Standard followed:** semantic versioning (semver 2.0.0) for `version`, and
GPP §2.1.1 for which changes need a decision. **Deviation:** none.

## 4. Design

### 4.1 Prior versions stay resolvable

`work-shapes.ts` gains `WORK_SHAPE_PRIOR_VERSIONS`. These are frozen
definitions of superseded versions, and a bump moves the old definition there
in the same change. Three functions use it:

- `getWorkShapeVersion(key, version)` resolves the current version or a prior
  one.
- `resolveWorkShapeClaim` resolves both current and prior pins, so a bump never
  silently stops a room.
- `normalizePersistedScope` still accepts only the **current** version, so
  creating a room or adopting a claim cannot pin a superseded version.

A parity test asserts that every prior version has the same key as a current
shape, a strictly lower semver, and passes `validateWorkShape`.

### 4.2 Binding diff

`diffWorkShapeBinding(from, to)` returns a per-stage diff, matched by stage
key, and one classification.

| Change | Class |
|---|---|
| Tool added to a stage, stage added, accountable principal changed, `governed-decision` advance becomes `status-change`, evidence kind replaced | **widening** |
| Tool removed, stage removed, `status-change` becomes `governed-decision`, title or condition text only | **narrowing** |
| No stage-level change | **unchanged** |

Any widening row makes the whole diff a widening. The classifier is a pure
function with a table test.

### 4.3 The governed action

`rebindWorkroomShape({ capsuleId, toVersion, actor, rationale, dryRun })` runs
in this order:

1. **Authority.** The actor is the room's accountable owner, or holds
   `manage_platform`. This is the same check the stage decision control uses.
2. **Target.** `toVersion` must be the registry's current version of the
   room's own shape key, and higher than the pinned version. A downgrade or a
   change of key is refused.
3. **In-flight guard.** If a stage is dispatched and not yet receipted, the
   rebind is refused with `stage_in_flight`. This follows Camunda: an active
   element is never remapped. The owner retries after the run settles.
4. **Diff.** Compute it. `dryRun` returns the diff and the classification and
   writes nothing.
5. **Decision.** A widening requires a non-empty `rationale`. The actor's act
   is the fresh gate decision GPP asks for. It is recorded as `decision-record`
   evidence on the room, carrying the from/to refs, the diff and the
   rationale. A narrowing records the same evidence without requiring a
   rationale.
6. **Write.** Use `adoptionScopePatch` with the new ref, behind
   `scopeWriteWhere` compare-and-set, with an activity `workshape-rebound`
   whose payload is `scopeChangeEvidence`.

**Receipts.** Stage evidence is keyed by stage. A stage whose binding is
unchanged keeps its receipts for the cycle. Phase 1 verifies the cycle-record
behaviour in `room-cycle-store.ts` (`cycleKey` embeds `key@version`). The
invariant under test is that **no stage whose binding is unchanged re-runs
because of a rebind**. If the cycle key would force a re-run, the rebind takes
effect at the next cycle boundary instead, and the test pins whichever
behaviour holds.

### 4.4 Telling the owner

When the drive meets a room pinned to a prior version, it plans an
`attention` row with reason `awaiting_rebind` for the room's accountable
principal. The room keeps running on its pinned version (§4.1); the attention
only tells the owner a decision is waiting.

The room page shows one line, for example "A newer version of this activity is
available (1.0.0 → 1.1.0, widens 2 stages)". The diff is behind a disclosure,
and **Rebind** sits next to it. This is the progressive-disclosure pattern
asked for in BI-D96DB999, and it reuses the `WorkroomStageDecision` control
layout.

### 4.5 Entry points

- **Portal:** a server action on the room page, as in §4.4.
- **MCP:** a `rebind_workroom_shape` tool. It needs write scope, has a
  `dryRun` parameter, and uses the same server function and authority. A
  token's grant is the necessary first condition (GPP C-4); the authority
  check in step 1 is still the gate. With `dryRun` false it is not advise-safe,
  so it is hidden in advise mode (AGENTS.md §6).

## 5. Acceptance criteria

1. Bumping a shape version leaves every live room on the prior version
   resolving and driving. Test: registry with a prior version, plus the drive
   plan for a pinned room.
2. `diffWorkShapeBinding` classifies each change row in §4.2 as stated (table
   test).
3. Rebind refuses each of these: not the owner and no `manage_platform`;
   target not current; downgrade; key change; stage in flight; a widening
   without a rationale. Each refusal has its own code.
4. A successful rebind writes the claim through compare-and-set and records
   `decision-record` evidence plus a `workshape-rebound` activity. A concurrent
   scope change wins and the rebind reports a conflict.
5. A rebind does not re-run a stage whose binding is unchanged (§4.3).
6. A room pinned to a prior version shows the `awaiting_rebind` attention to
   its accountable principal, and the one-line notice plus diff disclosure on
   its page.
7. The `rebind_workroom_shape` MCP tool returns the same diff on `dryRun`,
   and the tool-surface baseline records its reason.
8. Live: BI-EBF0F6EE bumps its four shapes to 1.1.0; the owner rebinds the
   four rooms from the portal; their next cycle pins the new stage tools.

## 6. Out of scope

- Bulk rebind of many rooms in one decision. Per-room is the gate GPP names;
  bulk can follow if four-at-a-time proves to be toil.
- Delivery shapes (`delivery-*`). They bind at claim time and have no live
  cycles to migrate.
- Auto-rebinding narrowings. GPP permits a narrowing to apply in place, but
  the platform still records who applied it. Revisit this once C-6 reach
  reconciliation runs mechanically.
