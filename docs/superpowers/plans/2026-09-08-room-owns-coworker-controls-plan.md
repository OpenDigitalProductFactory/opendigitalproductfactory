---
status: active
---

# The room owns the coworker's controls — implementation plan

**Epic:** `EP-WORK-POSTURE` (room-scoped slice of `EP-31815F97` for the authority term)
**Design:** [Work Posture design §8.2](../specs/2026-08-22-workroom-work-posture-design.md) — founder direction 2026-09-08
**Delivered as one branch:** `feat/room-owns-coworker-controls`, Workroom `WC-4778C709`

## Backlog coverage

| Item | Size | Content | Where it lands |
| --- | --- | --- | --- |
| `BI-947780FE` | medium | Retire the per-conversation "Edit fields on this page" and "Web access" switches; hands-on and web access resolve server-side from the room + standing grants | `lib/work-management/room-turn-authority.ts` (pure) + `.server.ts` (loader); `lib/actions/agent-coworker.ts`; `app/api/agent/send/route.ts`; `components/agent/*` |
| `BI-F114354D` | large | Block by default beyond the room-authorized surface; the room is a term in the TAK intersection | `lib/govern/authority/*` (`room-authority-denied`), `lib/mcp-tools.ts getAvailableTools`, `lib/tak/agentic-loop.ts`, `lib/coworker/authorized-surface-execution-context.ts` |
| `BI-7ADEBDC1` | medium | Golden Triangle becomes a Workroom definition parameter; per-coworker dock and agent scope retire | `lib/work-management/room-shapes.ts` (`defaultPriority`), `components/workspace/workroom/WorkroomPostureControl.tsx`, `lib/golden-triangle/{persistence,dispatch}.ts`, `lib/inference/routed-inference*.ts` |

## Design grounding

Source of truth is the Work Posture design (`2026-08-22`) extended by §8.2; the
authority rule realizes the TAK composition already stated in
`2026-08-13-wwwd-constitutional-alignment-gate.md`. Nothing here is a new engine:

- **One resolver, not three.** `deriveRoomTurnAuthority` answers web, hands-on and
  priority from the same facts (room shape, declared activity shape and its `grants`,
  declared posture, standing agent grants, decreed platform room default). The scheduled
  path's `resolveScheduledTurnExternalAccess` was the precedent; the interactive path now
  matches it.
- **The room-aware gate already existed.** `workroom-shape-governance-hook.ts` never fired
  from chat because `authorizedSurfaceContext.workroomId` had no writer. The chat turn now
  sets it. `WorkShapeDefinition.grants` — declared per activity, enforced by nothing — is
  now the room-authorized surface, translated into the agent-grant vocabulary
  (`tool:read` → the coworker read baseline).
- **Tighten-only holds at every seam.** The room can remove a tool from a coworker's
  surface, never add one; a declared `advise` boundary switches hands-on off; a chat
  message is a request, not authority (`room-authority-denied` names the remedy).
- **Golden Triangle storage already existed** on `scopeClaims.workroomPosture.priority`
  (Slice D). This slice adds the writer (room control), the shape defaults, and the
  consumer (`RouteAndCallOptions.workroomPriority` → `resolveDispatchPosture`).

## Phases (all on this branch)

1. **Resolver + loader.** Pure derivation with a full unit suite; DB-first grant read so
   the tool surface and the resolver never disagree.
2. **Executor term.** `GovernedExecuteContext.roomAuthority`, `CoworkerAuthorityInput.action.roomAuthorityAllowed`,
   the new deny reason and its explanation; `getAvailableTools` loses the unified-mode
   short-circuit and the zero-grant bypass and gains `roomAuthorizedGrants`.
3. **Turn wiring.** `sendMessage` resolves the room from the portal envelope or the
   `/build/work/<capsuleId>` route, feeds the resolver's answers everywhere the client
   flags used to go, and passes `workroomId` / `roomAuthority` / `externalAccessEnabled` /
   `workroomPriority` into the loop; the send route strips the retired body fields.
4. **Client retirement.** The two switches, their browser stores, the web-access
   continuation prompt, the per-coworker priority dock and control, and the client-side
   web-search-grant probe are deleted; the coworker record points at the room.
5. **Room control.** The Workroom posture control gains the triangle (shape → priority →
   pace → authority) and saves MERGE onto the existing declaration (a pre-existing bug:
   setting pace wiped authority).

## Verification

- Unit: `room-turn-authority.test.ts`, evaluator room-denial cases, `getAvailableTools`
  narrowing / default-deny / unified-mode cases, dispatch `workroomPriority`, retired
  per-agent layer asserted inert, composer control renders no switches.
- Typecheck + production build on the branch; pregate before push.
- Live acceptance (on the BIs, not this PR): ask a coworker in a craft-stewardship room to
  email a customer and observe the `room-authority-denied` explanation; change one room's
  triangle and observe every participant's compiled policy change.

## Out of scope

- Populating `WorkroomParticipant` roles into the authority term (W2, `BI-640B011D`).
- Running the WWWD × WSID composition for every shape-consequential tool (listed in
  `BI-F114354D` item 6; the four legacy names still gate today).
- Migrating legacy `goldenTrianglePerAgent` entries — deliberately inert, not migrated.
