---
status: draft
---

# GPP Phase 2: shadow permits, then per-binding enforcement

| | |
|---|---|
| Date | 2026-10-01 |
| Design | [GPP model to execution](../specs/2026-10-01-gpp-model-to-execution-design.md), §5.0 adoption constraints, §5.2 permit, §5.3 complete mediation, §5.4 rollout, §5.6 permit integrity, §8 Phase 2 |
| Prior phase | [GPP Phase 1: see and ratchet](2026-10-01-gpp-phase-1-see-and-ratchet.md). PR-A #5876 and PR-B #5880 are merged. |
| Epic | EP-B932453F |
| Backlog | BI-69415B68 (slice 2), BI-45F9CB7A (enforcement follow-up) |
| Decisions | DI-2DE3951FBB28 (opaque DB-backed permit first, signed encoding later); DI-6D5D686464DC (shadow-first, earn enforce) |
| Standard | [GPP](../../architecture/gated-permissions-process.md) C-5, C-7, C-8, C-9; Annex A |

## Outcome

A gate that admits an outward, authority or irreversible (O/A/I) call **mints a permit**. The
reference monitor **verifies the permit and records a verdict** for every O/A/I call under a
binding. Until an individual binding is promoted by a recorded decision, the verdict never changes
the call's outcome. Build Studio's plan→build paths converge on **one transition function**, and
that function keeps each path's current gate behaviour until the C-8 enforcement decision is made.

Phase 2 is honest about what it is not:

- On this development install, agents can read the source and reach the database. A permit forgery
  is therefore **detected, not prevented** (§5.0 item 4, §5.6). Prevention depends on key custody
  and on agent runtimes that hold no database credentials. Those are deployment properties, and
  Annex A reports them per install.
- Stage-scoped permits that travel across several calls depend on compiled binding records, which
  arrive with the Phase 3 compiler. Phase 2 bindings are a small, hand-declared table limited to gates
  that already exist and already emit decisions.

## Scope and staging

Phase 2 ships as **four PRs**. Each one is revertable on its own, and each one passes the local-CI gate
and the merge queue on its own.

| PR | What it does | Changes a call outcome? | Touches Build Studio? |
|---|---|---|---|
| **PR-C** | Permit model and migration; minting at the gates that exist; monitor records a shadow verdict | Never | No |
| **PR-D** | MAC handle (`gpp1.<permitId>.<keyId>.<mac>`), `paramHash` binding, sealed-lineage check; forgery and mismatch recorded | Never | No |
| **PR-E** | Per-binding enforcement mode; promotion only by a recorded decision; shrink-only shadow list; default stays shadow | Only for a binding promoted by a recorded decision. **None is promoted in this PR.** | No |
| **PR-F** | One Build Studio plan→build transition function used by all five paths; each path keeps its current gate behaviour; C-8 enforcement on `save_phase_handoff` behind the recorded decision | No, until the separate C-8 decision | Yes, as a defect fix (C-8, BI-45F9CB7A) |

Order: PR-C → PR-D → PR-E. PR-F depends on PR-A and on PR-B's live shadow evidence, but not on PR-C,
PR-D or PR-E. It can be built in parallel and merged in any order relative to them.

## Constraints (from the founder, binding on every PR)

1. **No binding means unchanged behaviour.** A tool with no binding is recorded as `ungoverned` and runs
   exactly as it does today. Neither a binding nor the monitor may ever demand a gate that is not
   implemented. The binding table refuses an entry whose gate has no resolver (§5.4 ordering).
2. **Critical calls only.** Permits apply only to O/A/I tools (`ToolDefinition.consequence` ∈
   `outward | irreversible | authority`, `apps/web/lib/tool-consequence.ts`) and to C-5 combinations.
   Read and internal-write tools get no permit, no verdict and no new latency.
3. **Build Studio changes are defect fixes only.** PR-C, PR-D and PR-E do not touch Build Studio files.
   PR-F is the only Build Studio change. It fixes the C-8 defect, preserves every path's current
   outcome, and is revertable on its own.
4. **The permit is transaction-useful and hard to fabricate.** The handle carries a MAC over the row's
   claims. O/A/I claims include the exact-call `paramHash`. The permit id is forwarded to the handler
   and written onto the audit row, so the downstream effect can cite it. In development, forgery is
   detect-not-prevent (see Outcome).
5. **Migrations are forward-only and apply against any data state.** Phase 2 migrations only add new
   tables, new enums and nullable columns. They need no backfill and alter no existing column.

## Facts this plan is built on (origin/main `bd41fb3f3`, 2026-10-01)

Every path and symbol below was read on `origin/main`.

**Mediation boundary**

- `governedExecuteTool` (`apps/web/lib/mcp-governed-execute.ts`) is the reference monitor. Its order:
  1. `classifyConsequentialTool`
  2. the human-capability check
  3. the coworker authority gate (`enforceCoworkerToolAuthority`, which yields
     `approvedAuthorityEnvelopeId` and `authorityDecisionId`)
  4. pre-tool lifecycle hooks (`runPreToolHooks`)
  5. `enforceTakPreexecution` (the alignment gate, giving `alignmentDecision.interactionId`)
  6. consequential receipt reservation
  7. `callExecuteTool` → `executeTool`
- `executeTool` is at `apps/web/lib/mcp-tools.ts:368`. When the monitor calls it, the monitor passes
  `governedSource` in the context (`ToolExecutionContext`, via `AuthorizedSurfaceToolExecutionContext`
  in `apps/web/lib/coworker/authorized-surface-execution-types.ts`). A direct caller does not, so the
  presence of `governedSource` tells a monitor call from an unmediated one.
- Lifecycle hooks are the existing shadow-first extension point. `registerServerToolGovernanceHooks`
  (`apps/web/lib/governance/register-tool-governance-hooks.ts`) registers the decision-routing,
  completion-evidence and workroom-shape hooks. The workroom-shape hook
  (`workroom-shape-governance-hook.ts`) is the model for a shadow audit that "cannot become a denial".
- `/api/mcp/v1` `handleToolsCall` (`apps/web/app/api/mcp/v1/route.ts`) reads `params.name` and
  `params.arguments` only. **`params._meta` is ignored today.**

**Consequence and receipts**

- `classifyConsequentialTool` (`apps/web/lib/tak/consequential-tool-policy.ts`) marks every
  side-effecting tool with a declared consequence as `consequential`. Phase 1's map reported 65
  critical tools.
- Consequential calls already reserve a `ToolExecutionReceipt` before the side effect
  (`apps/web/lib/tak/tool-execution-receipt.ts`).

**Signing pattern to reuse** (no new cryptographic dependency)

- `apps/web/lib/coworker-service-catalog/delegation-receipt.ts` and `apps/web/lib/attention/reach-link.ts`
  both use:
  - HMAC-SHA256 over `canonicalJson` (`packages/integration-shared/src/canonical-json.ts`)
  - a key id
  - `timingSafeEqual` after a length check
  - **no fallback constant**, and a `canSign…()` probe so a missing secret is a recorded state, not
    an outage

**Exact-call fingerprints already exist, in two forms**

- `fingerprintCoworkerInput` (`apps/web/lib/govern/authority/coworker-authority-decision.ts`): SHA-256
  over a `localeCompare`-sorted canonicalisation.
- `digestPayload` (`tool-execution-receipt.ts`): scrypt.
- `delegation-receipt.ts` records why `localeCompare` canonicalisation is unsafe for signing: it is
  host-locale dependent. `paramHash` therefore uses `canonicalJson`, and PR-D adds no third
  canonicaliser.

**Approval and projection substrate**

- `CoworkerActionEnvelope` (`packages/db/prisma/schema/ai-coworker.prisma`) carries
  `approvalBindingFingerprint`, `inputFingerprint`, `expiresAt` and `authorityDecisionId` →
  `AuthorizationDecisionLog`. Single use is a compare-and-set on `resolvedAt`
  (`reserveApprovedEnvelope` in `coworker-tool-authority-gate.ts`).
- The policy-authority projector's allow is persisted as an approved envelope
  (`resolve-policy-action-authority.ts`). Its `PROJECTABLE_ACTIONS` are the initiative-readiness review
  lanes (`INITIATIVE_READINESS_LANES`). **None of these is an O/A/I tool**, so the projector is a
  substrate to reuse, not a Phase 2 mint point.

**Decision ledger**

- `DecisionInteraction` (`packages/db/prisma/schema/decision-governance.prisma`) has `chainId`,
  `prevHash`, `chainEntryHash @unique` and `sealedAt`.
- `persistDecisionInteraction` (`apps/web/lib/decision-perspective/persistence.ts`) seals only when the
  caller passes `chain`.
- `evaluatePerspectiveGate` (`apps/web/lib/decision-perspective/evaluator.ts`) does **not** pass `chain`.
  The only `sealDecision` caller is `apps/web/lib/decision/kernel-consult-ledger.ts`.
- **So decisions from the Build Studio plan and ship gates and from the WWWD alignment gate are
  written unsealed today.** See Risk R1.

**Gates that exist and emit a decision before an O/A/I call**

- the WWWD × WSID alignment gate in the monitor (`runTakAlignmentGate`,
  `apps/web/lib/tak/alignment-tool-gate.ts`) → `DecisionInteraction.interactionId`
- an approved human checkpoint (`CoworkerActionEnvelope` approved, bound by
  `approvalBindingFingerprint`) → `AuthorizationDecisionLog.decisionId`

**Build Studio ship gate ordering**

- `evaluateBuildStudioShipGate` runs at `apps/web/lib/build/ship-on-review-approval.ts:224`.
- That is **after** `executeTool("deploy_feature")` at `:111`, and only when
  `getAutonomousPlaybookMode() !== "off"`.
- It cannot mint a permit for a call that has already happened. See Risk R4.
- The outward step is still guarded. `openBuildStudioPrAfterShip`
  (`apps/web/lib/build/auto-open-build-pr.ts:23`) opens a PR only when the build is in `ship`, and a
  withheld ship gate never advances it. What runs before the gate is `deploy_feature`, which in this
  flow only extracts and categorizes the sandbox diff, yet is classed `irreversible`
  (`build-lifecycle-pack.ts:134`). The open question is that tool's consequence class, not a bypass
  of the PR.

**Build Studio plan→build: five paths, not one**

| Path | Gates evaluated |
|---|---|
| `advanceBuildPhase` (`apps/web/lib/actions/build.ts:322`) | Approve Start, initiative readiness, `checkBuildPhaseGate`, dependency gate, `evaluateBuildStudioPlanAdvancementGate` (**blocking**, throws) |
| `POST /api/agent/build/advance-phase` (`apps/web/app/api/agent/build/advance-phase/route.ts`) | `checkBuildPhaseGate` and the plan-advancement gate (**blocking**, returns error) |
| `performPlanToBuildTransition` (`apps/web/lib/build/plan-to-build-transition.ts:246`, used by `build-review-handlers.ts` and `resume-pre-build-phase.ts`) | initiative readiness, phase gate, dependency gate, the plan-advancement gate. **Blocking only in autonomous `enforce` mode**; otherwise logs `autonomous_playbook_shadow` and fails open. |
| `save_phase_handoff` auto-advance (`apps/web/lib/mcp/packs/build-evidence-extra-pack.ts` ~:239-315) | `checkBuildPhaseGate` only; records `gpp-c8-transition-gate-skipped` (PR-B) |
| `build-on-plan-approval.ts:186` | Writes `phase: "build"` after `start_build` confirms the branch. Its only gate is upstream `enforceBuildInitiativeReadiness`. |

The PR-B shadow test file `build-evidence-extra-pack.c8-shadow.test.ts` already holds the skipped
enforcement test (`it.skip("enforcement (later): plan→build via save_phase_handoff is refused when the
WWMD gate refuses")`).

**Enums and work shapes**

- `DecisionScope { wwmd wwwd wsid }` exists (`packages/db/prisma/schema/work-coordination.prisma`) and is
  reused for the permit's `authority`.
- `WorkShapeStage.tools` and the shrink-only `KNOWN_STAGE_TOOL_GAPS`
  (`apps/web/lib/work-management/stage-tool-gaps.ts`) are the stage-capability substrate. Phase 2 does
  not change them.

## PR-C: shadow permits (mint at gate admit, record at the monitor, never refuse)

**Goal.**
- Introduce the permit row (§5.2 claim set) and a small declared binding table.
- Mint a permit when an existing gate admits an O/A/I call under a binding.
- Have the monitor record one verdict per O/A/I call:
  - `ungoverned` (no binding)
  - `valid`, `absent`, `expired`, `revoked`, `exhausted`, `tool-not-in-capabilities`
  - `unmediated` (reached through a direct `executeTool` call)
- Never refuse.

**C-0: schema audit first** (§5.2 says "schema audit first"; AGENTS.md §8).
- Before writing the model, record in the PR body why the permit is a new table rather than new columns
  on `CoworkerActionEnvelope`:
  - The envelope is a human-approval card. It has a NOT NULL `threadId` FK to `AgentThread`, plus
    `rationale` and `manifestActionId`.
  - A permit minted by the WWWD alignment gate has no approval card.
- The permit **reuses** the envelope's semantics and links to it, rather than copying them:
  - `approvalBindingFingerprint` → `envelopeId` FK
  - `inputFingerprint` → `paramHash`
  - `authorityDecisionId` → `AuthorizationDecisionLog`
- If the audit finds a fitter home, the PR follows the audit, not this plan.

**Files**

- `apps/web/lib/gpp/permit-claims.ts` (new): the `PermitClaims` type and `canonicalPermitClaims(row)`,
  using `canonicalJson`. Pure.
- `apps/web/lib/gpp/bindings.ts` (new): `GPP_BINDINGS`, the hand-declared Phase 2 bindings.
  - Each entry: `{ bindingId, version, gateKey, authority: "wwmd" | "wwwd" | "wsid", resolver, tools | toolPredicate, reason: "oai" | "c5" }`.
  - Seed:
    - `tak-alignment-admit@1` (WWWD; every O/A/I tool for which the monitor runs the alignment gate)
    - `human-checkpoint-admit@1` (escalation gate → approved envelope; every O/A/I tool)
  - No Build Studio binding (Risk R4). No C-5 binding: C-5 combinations are not computed on main
    (`critical-interaction-map.ts` says so). The `c5` reason exists in the type and has no entries.
- `apps/web/lib/gpp/permit-mint.ts` (new): `mintShadowPermit(...)`.
  - Writes a `GppPermit` row with:
    - `enforcement: "shadow"`
    - `maxUses: 1`
    - `expiresAt = now + 15 min`, mirroring `AUTHORITY_APPROVAL_TTL_MS`
    - a random `nonce`
  - Returns the permit id.
  - Fail-open: any error is logged, and the call proceeds with verdict `absent`.
- `apps/web/lib/gpp/permit-verdict.ts` (new):
  - `evaluatePermitVerdict(permitRow | null, call)`, pure: expiry, revocation, uses, tool membership.
  - `recordPermitObservation(...)`, which is audit-only by contract (a bare catch, as in the
    workroom-shape sink).
- `apps/web/lib/mcp-governed-execute.ts`:
  - After `enforceTakPreexecution` admits and before receipt reservation: if the tool is O/A/I and a
    binding matches, mint from the alignment `interactionId` or the approved envelope id.
  - Read `context.permitHandle` if one is supplied (an external client replaying a handle).
  - Evaluate the verdict, record the observation, and continue unconditionally.
  - Forward `gppPermitId` to `callExecuteTool` in `ToolExecutionContext` so the handler can cite it.
  - Write `gppPermitId` and `gppPermitVerdict` onto the `ToolExecution` row.
- `apps/web/lib/mcp-governed-execute-types.ts`: add `permitHandle?: string` to `GovernedExecuteContext`.
- `apps/web/lib/mcp-tool-types.ts`: add `gppPermitId?: string` to `ToolExecutionContext`.
- `apps/web/lib/mcp-tools.ts` (`executeTool`): when `context?.governedSource` is absent and the tool is
  O/A/I, record one `unmediated` observation, fire-and-forget. **No other change.** This gives AC-SHADOW-PERMIT
  coverage for direct sites 1–10 of the Phase 1 inventory without touching Build Studio files.
- `apps/web/app/api/mcp/v1/route.ts` (`handleToolsCall`): read
  `params._meta["io.opendigitalproductfactory/permit"]` when it is a string, and pass it as
  `context.permitHandle`. The change is additive, and clients that send nothing are unaffected.
- `apps/web/lib/gpp/critical-interaction-map.ts`: add `guards.permit: GuardMode`, which is `shadow`
  when a binding matches and `none` otherwise, so the map shows the new guard (OBJ-VISIBLE).
- `packages/db/prisma/schema/ai-coworker.prisma`: the new models and columns below.
- `docs/architecture/gated-permissions-process.md` Annex A: add a "Permit (Phase 2)" row with mode
  **shadow**.

**Schema and migration** (one new migration directory under `packages/db/prisma/migrations/`, forward-only)

```prisma
enum GppPermitEnforcement { shadow enforced environment }
enum GppPermitVerdict {
  ungoverned valid absent expired revoked exhausted
  tool_not_in_capabilities unmediated
  // PR-D adds: mac_invalid param_mismatch lineage_unsealed lineage_missing unsigned
}

/// Gate-minted permit (GPP §5.2). Phase 2: opaque DB-backed id (DI-2DE3951FBB28).
/// @dpf lifecycle=telemetry-bounded retention=365d categories=security-audit timeAxis=createdAt
model GppPermit {
  id                    String               @id @default(cuid())
  permitId              String               @unique            // "GPM-<uuid>"
  bindingId             String
  bindingVersion        Int
  shapeRef              String?                                 // "shape@version" when a Workroom shape binds
  stageKey              String?
  gateKey               String
  authority             DecisionScope
  gateDecisionId        String?                                 // DecisionInteraction.interactionId
  authorityDecisionId   String?                                 // AuthorizationDecisionLog.decisionId
  envelopeId            String?                                 // CoworkerActionEnvelope.id (human checkpoint)
  actorGaid             String?
  actorUserId           String
  actorAgentId          String?
  workroomId            String?
  subjectScope          String?
  capabilities          Json                                    // [{ tool, argConstraints? }]
  paramHash             String?                                 // PR-D populates
  enforcement           GppPermitEnforcement @default(shadow)
  notBefore             DateTime             @default(now())
  expiresAt             DateTime
  maxUses               Int                  @default(1)
  useCount              Int                  @default(0)
  nonce                 String
  parentPermitId        String?
  revokedAt             DateTime?
  keyId                 String?                                 // PR-D populates
  mac                   String?                                 // PR-D populates
  createdAt             DateTime             @default(now())
  envelope              CoworkerActionEnvelope? @relation(fields: [envelopeId], references: [id], onDelete: SetNull)
  observations          GppPermitObservation[]

  @@index([gateDecisionId])
  @@index([authorityDecisionId])
  @@index([envelopeId])
  @@index([workroomId, createdAt(sort: Desc)])
  @@index([expiresAt])
  @@index([createdAt])
}

/// One permit verdict per O/A/I call (monitor or unmediated direct call). Audit only.
/// @dpf lifecycle=telemetry-bounded retention=365d categories=security-audit timeAxis=createdAt
model GppPermitObservation {
  id              String           @id @default(cuid())
  permitRowId     String?
  bindingId       String?
  toolName        String
  verdict         GppPermitVerdict
  enforcement     GppPermitEnforcement @default(shadow)
  path            String           // "monitor" | "direct"; closed set, promoted to an enum if it widens
  toolExecutionId String?
  callerSite      String?          // direct path: route/agent/source hint, never parameters
  detail          Json             @default("{}")
  createdAt       DateTime         @default(now())
  permit          GppPermit?       @relation(fields: [permitRowId], references: [id], onDelete: SetNull)

  @@index([verdict, createdAt(sort: Desc)])
  @@index([bindingId, createdAt(sort: Desc)])
  @@index([toolName, createdAt(sort: Desc)])
  @@index([permitRowId])
  @@index([createdAt])
}
```

- `ToolExecution` gains `gppPermitId String?` and `gppPermitVerdict GppPermitVerdict?`, both nullable,
  with no default and no backfill.
- `CoworkerActionEnvelope` gains the back-relation `gppPermits GppPermit[]`. This is a relation field
  only, with no column.
- The migration contains:
  - `CREATE TYPE` for the two enums
  - `CREATE TABLE` for the two tables
  - `ALTER TABLE "ToolExecution" ADD COLUMN ... NULL` (twice)
  - the indexes and FKs, created `ON DELETE SET NULL`
- It reads no existing row and rewrites no column, so it applies on an empty schema, on live data and on
  a partially upgraded install alike.
- `path` must be a closed set (AGENTS.md §8). If review prefers it typed from the start, make it a
  Prisma enum `GppObservationPath { monitor direct }` in this same migration. Use the enum generator
  and recipe in `docs/architecture/data-model-stewardship-runbook.md`.
- **No migration step may rename or drop an existing column.**

**Tests** (`pnpm --filter web exec vitest run <files>`)

- `apps/web/lib/gpp/permit-verdict.test.ts` (new, pure):
  - absent, expired, revoked, exhausted, tool-not-in-capabilities, valid
  - Failing before: the module does not exist.
- `apps/web/lib/gpp/bindings.test.ts` (new):
  - Every binding names a `resolver` that resolves to an exported, implemented gate function (§5.4
    ordering: no binding for a gate that does not exist).
  - Every tool a binding names is O/A/I, or the binding's reason is `c5`.
  - No binding names an R or W tool.
- `apps/web/lib/mcp-governed-execute-permit-shadow.test.ts` (new; uses the existing
  `_setGovernanceForTests` seams). **This is the AC-SHADOW-PERMIT test.**
  1. "records a permit verdict for every O/A/I call under a binding and refuses none": an O/A/I tool
     under `tak-alignment-admit@1` with a stub alignment admit mints one permit, records `valid`, and
     returns exactly the stub `executeTool` result.
  2. "an O/A/I call carrying an expired / revoked / unknown handle still executes": the verdict is
     recorded, the call succeeds, and the result is byte-identical to a call with no handle.
  3. "an R or W tool records nothing and mints nothing" (OBJ-CRITICAL).
  4. "a tool with no binding behaves exactly as before": the result and the audit row are unchanged
     apart from `gppPermitVerdict = ungoverned` (OBJ-NODISRUPT).
  5. "mint or record failure never fails the call": a throwing sink still yields the tool result.
  - Failing before: no permit is minted or recorded.
- `apps/web/lib/mcp-tools.unmediated-observation.test.ts` (new): a direct `executeTool` of an O/A/I tool
  without `governedSource` records one `unmediated` observation. With `governedSource` set, it records
  none.
- `apps/web/app/api/mcp/v1/route.permit-meta.test.ts` (new): `params._meta[...permit]` reaches
  `governedExecuteTool` as `context.permitHandle`. A request without `_meta` produces the same
  `governedExecuteTool` arguments as today.
- Existing suites stay green unchanged:
  - `mcp-governed-execute.test.ts`
  - `mcp-governed-execute-alignment.test.ts`
  - `mcp-governed-execute-authorized-surface.test.ts`
  - `route.test.ts`
  - `route.write-safety.test.ts`
  - `lib/gpp/*`
- The migration applies through the build gate's migration step (§4 item 4).

**Rollout and shadow behaviour.**
- Every permit row is minted `enforcement: shadow`, and the monitor ignores the verdict when deciding
  the outcome.
- Latency applies only on O/A/I calls: one insert at mint and one insert per observation. These calls
  already pay for receipt reservation.
- R and W calls take no new code path beyond one `classifyConsequentialTool` result the monitor
  already computes.

**Rollback.**
- Revert the PR. The tables and columns stay in place, unused and harmless. Migrations are forward-only,
  so a revert never drops them. No code reads them once the PR is reverted.

**Satisfies:** OBJ-PERMIT (minted only at gate admit), OBJ-NODISRUPT, OBJ-CRITICAL, OBJ-VISIBLE (map
guard); AC-SHADOW-PERMIT.

## PR-D: MAC handle, paramHash binding and lineage (still shadow)

**Goal.**
- Make the permit useful to the transaction and hard to fabricate.
- Each permit gets the handle `gpp1.<permitId>.<keyId>.<mac>`, where
  `mac = HMAC-SHA256(key[keyId], canonicalJson(claims))` (§5.6).
- O/A/I claims bind `paramHash = SHA-256(canonicalJson({ tool, params }))`.
- The monitor recomputes and compares, and records each of these as a distinct verdict, still without
  refusing:
  - `mac_invalid`: an edited or invented row
  - `param_mismatch`: the handle was replayed with different arguments
  - `lineage_missing` / `lineage_unsealed`: the gate decision is absent or unsealed
  - `unsigned`: the install has no key

**Files**

- `apps/web/lib/gpp/permit-handle.ts` (new):
  - `signPermit(claims, { secret?, keyId? })`, `formatPermitHandle`, `parsePermitHandle`,
    `verifyPermitMac(row, handle)`, `canSignPermits()`.
  - These copy the `reach-link.ts` and `delegation-receipt.ts` pattern exactly:
    - `canonicalJson`
    - a length check, then `timingSafeEqual`
    - the secret read from `DPF_GPP_PERMIT_SECRET` and the key id from `DPF_GPP_PERMIT_KEY_ID`
  - **No fallback constant and no fallback to `AUTH_SECRET`**: a dedicated key is the custody boundary
    (§5.6), and sharing the session secret would widen who can mint. When it is unset,
    `canSignPermits()` returns false and permits are minted `unsigned`. That state is recorded, not an
    outage.
- `apps/web/lib/gpp/param-hash.ts` (new): `computeParamHash(toolName, params)` over `canonicalJson`.
  - It does not reuse `fingerprintCoworkerInput`, which is `localeCompare`-sorted (see Facts).
  - The divergence is recorded as a follow-up: converge the existing fingerprints on `canonicalJson`,
    in a separate BI, because changing them would invalidate live approval bindings.
- `apps/web/lib/gpp/permit-mint.ts`: populate `paramHash`, `keyId` and `mac`, and return the handle.
- `apps/web/lib/gpp/permit-verdict.ts`: add the verification order before the PR-C checks:
  1. parse the handle
  2. load the row by `permitId`
  3. MAC
  4. `paramHash` (O/A/I)
  5. lineage
  6. then PR-C's expiry, revocation, uses and tool checks
- Lineage loads `DecisionInteraction` by `gateDecisionId`:
  - missing → `lineage_missing`
  - `sealedAt == null` → `lineage_unsealed`
  - For a human-checkpoint permit, the lineage is `AuthorizationDecisionLog` plus the approved envelope.
    That record is not hash-chained, so it records `lineage_unsealed` with `detail.reason =
    "authorization-log-not-chained"`. See Risk R1 and the spec ambiguity notes.
- `apps/web/lib/mcp-governed-execute.ts`: when the gate mints in-monitor, return the handle in
  `result.governance.permit`, an additive field, so an external client can replay it in `_meta`.
  - The handle is also forwarded to the handler as `ToolExecutionContext.gppPermitId`. An outward handler
    may cite it downstream, for example in a PR body or a hive-contribution metadata field.
  - Each handler adopts this in its own PR. Phase 2 changes no handler.
- `apps/web/lib/mcp-governed-execute-types.ts`: add `permit?: { handle: string; verdict: string }` to
  `GovernedExecuteResult.governance`.
- `packages/db/prisma/schema/ai-coworker.prisma`: extend `GppPermitVerdict`.
- Annex A: the permit row states "MAC-verified, shadow; forgery detectable, not preventable, on installs
  where agents can read host secrets or write the database".

**Schema and migration.**
- One forward-only migration:
  - `ALTER TYPE "GppPermitVerdict" ADD VALUE` for `mac_invalid`, `param_mismatch`,
    `lineage_missing`, `lineage_unsealed` and `unsigned`.
  - Each value is guarded with `IF NOT EXISTS`, so a re-run on a partially applied install is a no-op.
- It adds no table and no column, because PR-C already created `paramHash`, `keyId` and `mac` as
  nullable columns.

**Tests**

- `apps/web/lib/gpp/permit-handle.test.ts` (new). **This is the AC-FORGERY test.**
  - "a permit whose row was edited fails MAC verification and is recorded as forged": mint, then mutate
    `capabilities` / `expiresAt` / `paramHash` on the row → `mac_invalid`.
  - "an invented row with a guessed handle fails": a row inserted without the key → `mac_invalid`.
  - "a missing key mints unsigned and never throws".
  - "key-id rotation: a handle signed under an old keyId verifies only while that key is configured".
  - Failing before: no MAC exists.
- `apps/web/lib/gpp/param-hash.test.ts` (new):
  - The hash is key-order independent.
  - Different arguments give different hashes.
  - It is locale independent (run under two `LANG` values).
- `apps/web/lib/mcp-governed-execute-permit-shadow.test.ts` (extend):
  - "a valid handle replayed with different arguments records `param_mismatch` and still executes".
  - "an unsealed gate decision records `lineage_unsealed` and still executes".

**Rollout and shadow behaviour.**
- Verdicts become more precise. Outcomes stay unchanged.
- Before PR-E is considered, the install operator sets `DPF_GPP_PERMIT_SECRET` through the normal
  secret path. The agent never handles it (AGENTS.md; the install identity is "credentials:
  operator-only").

**Rollback.**
- Revert the PR. The enum values stay and are unused. PR-C's verdicts continue.

**Satisfies:** OBJ-PERMIT (MAC over claims, exact-transaction binding, lineage to the ledger);
AC-FORGERY.

## PR-E: per-binding enforcement promotion (default stays shadow)

**Goal.**
- An individual binding can flip from shadow to enforced only through a recorded decision.
- Once a binding is enforced, an O/A/I call under it without a `valid` verdict is refused with a
  structured `permit_required` result naming the gate (§6 refusal semantics).
- Tools with no binding, and bindings still in shadow, behave exactly as before.
- **This PR promotes no binding.**

**Files**

- `apps/web/lib/gpp/binding-enforcement.ts` (new):
  - `GPP_BINDING_ENFORCEMENT: Record<bindingId, { mode: "enforced"; decisionId: string; ratifiedAt:
    string; evidenceRef: string }>`, which is **empty** at merge.
  - `KNOWN_SHADOW_BINDINGS`, a shrink-only list seeded with every PR-C binding id.
  - `resolveBindingMode(bindingId)`: returns `enforced` only when an entry exists.
  - The env `DPF_GPP_ENFORCEMENT=shadow-all` can force everything back to shadow. It can only lower
    enforcement, never raise it, so it is not the global switch §5.0 item 3 forbids.
- `apps/web/lib/gpp/binding-enforcement.test.ts` (new): the shrink-only ratchet.
  - Every binding in `GPP_BINDINGS` is in either `KNOWN_SHADOW_BINDINGS` or `GPP_BINDING_ENFORCEMENT`,
    never both.
  - A new binding must start in `KNOWN_SHADOW_BINDINGS`.
  - Every enforcement entry carries a decision id matching `^DI-[0-9A-F]{12}$` and a non-empty
    `evidenceRef`.
  - Only bindings whose tools are all O/A/I may appear in `GPP_BINDING_ENFORCEMENT` (§5.4).
- `apps/web/lib/mcp-governed-execute-types.ts`: add `"permit_required"` to `GovernedExecuteRejection`.
- `apps/web/lib/govern/authority/governed-rejection-disposition.ts`: add a disposition for
  `permit_required`. It is a hold, not a settled no: the remedy is to pass the gate.
- `apps/web/lib/mcp-governed-execute.ts`: after recording the verdict, if `resolveBindingMode` is
  `enforced` and the verdict is not `valid`, return
  `rejectionResult(toolName, "permit_required", <gate descriptor>)`. It writes the audit row and receipt
  exactly as the other rejections do.
- `apps/web/lib/mcp-tools.ts`: an enforced binding reached through a direct `executeTool` call **is not
  refused there in Phase 2**. Refusing at that point would break Build Studio sites 1–10.
  - Instead, `binding-enforcement.test.ts` refuses promotion of any binding whose tools still appear in
    `KNOWN_UNMEDIATED_EXECUTE_SITES` (`apps/web/lib/gpp/unmediated-execute-sites.ts`) or as a dynamic
    direct site.
  - So a binding is promotable only once every path to its tools passes the monitor. This satisfies
    §5.3 and the Phase 1 rule that rows 1–10 move behind the monitor only when their binding is enforced.
- `docs/architecture/gated-permissions-process.md`:
  - Annex A permit row: the mode is "per binding; all shadow" at merge.
  - Add the promotion criteria (below) as an informative note.

**Promotion procedure** (each promotion is its own small PR, revertable alone)

1. The binding has at least 14 days of `GppPermitObservation` evidence with zero `mac_invalid`,
   `param_mismatch` or `unmediated` verdicts it cannot explain.
2. A `principle_decide` (WWMD) decision ratifies the promotion and is recorded with
   `dpf-record-decision-outcome`. The DI id goes into the enforcement entry.
3. `DPF_GPP_PERMIT_SECRET` is configured on the install, so permits are not `unsigned`.
4. The binding's gate writes **sealed** decisions, or the decision explicitly accepts `lineage_unsealed`
   for that binding (R1).

**Schema and migration.** None.

**Tests**

- `apps/web/lib/mcp-governed-execute-permit-enforce.test.ts` (new). **This is the AC-ENFORCE test.**
  1. "a tool under an enforced binding is refused without a valid permit": a test-only override of
     `GPP_BINDING_ENFORCEMENT` enforces a fixture binding. A call without a handle returns
     `permit_required`, the stub `executeTool` is never called, and an audit row is written.
  2. "the same call with a valid handle executes".
  3. "tools without a binding behave exactly as before": the result is deep-equal to the pre-PR result
     for an R tool, a W tool and an unbound O tool.
  4. "`DPF_GPP_ENFORCEMENT=shadow-all` returns an enforced binding to shadow".
  - Failing before: the `permit_required` rejection does not exist.
- `binding-enforcement.test.ts`: red on a fixture that adds an enforcement entry without a DI id, or for
  a binding whose tool has a direct site.

**Rollout.**
- The enforcement table is empty at merge, so production behaviour is identical to PR-D.
- The first promotion is a separate PR, made under the procedure above.

**Rollback.**
- Revert the PR. To demote one promoted binding, revert its promotion PR. In an emergency, set
  `DPF_GPP_ENFORCEMENT=shadow-all`. That is an operator config change, never an agent action on
  production.

**Satisfies:** OBJ-CRITICAL, OBJ-NODISRUPT; AC-ENFORCE.

## PR-F: one Build Studio plan→build transition function (C-8)

**Goal.**
- Every code path that moves a build from `plan` to `build` calls one shared function.
- That function evaluates the transition's declared gate set and applies each path's declared mode.
- After this change, the WWMD gate cannot be skipped silently. Each path either evaluates it or records
  that it did not.
- Each path's outcome is unchanged in this PR.
- Enforcing the gate on `save_phase_handoff` is a separate, recorded decision, taken on PR-B's live
  `gpp-c8-transition-gate-skipped` counts.

**Grounding (AGENTS.md §1).**
- `apps/web/lib/build/plan-to-build-transition.ts` already calls itself the "single source of truth for
  the Build Studio plan→build phase transition" (its header comment, `plan-to-build-transition.ts:1-4`). PR-F **extends that module** rather than
  adding a parallel one.
- Its path-specific side effects stay with their callers:
  - build-branch initialisation and the failure tracker
  - Approve Start
  - `PhaseHandoff` documents
  - ephemeral ship tokens
- Only the gate set and the phase write move into the shared function.

**Files**

- `apps/web/lib/build/plan-to-build-transition.ts`:
  - Add `PLAN_TO_BUILD_GATE_SET`, the declared set: initiative readiness, structural phase gate,
    dependency gate and the WWMD plan-advancement gate.
  - Add `transitionPlanToBuild({ buildId, path, wwmdMode, userId, ... })`, which evaluates the set, applies
    `wwmdMode`, and performs the compare-and-set write `featureBuild.updateMany({ where: { buildId,
    phase: "plan" }, data: { phase: "build" } })`.
  - `wwmdMode` is one of:
    - `blocking`: `advanceBuildPhase` and the route, as today
    - `autonomous-mode`: `performPlanToBuildTransition`, as today. It blocks only under autonomous
      `enforce` and otherwise logs `autonomous_playbook_shadow`.
    - `not-evaluated-recorded`: `save_phase_handoff`, as today. It records
      `gpp-c8-transition-gate-skipped`. It does **not** call the gate, because calling it writes
      `DecisionInteraction` rows and starts voice synthesis, which Phase 1 ruled out as a shadow.
  - `performPlanToBuildTransition` keeps its signature and calls the shared function for its gate and
    write steps.
- `apps/web/lib/actions/build.ts` (`advanceBuildPhase`): for `plan → build` only, replace the inline
  phase-gate, dependency-gate and WWMD block plus the phase write with `transitionPlanToBuild({ path:
  "advance-build-phase", wwmdMode: "blocking" })`.
  - Approve Start, initiative readiness, the UX override, the handoff document, tokens and calendar
    events stay where they are.
  - A refusal keeps its current form: it throws on WWMD and returns `{ ok: false }` on the structural
    gates.
- `apps/web/app/api/agent/build/advance-phase/route.ts`: the same replacement for `plan → build`, with the
  same error responses.
- `apps/web/lib/mcp/packs/build-evidence-extra-pack.ts` (`save_phase_handoff`): for `plan → build`, call
  the shared function with `wwmdMode: "not-evaluated-recorded"`. The emitted event and the returned
  messages stay exactly as today.
- `apps/web/lib/build/build-on-plan-approval.ts:186`: route the `phase: "build"` write through the shared
  function with `wwmdMode: "not-evaluated-recorded"`, `path: "build-on-plan-approval"`.
  - This path runs after `reviewBuildPlan`'s own transition attempt. Today it writes the phase directly.
  - Recording the skip makes the fifth path visible, and its outcome stays unchanged.
- `apps/web/lib/gpp/direct-phase-writes.ts` (new) and `direct-phase-writes-ratchet.test.ts` (new):
  - A per-file, shrink-only count of direct `featureBuild` phase writes outside the transition modules,
    on the same pattern as `unmediated-execute-sites.ts`.
  - It fails when a new `phase: "build"` write appears outside `plan-to-build-transition.ts`.
  - Other transitions (review→ship, build→review, terminal) are listed as known and not yet governed.
    Review→ship has a WWMD ship gate, and is the next C-8 candidate (R4).
- Docs: GPP Annex A "Transition gate sets" row; spec §8 Phase 2 status.

**Schema and migration.** None.

**Tests**

- `apps/web/lib/build/plan-to-build-transition.single-path.test.ts` (new). **This is the
  AC-SINGLE-TRANSITION test.**
  - "every plan→build path calls transitionPlanToBuild": the shared function is spied, and each of the
    five entry points is driven with a passing build. Each yields exactly one call with its declared
    `path` and `wwmdMode`.
  - Failing before: four paths write the phase directly.
- `direct-phase-writes-ratchet.test.ts`: green on the branch, and red on a synthetic tree with an extra
  `phase: "build"` write.
- Behaviour preservation. These existing suites must pass **unchanged**:
  - `build-evidence-extra-pack.c8-shadow.test.ts` (the three active cases)
  - `build-evidence-extra-pack.test.ts`
  - the `plan-to-build-transition` and `resume-pre-build-phase` tests
  - `apps/web/lib/actions/build*.test.ts`
  - the advance-phase route tests

  Any needed edit to an existing assertion is a regression and blocks the PR.
- **C-8 enforcement step** (a separate PR after the decision, not in PR-F):
  - Un-skip `it.skip("enforcement (later): plan→build via save_phase_handoff is refused when the WWMD gate
    refuses")` in `build-evidence-extra-pack.c8-shadow.test.ts`.
  - Change `save_phase_handoff`'s `wwmdMode` to `blocking-soft`. The handoff is saved and the phase does
    not advance, so the tool returns `success: true` with the existing "gate blocked advance" message.
    No tool call fails, which keeps OBJ-NODISRUPT.

**Rollout.**
- No outcome changes in PR-F. UX check (AGENTS.md §4 item 3): on the canonical runtime, through the
  shared non-prod lease, drive one build plan→build via the Build Studio UI and one via
  `save_phase_handoff`. Confirm the same phases and activity events as before.

**Rollback.**
- Revert the PR. There is no schema change, and the Phase 1 shadow event continues.

**Satisfies:** OBJ-TRANSITION, OBJ-NODISRUPT; AC-SINGLE-TRANSITION. It also keeps AC-C8-SHADOW
satisfied.

## Tasks

### PR-C
- [ ] C-0 schema audit recorded in the PR body (new table vs. extending `CoworkerActionEnvelope`)
- [ ] `permit-claims.ts`, `bindings.ts` (two seeds; resolver-exists test), `permit-mint.ts`, `permit-verdict.ts`
- [ ] Prisma models, enums and `ToolExecution` columns; forward-only migration; `@dpf lifecycle` annotations
- [ ] Monitor: mint after alignment or approval admit; verdict recorded; `gppPermitId` forwarded; never refuses
- [ ] `executeTool`: `unmediated` observation when `governedSource` is absent and the tool is O/A/I
- [ ] `/api/mcp/v1`: `_meta` permit key read into `context.permitHandle`
- [ ] Map: `guards.permit`
- [ ] Tests listed under PR-C; existing monitor and route suites green unchanged
- [ ] Annex A row; local-CI gate; PR

### PR-D
- [ ] `permit-handle.ts` (HMAC, `canonicalJson`, `timingSafeEqual`, no fallback, `canSignPermits`)
- [ ] `param-hash.ts`; follow-up BI filed for converging the `localeCompare` fingerprints
- [ ] Verification order and lineage check; `governance.permit` on the result
- [ ] Enum migration (`ADD VALUE IF NOT EXISTS`)
- [ ] AC-FORGERY tests; local-CI gate; PR
- [ ] Operator asked, in chat, to configure `DPF_GPP_PERMIT_SECRET`. The agent never handles it.

### PR-E
- [ ] `binding-enforcement.ts` (empty enforcement table, `KNOWN_SHADOW_BINDINGS`, `shadow-all` override)
- [ ] `permit_required` rejection and disposition
- [ ] Ratchet: enforcement entries need a DI id, O/A/I-only tools and no direct sites
- [ ] AC-ENFORCE tests; Annex A note; local-CI gate; PR
- [ ] Promotion procedure documented; no binding promoted

### PR-F
- [ ] Git-history note in the PR body: when each of the five plan→build paths gained or lacked the WWMD gate
- [ ] `PLAN_TO_BUILD_GATE_SET` and `transitionPlanToBuild` in `plan-to-build-transition.ts`
- [ ] Route `advanceBuildPhase`, the advance-phase route, `save_phase_handoff` and `build-on-plan-approval` through it with their current modes
- [ ] `direct-phase-writes` ratchet
- [ ] AC-SINGLE-TRANSITION test; existing Build Studio suites green unchanged
- [ ] UX check on the canonical runtime via the non-prod lease; local-CI gate; PR
- [ ] File the C-8 enforcement decision item, citing live `gpp-c8-transition-gate-skipped` counts

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Gate decisions are unsealed today.** Only `kernel-consult-ledger.ts` seals. `evaluatePerspectiveGate` and the human-approval path do not. By §5.6, a permit "with no sealed decision behind it is invalid". Read literally, every Phase 2 permit would verify as `lineage_unsealed`. | PR-D records `lineage_unsealed` as a distinct verdict, without refusing. Promotion criterion 4 requires either sealed decisions for the binding's gate or an explicit decision accepting unsealed lineage. Sealing gate decisions is a separate change to `persistDecisionInteraction` callers and is filed as its own BI. Phase 2 does not change the decision ledger. |
| R2 | Development-install forgery: an agent with database and host-secret access can mint a row and compute a MAC | It is stated, not hidden (§5.0 item 4). `DPF_GPP_PERMIT_SECRET` is dedicated, with no `AUTH_SECRET` fallback. Annex A reports custody per install. Prevention needs agent runtimes without database credentials or key access, which is a deployment property outside Phase 2. |
| R3 | Monitor latency or failure on O/A/I calls | Mint and observation writes run only for O/A/I calls, are fail-open, and catch every error. Tests prove a throwing sink never changes the result. |
| R4 | **The Build Studio ship gate runs after `deploy_feature`** (`ship-on-review-approval.ts` :111 vs :224) and only in autonomous mode. Ship-stage tools (`deploy_feature`, `create_portal_pr`, `contribute_to_hive`) are also reached through direct `executeTool`. | No Build Studio binding in Phase 2. These calls record `unmediated`. Reordering the ship gate is a Build Studio defect fix with its own BI, test and approval. PR-E's ratchet blocks promotion of any binding whose tools still have direct sites. |
| R5 | PR-F changes a fragile area | It changes only the gate-set evaluation and the phase write. Each path's mode reproduces today's outcome, existing suites must pass unedited, it can be reverted on its own, and it has a UX check on the canonical runtime. |
| R6 | Observation volume | Observations are written for O/A/I calls only (65 critical tools on the Phase 1 map), with 365-day telemetry-bounded retention handled by the existing retention sweep. If volume warrants, add a dedupe window like `SHADOW_DEDUPE_WINDOW_MS`. |
| R7 | External clients ignore `_meta` | Carriage is additive, and absence is recorded `absent` in shadow. Only promoted bindings refuse, and promotion requires evidence that clients carry handles. |
| R8 | Shadow lingers forever (spec §9) | The promotion criteria are fixed in advance (PR-E). Annex A shows per-binding mode. M-6 divergence comes from `GppPermitObservation`. |

## Research & Benchmarking

See the spec's [§7 Research & Benchmarking](../specs/2026-10-01-gpp-model-to-execution-design.md#7-research--benchmarking).
For this phase, the relevant rows are object capabilities and complete mediation, Macaroons / Biscuit /
RFC 9396 / OAuth Transaction Tokens (the attenuate-only claim model and parameter-hash binding), and
credential brokers. DI-2DE3951FBB28 settles the opaque DB-backed permit now and a signed encoding later.
This plan adds no new comparison.

## Traceability to the scope baseline

The baseline is the spec's §11, minted by spec-approval on 2026-10-01 at 11:40. Phase 1 rows are
included so that every acceptance criterion has an owner.

| Deliverable | Phase | Objectives | Acceptance | Contracts | Flows |
|---|---|---|---|---|---|
| PR-A | 1 (delivered, #5876) | OBJ-VISIBLE, OBJ-MEDIATION, OBJ-CRITICAL | AC-MAP, AC-RATCHET-CLASS, AC-RATCHET-REACH | contract:tool-consequence-declaration, contract:known-unclassified-side-effect-tools, contract:known-unmediated-execute-sites | flow:registry-to-map-report, flow:source-tree-to-ratchet |
| PR-B | 1 (delivered, #5880) | OBJ-TRANSITION, OBJ-NODISRUPT | AC-C8-SHADOW | contract:save-phase-handoff-auto-advance, contract:gate-skipped-activity-event | flow:plan-phase-handoff-to-shadow-event |
| PR-C | 2 | OBJ-PERMIT, OBJ-NODISRUPT, OBJ-CRITICAL, OBJ-VISIBLE | AC-SHADOW-PERMIT | contract:permit-claim-set, contract:permit-handle-mac | flow:gate-admit-to-permit-mint, flow:monitor-shadow-verdict |
| PR-D | 2 | OBJ-PERMIT | AC-FORGERY | contract:permit-handle-mac | flow:monitor-mac-verification |
| PR-E | 2 | OBJ-CRITICAL, OBJ-NODISRUPT | AC-ENFORCE | contract:binding-enforcement-mode | flow:binding-promotion-to-enforced |
| PR-F | 2 | OBJ-TRANSITION | AC-SINGLE-TRANSITION | contract:shared-transition-function | flow:all-phase-paths-through-transition-function |

Contract and flow ids are the ones registered with the Phase 1 plan's coverage. PR-C lists
`contract:permit-handle-mac` because it creates the nullable `keyId` / `mac` columns that PR-D populates.
OBJ-MEDIATION remains owned by PR-A. PR-E's promotion ratchet consumes it but does not change it.

## Verification

- `pnpm --filter web exec vitest run` for the new tests and the touched monitor, route, pack and Build
  Studio suites.
- `pnpm --filter web typecheck`.
- `pnpm --filter web build` through the normal gate. The local-CI gate is required, because runtime files
  change in every PR.
- Migrations (PR-C, PR-D): apply through the build gate's migration step against the canonical runtime.
- UX: PR-F only (see its Rollout). PR-C, PR-D and PR-E have no surface change.
- After each merge, record execution evidence on BI-69415B68 as canonical-runtime evidence (AGENTS.md §5).

## Explicitly out of scope

- Compiled binding records, typed gate fields and stage-scoped permits across calls (Phase 3).
- Routing Build Studio's direct `executeTool` sites through the monitor. Each binding's promotion PR does
  this, one binding at a time.
- Reordering the ship gate before `deploy_feature`, or reclassifying `deploy_feature` to match what it does in this flow (R4; decide after the shadow evidence, separate BI if needed).
- Sealing gate decisions in the ledger (R1; separate BI).
- C-5 combination detection. The binding type supports it, but no detector exists on main.
- Signed attenuable encodings (Biscuit, RAR-JWT) and the MCP extension (Phase 6).
- Credential brokering inside the monitor (§5.3 item 5).
