# Federated demand sharing direction implementation plan

**Backlog authority:** `BI-485F88E9` under `EP-DELIVERY-FLOW`

**Work capsule:** `WC-5EAB8C08`

**Design authority:** `docs/superpowers/specs/2026-07-19-federated-demand-network-design.md`

## Outcome

Enforce one business route for deliberately shared backlog demand:

`end company -> distributor/reseller -> Founder Hub (the Arcamanus installation)`

The originating company selects each item. A distributor may forward only when
the source granted bounded Founder Hub consent. The reusable platform identifies
Arcamanus by the connected peer's display name rather than hardcoding a private
installation name into community code.

This directional rule applies across organizational boundaries. Installations
owned by the same company retain the existing symmetric `same-organization`
lane: after both sides approve the pairing and projection, each installation
automatically publishes share-safe platform demand to the other. This provides
bidirectional visibility without multi-master backlog writes; the originating
installation remains authoritative and a peer may follow or adopt locally.

## Existing substrate verified

- `ChannelDemandPolicy` already owns explicit item selection, attribution, and
  bounded forwarding consent.
- `DemandEnvelopeV1` and `forwardDemandEnvelope` already preserve the original
  pseudonymous origin, route attestations, cycle protection, and hop limits.
- `ProjectionContract` and `FederatedRecordMirror` already own per-link policy,
  delivery, withdrawal, and reconciliation.
- `/ops/demand` and `NetworkDemandPanel` are the existing contextual interface.
- Federation roles already express both sides of each relationship. No new
  model, enum, route, or navigation entry is required.
- `same-org-peer` reconciliation already runs symmetrically on every approved
  internal installation and is intentionally separate from explicit partner
  sharing controls.

The gap is directional authorization: the read model currently offers all four
partner roles, and local sharing accepts both faces of those relationships.

## Atomic delivery

The server policy, destination read model, and interface wording form one
authorization behavior. Shipping only one layer would either leave an API
bypass or remove a valid capability from the interface, so they land together.

**Coverage receipt:** `cmrvf3fcy0lfk01qkyxp9s1vv` — atomic, recorded for
`BI-485F88E9`. The authorization service, destination read model, and interface
cannot ship independently without either preserving a bypass or hiding a valid
route.

## Implementation

1. Add failing policy tests proving only local roles `managed-by` and
   `channel-downstream` can receive locally originated demand. Keep forwarded
   incoming demand restricted to `channel-downstream`.
2. Add a pure read-model mapping test proving reverse-facing `manages` and
   `channel-upstream` links are excluded, `same-org-peer` remains on its
   automatic bidirectional lane, and valid partner destinations are classified
   as `distributor` or `founder-hub`.
3. Enforce the allow-list at the service boundary, not just in React, and query
   only valid outbound roles for the Delivery Flow context.
4. Make the existing panel role-aware: explain automatic bidirectional
   same-company visibility separately from the cross-company route, label the
   actual peer, offer forwarding consent only for a distributor destination,
   and name the selected Founder Hub (for example Arcamanus) on the forwarding
   action.
5. Update the operator guide and federated-demand runbook so setup and recovery
   use the same directional vocabulary.
6. Run targeted unit tests, web typecheck/build through the governed sandbox,
   and responsive light/dark UX verification on `/ops/demand`.

## UX fit

- **Decision:** fits with guardrails.
- **Owner and route:** Operations / Delivery Flow, existing `/ops/demand`.
- **Primary people:** an end-company operator deciding what may leave their
  installation; a distributor operator deciding what consented demand to pass
  to the central hub.
- **Placement:** contextual sharing panel beside the demand it governs; no new
  global navigation or standalone workspace.
- **Reuse:** `NetworkDemandPanel`, existing server actions, report-kit controls,
  `ProjectionContract`, and `FederatedRecordMirror`.
- **First viewport:** explain the three-party route and local authority before
  presenting selectors.
- **Progressive disclosure:** Founder forwarding consent appears only when the
  selected destination is a distributor. Multiple Founder Hubs use the existing
  destination selector.
- **Empty/failure states:** no eligible outbound connection points to
  Connections; server rejection remains authoritative if a crafted request uses
  a reverse-facing link.
- **Responsive/accessibility:** labels remain associated with controls, controls
  wrap on narrow screens, status remains announced, and color is not the sole
  directional cue.
- **AI impact:** none; no prompt or coworker behavior changes.

## Verification evidence required

- Targeted tests demonstrate the role matrix and UI copy/conditional controls.
- Production build passes for the exact branch SHA.
- Shared nonproduction runtime renders `/ops/demand` at desktop and narrow
  widths in light and dark themes without horizontal overflow.
- Existing forwarding, expiry, revocation, cycle, and pseudonymous-origin tests
  remain green.

## Documentation impact

User/operator behavior changes, so update `docs/user-guide/operations/index.md`
and `docs/operations/federated-demand-channels.md`. No install, public marketing,
prompt, or `AGENTS.md` doctrine change is required.
