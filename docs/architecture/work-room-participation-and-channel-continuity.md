# Work Room Participation and Channel Continuity

Work Room is an application projection over the canonical Work Case and its existing source records. This slice adds no identity, room, membership, or channel table.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/plans/2026-07-26-work-rooms-collaboration.md`
  - `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`
- Current code substrate reviewed:
  - Work Case and Work Room projection, Workspace case loader, Work Item presence, conversation-participant lineage, effective authorization context, Principal aliases, and communication bindings/sessions.
- Source of truth:
  - Work Case and its source records own work state; `Principal`/`PrincipalAlias` own identity and authority; `CommunicationChannelBinding` and `CommunicationChannelSession` own external identity and room attachment.
- Decision:
  - Extend the existing projection and structured metadata seams. Do not create a room, membership, identity, or provider-specific channel model.

## Authorization boundary

The Workspace route resolves the signed-in user through the shared effective authorization context. The room loader then applies a monotonic access decision before loading messages or participant context:

`none < discover < content < action`

Admission comes from Work Item assignment or explicit `workRoomPolicy` metadata on existing evidence. Sensitivity is evaluated against `Principal.sensitivityClearance`. Presence is intentionally absent from the decision inputs that can grant authority. The current detail route requires content access and returns not-found for every lower decision, preventing title, participant, source, and sensitivity disclosure.

## Participant projection

`room-participation.ts` is the pure convergence layer. It merges:

- Work Item human and coworker assignment;
- active `WorkItemPresence` rows;
- the existing root plus depth-one `AgentThread`/`TaskRun` lineage projection.

The Prisma adapter resolves every displayed identity through `PrincipalAlias`. An unresolved lineage identity is omitted rather than presented as an authorized room participant. AI sponsorship and authority are projected from `Principal.sponsorPrincipalId` and `Principal.authorityMode`. Lineage, rather than a room-local summon picker, determines secondary coworker participation.

## External channel continuity

External providers remain adapters to DPF, not alternate room authorities. The generic ingress contract uses existing substrate in this order:

1. `CommunicationChannelBinding` resolves channel/provider/account/external subject to one verified `Principal` allowed inbound.
2. `CommunicationChannelSession` attaches that principal and external peer to one `WorkItem`.
3. The Work Item source derives the canonical `caseId`, `caseKey`, and DPF deep link.
4. The provider event ID becomes the stable `WorkItemMessage.messageId`; an upsert makes activity recording idempotent.
5. `WorkItemMessage.structuredPayload.workRoom` preserves the canonical room reference without a parallel room table.

Unresolved identity or room context is quarantined before activity persistence. Capability flags produce an explicit degraded result. Confidential or higher consequential requests require step-up authentication. Delivery acknowledgement and action completion remain separate facts; this ingress records external activity and never marks a governed action complete.

Teams, Slack, and other providers consume this shared contract. Provider-specific feature work does not belong in the Work Room projection.
