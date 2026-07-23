# Local-MSP Channel Readiness Path — sell TO the MSP, sell THROUGH the MSP

Date: 2026-07-22
Backlog: BI-53D48861 (EP-PARTNER-CHANNEL) · Vertical: EP-VERTICAL-IT-MSP
Status: decision path ratified by founder direction 2026-07-22

## 1. The model

The first go-to-market step is the **local IT MSP**: a managed-service provider
serving businesses in its local area. The MSP plays both channel roles at once:

- **Sell TO** — the MSP runs its *own* business on DPF (tickets, agreements,
  fleet health, billing readiness): EP-VERTICAL-IT-MSP.
- **Sell THROUGH** — the MSP provisions, resells, and operates DPF installs for
  its local customers over the federation substrate. The MSP's local trust
  relationship is the distribution asset; DPF's sovereignty model (each customer
  keeps their own install and their own data) is the differentiator against
  centralized SaaS the MSP would otherwise resell.

Every MSP action against a customer install is **proposal → consent → evidence**
— the customer keeps sovereignty. This is not a constraint bolted on for the
channel; it is the already-built contract of the federation substrate.

## 2. The decision path

Four steps, each mapped to substrate that exists (DONE), is parked (DEFERRED),
or is genuinely missing (GAP).

### Step 1 — A local MSP signs up (sell-TO entry)

The MSP installs DPF for itself and selects the `it-managed-services` archetype.

| Substrate | State |
|---|---|
| `it-managed-services` archetype activates the partner program (activationProfile axes) | DONE — BI-D4C550E1, BI-DE3FA72C (EP-PARTNER-CHANNEL Phases 0/1) |
| Setup-time capability question + add-later toggle (partner capability made visible at onboarding) | DEFERRED — BI-66CF1AA4 (Phase 1b) → re-opened by this path |
| MSP-vertical surfaces (cockpit, capacity, finance, occupations…) | OPEN — EP-VERTICAL-IT-MSP template BIs |

### Step 2 — The MSP's own install is live and proven

The MSP operates its own business on DPF: service desk, agreements, fleet SOC,
patch posture. This is the credibility gate — an MSP will not resell what it
does not run.

| Substrate | State |
|---|---|
| ServiceTicket model (ticketKind), per-customer/site observability, event correlation, agent loop | DONE — BI-99FEA7FA, BI-8777B85A, BI-0A9D7F60, BI-F0314DB4 |
| MSP fleet SOC console (Ops route) | DONE — BI-80191C61 |
| MSP workspace-home design research (estate map, IT health, tickets, agreements, alerts) | DONE — BI-FE002675 (design input to the cockpit BI) |
| Vertical readiness pack + market-proof fixtures (the "provable" gate) | OPEN — BI-1B07176F, BI-655B4303 |

### Step 3 — The MSP provisions its first customer install (sell-THROUGH unit)

The transactional unit of the channel: the MSP stands up a DPF install for a
local customer and enrolls it under a FederationLink.

| Substrate | State |
|---|---|
| Deployment-to-deployment trust (FederationLink, generalized edge-node enrollment) | DONE — BI-130107D6 |
| Partner identity (Principal.kind='partner', partner-org account) | DEFERRED — BI-DE47EC0B (Phase 2) → re-opened by this path |
| Partner login + /partners portal shell (the MSP operator's seat) | DEFERRED — BI-00E69FBA (Phase 3) → re-opened by this path |
| Deal registration + tiering (the commercial record of a sell-through sale) | DEFERRED — BI-C47A568C (Phases 4-5) → re-opened by this path |
| **MSP-driven customer-install provisioning as a productized flow** (install + archetype selection + FederationLink enrollment + consent baseline, packaged so an MSP tech can run it at a customer site) | **GAP — filed as a new BI in EP-PARTNER-CHANNEL by this spec** |

Today only self-serve install paths exist (installer scripts, Windows install
epics). The gap BI owns turning "MSP provisions a customer" into one governed
flow with the federation enrollment and the initial consent contract inside it.

### Step 4 — The MSP operates the customer fleet via federation

Steady state: monitoring, ticket sync, patch proposals, SOC coverage across all
local customers — with each customer's sovereignty intact.

| Substrate | State |
|---|---|
| Scoped Estate Projection + CADA egress gate at the boundary | DONE — BI-4F8F50FD |
| Federated incident/ticket sync (FederatedRecordMirror) | DONE — BI-3179B48E |
| Cross-deployment remediation proposal + consent gate (the safety crux) | DONE — BI-3C21D4E2 |
| Cross-org patching — proposal-not-action over the FederationLink | DONE — BI-5EF69D32 |
| Federated identity, scoped operator presence, org↔customer crosswalk, governed artifact sharing | OPEN — BI-E2398997 (WS-B5; the operate-at-scale residual) |
| Proactive coworker recipes over the fleet (patch drift, EOL lookahead, backup/monitoring gaps) | OPEN — BI-84DB4044 (EP-VERTICAL-IT-MSP) |

## 3. Commercial shape (prepared, not prescribed)

Recorded as direction, finalized inside the deal-registration build (BI-C47A568C):

- MSP margin on the customer-install subscription plus the MSP's own managed
  services on top — the MSP sells outcomes, DPF is the substrate.
- Tiering stays *prepared-not-prescribed*: the primitives support tiers; early
  local partners run on a simple flat arrangement until real deals shape it.
- Local-area framing for early partners is a soft territory designation, not an
  exclusivity grant — exclusivity is a founder decision deferred until there is
  partner density to argue about.

## 4. Sovereignty invariants (non-negotiable, already enforced)

1. A customer install's data leaves only through the Scoped Estate Projection +
   CADA egress gate — the MSP sees the projection, not the database.
2. No MSP-initiated mutation lands without the customer-side consent gate; all
   patching/remediation is proposal-not-action.
3. Federation trust is explicit and revocable per link; a customer can sever the
   FederationLink and keep operating standalone.
4. Partner identity is a distinct principal kind — an MSP operator is never a
   silent member of the customer's org.

## 5. Sequencing recommendation

1. **BI-DE47EC0B** (Phase 2 partner identity) — everything at Step 3 keys off it.
2. **BI-00E69FBA** (Phase 3 partner login + /partners shell) — the MSP seat.
3. **Provisioning gap BI** (this spec) — the sell-through unit, composed with FederationLink enrollment.
4. **BI-E2398997** (WS-B5) — scoped operator presence/crosswalk, needed before one MSP operator works across many customers cleanly.
5. **BI-C47A568C** (Phases 4-5 deal registration/tiering) — once real deals exist to record.
6. In parallel: EP-VERTICAL-IT-MSP surfaces (cockpit first — it is the demo that sells the sell-TO).
7. **BI-66CF1AA4** (Phase 1b capability toggle) — alongside vertical onboarding polish.

## 6. Acceptance mapping (BI-53D48861)

- Written decision path from sign-up → own install → first customer provision →
  federated operation: §2, every step mapped to a BI. ✓
- Deferred partner phases re-triaged with this driver attached: BI-66CF1AA4,
  BI-DE47EC0B, BI-00E69FBA, BI-C47A568C re-opened citing this spec. ✓ (recorded
  on each item)
- No step requires capability contradicting customer sovereignty: §4 — every
  Step 3/4 mechanism is the already-merged consent/egress substrate. ✓
