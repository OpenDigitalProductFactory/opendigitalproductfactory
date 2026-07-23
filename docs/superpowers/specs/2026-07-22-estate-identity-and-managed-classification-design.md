# Estate identity anchoring + managed-vs-observed classification

Status: implemented
Date: 2026-07-22
Backlog: follow-up to BI-527290AA / BI-3715F309 (open-issues cleanup arc)

## Problem

Discovery treats **every observation as inventory**. That produced two distinct
defects behind the `stale_entity` / `stale_relationship` quality-issue flood that
the preceding PRs (#3163, #3418, #3424) only partly drained.

### 1. Identity is anchored to the observation, not the thing

Two identity regimes coexisted in the collectors:

| Collector | Key | Stability |
| --- | --- | --- |
| UniFi devices | `unifi:${mac}` | stable |
| UniFi clients | `unifi-client:${mac}` | stable |
| ARP neighbours (`network.ts`, `snmp.ts`, `arp-scan.ts`) | `arp:${ip}` / `arp-host:${ip}` | **volatile** |

An ARP-discovered host is keyed by its **IP**, even though ARP inherently yields
the IP↔**MAC** pair and the MAC was already being captured as an attribute. Every
DHCP lease change therefore mints a *new* entity and strands the old one as
permanently `stale` — one orphan per re-lease — plus a duplicate row for what is
physically one device.

### 2. Transient observations are treated as managed estate

A UniFi access point disappearing is real, actionable signal. A phone that left
the wifi, an ARP neighbour seen once, or the platform's own Prometheus scrape
target disappearing is **normal** — but all of them raised a `stale_*` quality
issue that no operator can ever resolve.

## Design

### Axis 1 — identity anchoring (stability)

Anchor ARP-discovered hosts on the **MAC** when the collector reported one,
falling back to the IP only when it did not:

```ts
const identity = normalizeMac(host.mac) ?? host.ip;   // canonical, e.g. 00A0C9123456
externalRef = `arp-host:${identity}`;
naturalKey  = `arp:${identity}`;
```

Reuses the existing `normalizeMac` (`discovery-mac-classification.ts`), so
separator/case variation between `arp -a`, `ip neigh`, nmap and SNMP collapses to
one canonical form. Applied in all three ARP-emitting collectors
(`network.ts`, `snmp.ts`, `arp-scan.ts`). This matches the UniFi convention and
makes the entity a durable record of *the device* rather than of *a sighting*.

### Axis 2 — managed vs merely observed (durability)

A second, orthogonal classification in `estate-observation-class.ts`:

- **`managed`** — infrastructure the operator owns and administers (UniFi
  devices, SNMP-managed gear, servers, services, databases). Disappearance is
  actionable signal.
- **`observed`** — transient things merely seen (ARP neighbours, UniFi clients)
  or platform-internal monitoring targets (`prom:` / `prom-target:`).
  Disappearance is normal and must not raise a quality issue.

Classification is by positional token match on the key (never substring, so
`promotions-engine` and `sharp-imaging` stay managed). **Default is `managed`**:
a false `observed` would *hide* real operator signal, whereas a false `managed`
only leaves a resolvable row on the queue.

Relationships take the **least-durable endpoint**: a relationship touching any
observed endpoint is observed (a transient client on a managed AP vanishes when
the client leaves), while managed↔managed topology (AP uplink → switch) stays
managed.

Wired into `evaluateInventoryQuality`: only `managed` entities/relationships emit
`stale_entity` / `stale_relationship`.

### Relationship to existing classification

This is the **second axis**. The first, `classifyEstateProvenance`
(`discovery-promotion-policy.ts`), separates the operator's real estate from the
platform's own black-box runtime. This one separates, *within what discovery can
see*, the managed set from the merely observed set. `isDockerOriginEntityKey` /
`isDockerOriginRelationshipKey` remain the structural Docker-churn guard; this
change also makes the entity guard's `container:` match **positional**, closing a
leak where `monitoring_service:container:<12hex>` bypassed it.

## Why not the alternatives

- **Retention/aging only** (age out stale rows after N days) — treats the symptom.
  A guest phone would still open an issue for N days, and duplicate identities
  would keep accumulating.
- **Re-key existing rows in a migration** — the volatile `arp:<ip>` rows are
  classified `observed` by axis 2, so they raise nothing while they age out. A
  full re-key of entity + relationship keys carries far more blast radius than
  the churn it would avoid.
- **Suppress all issue types for observed entities** — deliberately out of scope.
  This change is scoped to *disappearance* (`stale_*`). Whether an observed host
  should also skip `lifecycle_unverified` / `catalog_match_ambiguous` needs its
  own evidence pass.

## Out of scope / follow-ups

- **Retention & aging** for genuinely-decommissioned *managed* assets: after N
  days unseen, surface a **decision** ("retire this device?") rather than a
  standing quality issue. This is a policy call for the operator.
- **Cross-collector identity resolution**: the same physical device discovered by
  both UniFi and ARP still yields two rows (`unifi:<mac>` and `arp:<MAC>`).
  Anchoring both on MAC is the prerequisite; merging them is the next step.
- Broader suppression of non-stale issue types for observed entities (above).
