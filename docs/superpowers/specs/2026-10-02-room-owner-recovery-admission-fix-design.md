# Room owner recovery and effective admission — ordered fix design

**Backlog item:** BI-B8142BB4

**Workroom:** WC-A1DF4DD4

**Profile / shape:** fix / delivery-medium@1.0.0

**Named baseline:** `origin/main` at `7ff008013f16a82da0352df700c2153a17943a83`

## Objective

Make the supported single-room recovery path work when stale ownership is the
reason an OAuth caller cannot enter the room, without weakening exact-room
paired admission or allowing an arbitrary assistant to take ownership. Make an
invitation report the difference between recording membership and achieving
effective human-plus-assistant admission.

This is the residual after BI-061D7192 and BI-16DA79C5. It does not duplicate
BI-F4EB23C1's approval-card and approval-completion reporting work.

## Verified defect and ruled-out causes

Live reproduction on WC-2552ADE3:

1. `invite_room_participant` was approved and wrote an active contributor for
   AGT-EXT-CODEX.
2. `get_workroom` still returned `workroom_access_denied` because the acting
   human was not admitted, while exact-room access correctly requires both the
   human and assistant.
3. The documented recovery tool, `appoint_room_coordinator`, was refused by the
   generic OAuth target guard before its consequence approval or handler could
   run.

The current tree confirms the same mechanism:

- `apps/web/lib/work-capsules/oauth-workroom-ownership.ts` applies the generic
  exact-room guard to every OAuth tool carrying `capsuleId`, with a special case
  only for assistant executor handover.
- `apps/web/lib/mcp/packs/room-messaging-pack.ts` documents
  `appoint_room_coordinator` as the stalled-room owner recovery tool, but its
  handler has no dedicated recovery authorization.
- The invitation handler returns success immediately after the membership and
  policy writes; it never resolves exact Workroom access for the resulting
  human-plus-assistant pair.
- `execute-coordinator-appointment.server.ts` updates the roster but does not
  refresh an existing explicit WorkItem room policy, so a newly appointed human
  may remain excluded by that policy.

Ruled out:

- Re-authentication does not change either principal's room membership.
- Re-inviting the assistant is not a supported repair for a missing human and
  would repeat an already completed consequence.
- A blanket target-guard exemption would preserve the symptom but remove the
  authorization boundary.
- Account-wide handover is valid for account retirement, but is too broad for
  one stalled room.

## Governing decision

WWMD decision `DI-9F9C9E315F3E` recommends the dedicated recovery authorization
with high confidence. It best satisfies least privilege, prospective trust,
room reachability, and the rule that platform function must not depend on a
particular client.

The authorization contract is:

1. A normally admitted human-plus-assistant pair may continue to appoint under
   the existing capability, grant-intersection, and authority-consequence gate.
2. When exact-room admission fails, only an active human with
   `manage_platform` may use the single-room recovery path.
3. The same decision is re-evaluated in the handler immediately before the
   write; approval is not a stale authorization cache.
4. The appointee must still be an active principal, replacement remains
   explicit, incumbent coordinators are stood down, and the audit trail remains
   the existing governed tool execution plus room handoff activity.
5. Exact-room access itself is unchanged and remains the final acceptance
   oracle.

## Ordered implementation

1. Add failing regression tests for authorized platform recovery, unauthorized
   takeover refusal, admitted-owner preservation, post-invite partial admission,
   and explicit-policy synchronization during coordinator appointment.
2. Introduce one server authorization helper for coordinator appointment. It
   resolves normal exact-room action access first and falls back only to the
   acting human's `manage_platform` capability. Use it from OAuth preflight and
   the tool handler so execution rechecks the same rule.
3. Extend the canonical coordinator appointment writer so an existing explicit
   WorkItem room-policy snapshot is updated with the new coordinator and the
   current active room members. Do not create a restrictive policy where none
   existed.
4. After an agent invitation is persisted, resolve effective exact-room access
   for every Workroom anchored to the WorkItem. Return a truthful partial result
   (`membershipRecorded: true`, `effectiveAdmission: false`) with exact blocked
   room IDs and the coordinator-recovery action when the acting pair is still
   excluded. Return ordinary success only when the requested access is effective
   (or when no exact Workroom exists).
5. Run affected Vitest files and web typecheck; then use the ordinary local
   integration, semantic review, PR/DCO, merge-queue, and live-verification
   stages. Reconcile BI-F4EB23C1 at rebase time rather than copying its approval
   UI changes.

## Acceptance and verification

- **AC-1:** A caller already admitted for action can appoint without
  `manage_platform`; all existing grant/capability/consequence gates remain.
- **AC-2:** A caller excluded from the room can appoint only when the acting
  human has `manage_platform`; the handler repeats this check before writing.
- **AC-3:** An excluded non-manager is refused and no appointment writer runs.
- **AC-4:** Replacing a coordinator updates an existing explicit WorkItem policy
  so the new human coordinator is both admitted and action-capable, while
  preserving all active room members.
- **AC-5:** An invitation that writes membership but still fails exact paired
  admission reports a partial outcome, names every blocked `WC-*`, and supplies
  the supported owner-recovery action. It never says the assistant can continue.
- **AC-6:** Normal effective invitations still return success, and exact-room
  sensitivity, policy, clearance, grant, and independence rules are unchanged.
- **AC-7:** On the canonical live install, recover WC-2552ADE3 without replaying
  its completed invitation; verify `get_workroom` succeeds for the acting OAuth
  pair, then return BI-9F258707 to its original chat for completion.

## Documentation impact

No end-user guide change is required: the public tool descriptions already name
the intended recovery behavior. The tool result becomes truthful and actionable;
the design and regression tests are the durable operator/coworker documentation.
