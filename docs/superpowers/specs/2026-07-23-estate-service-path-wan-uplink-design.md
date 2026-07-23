# Estate service path: modelling the internet uplink

Status: implemented
Date: 2026-07-23
Backlog: follow-up to BI-FCEC588E (estate identity + managed-vs-observed)

## Problem

Discovery modelled the LAN in detail and the platform's own Docker bridge in
*excessive* detail — but **never modelled the hop the business actually depends
on**: the connection from the gateway to the internet.

Concretely, before this change:

- The relationship vocabulary was `CONNECTS_TO / HOSTS / MEMBER_OF / PEER_OF /
  ROUTES_THROUGH`. **Nothing expressed "reaches the internet via."**
- The UniFi collector's `uplink` handling only emitted a relationship when the
  uplink target was *another UniFi device* (`macToRef.get(uplink_mac)`), so the
  chain stopped dead at the gateway.
- `discovery-promotion-policy.ts` carried `/\(WAN\d*\)/` in
  `NON_PRODUCT_NAME_PATTERNS`, commented "VLAN-shape names from unifi", with a
  test asserting `["Primary Starlink (WAN1)", true]`. The single most critical
  dependency in the estate was **explicitly pattern-matched out of the
  portfolio** as a worthless runtime artifact — while Docker bridge rows were
  being promoted.

Net effect: "are we online, and if not which hop broke?" was unanswerable, and an
ISP outage would have surfaced only as unrelated downstream symptoms.

## Design

### The path

```
client → access point → switch → gateway → WAN uplink (Starlink) → internet
         └──────────── already modelled ────────────┘ └── added here ──┘
```

### WAN uplink as a first-class entity

`stat/health` is the only UniFi endpoint that reports the internet uplink. Its
`wan` subsystem carries the ISP identity, public address, link status and
latency. The collector now emits:

- **itemType `wan_uplink`**, named after the ISP (`"Starlink (WAN)"`) so the
  operator sees the dependency they actually have rather than an opaque port
  label. Attributes: `ispName`, `ispOrganization`, `wanIp`, `linkStatus`,
  `latencyMs`, `uptimeSeconds`, `throughputDownBps`, `throughputUpBps`.
- **relationshipType `UPLINKS_TO`** from the gateway to that uplink, preferring
  the controller's own `gw_mac` attribution and falling back to the routing
  device.

### Identity is anchored on the port, never the address

`naturalKey = unifi-wan:${site}:wan`.

Deliberately **not** the public IP: a Starlink CGNAT address rotates routinely,
and keying on it would mint a new uplink entity per address change — exactly the
churn pattern that produced thousands of orphaned rows elsewhere in discovery
(see `2026-07-22-estate-identity-and-managed-classification-design.md`). The WAN
port designation is stable for the life of the site.

### The WAN is managed infrastructure, not an artifact

- `/\(WAN\d*\)/` removed from `NON_PRODUCT_NAME_PATTERNS` (deliberately removed
  rather than narrowed — WAN uplinks belong in the portfolio).
- `wan_uplink` added to `LEGACY_PROMOTABLE_TYPES`: it has a vendor (the ISP), a
  service level, and an outage blast radius of "everything".
- `wan_uplink` added to the network-connectivity taxonomy rule in
  `findRuleMatch`, so it attributes to `network_connectivity`.
- It carries no observed token, so `classifyEntityObservation` treats it as
  **managed** — meaning it *does* raise when it goes quiet. That is the point.

## Why this matters beyond the topology picture

It makes consequence-ranking possible. Severity today is uniformly `warn`, which
is why "the internet is down" and "this row lacks a manufacturer string" looked
identical. With a service path in the graph, severity can be derived from
**distance from the path**: the Docker bridge is far from it (noise), the WAN
uplink *is* it. That ranking is the prerequisite for the proactive guardrails
described in the follow-ups below.

## Out of scope / follow-ups

- **Consequence-based severity** driven by service-path distance, and a per
  issue-type open-count ratchet in CI (the proactive guardrails).
- **Uplink health as a monitored signal** (state transitions, latency/loss
  thresholds, failover to a secondary WAN) rather than a point-in-time attribute.
- **Duplicate ISP-PoP rows**: three entities named
  `customer.dllstxx1.pop.starlinkisp.net` exist at 192.168.0.40/.112/.236 from
  IP-keyed ARP discovery. MAC anchoring stops new ones; collapsing the existing
  three needs the cross-collector identity merge.
- **Multi-WAN**: only the primary `wan` subsystem is modelled; `wan2`/failover
  would extend the same shape.
