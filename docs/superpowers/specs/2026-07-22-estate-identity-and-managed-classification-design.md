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
- **Suppress all issue types for observed entities** — deliberately out of scope
  *for this change*, which is scoped to *disappearance* (`stale_*`). Whether an
  observed host should also skip `lifecycle_unverified` /
  `catalog_match_ambiguous` needs its own evidence pass. **That pass has since
  run — see "Follow-up resolved" below.**

## Out of scope / follow-ups

- **Retention & aging** for genuinely-decommissioned *managed* assets: after N
  days unseen, surface a **decision** ("retire this device?") rather than a
  standing quality issue. This is a policy call for the operator.
- **Cross-collector identity resolution**: the same physical device discovered by
  both UniFi and ARP still yields two rows (`unifi:<mac>` and `arp:<MAC>`).
  Anchoring both on MAC is the prerequisite; merging them is the next step.

## Follow-up resolved — identity and lifecycle are managed-estate questions too

*2026-08-05, BI-A3D12F85. Operator-approved.*

The deferred question above ("should an observed host also skip
`lifecycle_unverified` / `catalog_match_ambiguous`?") got its evidence pass. The
answer is **yes**, and the evidence is stronger than a scope preference:

**MAC OUI enrichment is not the gap — randomised MACs are.** Measured against the
live install by *executing* the detector over all 341 open rows joined to an
entity:

| ARP generation | collector | entities | resolved to a vendor | locally-administered MAC |
|---|---|---|---|---|
| 2026-06-10, `...host:arp:<ip>` | `arp_scan` | 83 | 65 | 18 |
| 2026-08-05, `host:arp:<MAC>` | `unifi` | 101 | 0 | **101** |

OUI lookup resolved **65 of 65** burned-in MACs and **0 of 119**
locally-administered ones. That is correct behaviour, not a defect: a randomised
MAC sets bit `0x02` of octet 1 and carries no OUI, so it has no vendor, no
catalog identity and no support lifecycle *by construction*. Every ARP host
swept today is a MAC-randomising client — exactly the "phone that joined the
wifi" this document's axis 2 already describes.

So those rows are **unresolvable, not merely unresolved**. No operator action
closes them, which is this document's own definition of noise. 180 of them
buried the 21 rows that describe genuinely managed gear (4 UniFi APs, a gateway,
a switch, a linux host, the docker socket, 3 NICs, 2 subnets) — including four
access points with no manufacturer, which is real, actionable signal.

`evaluateInventoryQuality` now gates `catalog_match_ambiguous` and
`lifecycle_unverified` on `classifyEntityObservation(...) === "managed"`, exactly
as `stale_entity` already was. Scope is limited to those two types:
`attribution_missing` and `taxonomy_attribution_low_confidence` are unchanged.

### Load-bearing implementation rule: suppression must RESOLVE, never `continue`

A suppression that only stops emitting is a leak. A bare `continue` puts the
subject in neither `issues` nor `resolvedIssueKeys`, so every row opened *before*
the rule existed has no close path and stays open forever.

This was not hypothetical. Tightening the Docker guard to match `:container:`
positionally correctly stopped new rows for `monitoring_service:container:<id>`
and **stranded 19 already-open ones** — the unexplained residual in BI-A3D12F85
that no close condition accounted for. Applying the same pattern to the observed
estate would have re-created that leak at 180x the scale.

`resolveAllEntityIssues()` now closes every issue key a suppressed subject could
carry, and `discovery-attribution.reconcile.test.ts` pins that the suffix list
covers every branch the loop can emit — so a new detector cannot silently
re-open the hole. This also reversed an earlier rule that suppressed subjects
must emit no resolve keys; its stated rationale (that resolving "would silently
close issues raised by a source that DID evaluate them") does not hold, because
the suppression predicates are pure functions of the subject key and every source
therefore reaches the same verdict.

### Two adjacent defects fixed in the same pass

- **The stale path judged identity on omitted facts.** `discovery-sync.ts` built
  the quality input for a stale entity as `{entityKey, entityType,
  attributionStatus}` and nothing else, so `!manufacturer` was true for an
  *omitted* field exactly as for a missing one — every stale entity re-raised
  both types forever regardless of what its row held.
  `database:prom:qdrant:qdrant:6333` carries manufacturer `qdrant` and still
  re-raised each sweep. This was #3967's principle (judge the persisted row)
  applied to the normal path only. The stale branch now carries the persisted
  identity *and* the persisted `entityType`, so identity-optional types
  (`network_interface`, `subnet`, `vlan`) are honoured there too.
- **48 rows had a NULL or dangling `inventoryEntityId`.** Reconciliation resolves
  by issue key derived from entities present in a sweep, so a row whose subject
  entity no longer exists is unreachable by every close path the platform has.
  Mostly Docker bridge NICs whose `lastDetectedAt` never advanced past
  `firstDetectedAt`.

Backfill for all three populations:
`20260805030000_resolve_unmanaged_identity_lifecycle_issues` (status flip only,
non-destructive, idempotent).

### Why the ARP connection was re-enabled anyway

The `arp_scan:192.168.0.0/24` connection was `disabled`, which is why 58 entities
that *already* satisfy their close condition sat frozen — the reconcile only
evaluates entities a sweep re-observes, and their source never swept. Enabling it
was approved for topology and presence coverage, **not** as a queue remedy:
re-observing ~101 randomised-MAC clients would have pinned ~200 permanently
unresolvable rows had the scoping above not landed with it. Enabling the
connection *without* the scope change would have made steady state worse, not
better.

### Method note

Three magnitude predictions earlier in this arc were wrong, every one by querying
stored columns instead of executing the detector's real condition — including a
"134 of 196 rows already satisfy their close condition" claim that tested only
`manufacturer IS NOT NULL` while the emit condition has three clauses, and which
three shipped fixes inherited. `normalizationStatus` is not even a persisted
column, so the rule is not expressible in SQL. Size this queue by running
`evaluateInventoryQuality` over live rows; do not approximate it.
