---
status: active
---

# Installation-aware COO coordination: source grounding

Scope owner: BI-4B48E7FE / WC-D5FD489C. Implementation: BI-C43FD3E5. Research date: October 26, 2026.
Source inspected: protected main af2b7ef440ff5e153fec264f76584ffe2b604178.
This is design evidence; it does not establish deployed COO-to-COO capability.

## Owner requirement

Each COO is accountable for its installation's declared responsibilities and must
know the relevant other COO instances. DEV may lack production objectives,
decisions or corpus. It must consult the production owner through an authorized
boundary. Sandboxes and additional test/dev instances have scoped purpose and
lifecycle; cloned context cannot confer production identity or authority.

## Existing homes and limits

| Need | Existing source | Evidence and limit |
| --- | --- | --- |
| Installation purpose and peer limits | get_my_coworker_profile.installationContext | Live DEV declares evolve-dpf, capture-required teardown and read-only paired production installation; coworker lifecycleStage is not environment |
| Sovereign identity and task custody | [Federated A2A design](../specs/2026-08-08-federated-a2a-gaid-coordination-design.md), Principal/PrincipalAlias, FederationLink | Approved composed GAID/device/link/organization model; current identity continuity must be verified, not copied from a clone |
| Cross-install posture and control | [Operational control-plane design](../specs/2026-09-01-cross-install-operational-control-plane-design.md) | Existing read-only posture projection; peer operational action is separately gated on the owning control-scope stance |
| Scoped room participation/message projection | apps/web/lib/work-management/federated-room.server.ts | Helpers exist behind the A2A flag and trust gate. Source search found no inbound caller; do not claim a live remote coordination path from helper presence |
| Durable outbound delivery | [Federation outbox runbook](../../architecture/federation-outbox-runbook.md) and existing federation modules | Unreachable peer, denied trust and failed payload have different recovery paths; an unreachable peer remains an owned wait |
| Local visibility and broadcast | PR #6609 / BI-63FB1683, head 3e0e8e1f72c2e897b0033186971a92434d9f50df | Separate Phase E, merged as 40e9c15f1846408ab355f637a6df3ee9ff91a35c. Actual source helpers reproduce lost-message replay and ACK-before-ask gaps; per-destination admission is absent in the handler/writer chain. Findings are recorded on that PR |
| Supervision and recovery | Current coordinated Workrooms amendment and workroom-cycle-continuity.md | Reuse the drive, checkpoint, TaskRun, governed handoff and result identities. No second COO scheduler or private ledger |

Older June attribution drafts are historical context, not current credential
instructions. Reuse current supported per-assistant/client identity and the
checked-in resolver; this design does not request per-conversation credentials.

## Chosen design and verification

Refine the existing P2 scope with install-aware responsibility, qualified peer
context requests, source/version/applicability and sandbox evidence handback.
Reuse canonical identity, trusted links and receiver-owned policy. Preserve the
current read-only peer limit; unsupported remote execution is a dependency owned
by the existing federation program, not a reason to invent a transport.

The canonical design defines OBJ-COO-INSTALLATION and AC-COO-08. Independent review,
baseline reconciliation and revised P2 coverage are owed before implementation.
Acceptance exercises unavailable production corpus, stale/denied context, peer
trust revocation, duplicate/uncertain delivery, cloned test identity and sandbox
expiry. Each observation names its installation, actor, evidence and limitation.
