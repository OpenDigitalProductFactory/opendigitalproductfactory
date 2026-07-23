// estate-observation-class.ts
//
// Separates the estate the operator MANAGES from the things discovery merely
// OBSERVED passing through the network.
//
// Why this exists: discovery treats every observation as inventory. A UniFi
// access point, a switch, and a router are infrastructure the operator owns and
// administers — if one stops answering, that is real signal worth surfacing. A
// phone that joined the wifi, an ARP neighbour seen once at 192.168.0.58, or a
// Prometheus scrape target inside the platform are NOT the operator's managed
// estate; they appear and vanish as a matter of course. Raising a
// stale_entity / stale_relationship quality issue when one of those disappears
// is noise by construction — it can never be "fixed", only ignored.
//
// This is the second axis of estate classification. The first,
// classifyEstateProvenance (discovery-promotion-policy.ts), separates the
// operator's real estate from the platform's own black-box runtime. This one
// separates, WITHIN what discovery can see, the managed set from the merely
// observed set.
//
// Bias: default to "managed". A false "observed" SUPPRESSES a quality issue and
// would hide real operator signal; a false "managed" only leaves a resolvable
// issue on the queue. So only clearly-transient shapes are classified observed.

export type EstateObservationClass = "managed" | "observed";

// Natural-key prefixes emitted by the collectors for things that are seen
// rather than administered. Matched positionally (start of key, or after a `:`
// or the `->` arrow in a relationship key) so a substring inside another token
// never false-matches.
//
//   arp: / arp-host:  — discoverArpNeighbors (network.ts, snmp.ts). Confidence
//                       0.6, named "LAN Host <ip>". An ARP neighbour is any host
//                       that answered on the wire once.
//   unifi-client:     — UniFi *clients* (laptops, phones, guest devices), as
//                       opposed to `unifi:` UniFi *devices* (AP/switch/router),
//                       which ARE managed infrastructure.
//   prom: / prom-target: — the platform's own Prometheus scrape topology.
const OBSERVED_KEY_TOKENS: readonly string[] = [
  "arp:",
  "arp-host:",
  "unifi-client:",
  "prom:",
  "prom-target:",
];

function hasObservedToken(key: string): boolean {
  return OBSERVED_KEY_TOKENS.some((token) => {
    let from = 0;
    for (;;) {
      const at = key.indexOf(token, from);
      if (at === -1) return false;
      // Positional: key start, or immediately after `:` or `>` (the `->` arrow).
      const prev = at === 0 ? "" : key[at - 1];
      if (at === 0 || prev === ":" || prev === ">") return true;
      from = at + 1;
    }
  });
}

/**
 * Classify a discovered InventoryEntity by its entityKey.
 *
 * `managed`  — infrastructure the operator owns/administers (UniFi devices,
 *              SNMP-managed gear, servers, services, databases). Its
 *              disappearance is real, actionable signal.
 * `observed` — transient things merely seen on the network (ARP neighbours,
 *              UniFi clients) or platform-internal monitoring targets. Its
 *              disappearance is normal and must not raise a quality issue.
 */
export function classifyEntityObservation(entityKey: string): EstateObservationClass {
  return hasObservedToken(entityKey) ? "observed" : "managed";
}

/**
 * Classify a discovered InventoryRelationship by its relationshipKey.
 *
 * A relationship is only as durable as its least-durable endpoint: an
 * `arp:192.168.0.58 -> unifi:<ap-mac>` attachment describes a transient client
 * sitting on a managed AP, and vanishes the moment that client leaves. So a
 * relationship touching ANY observed endpoint is itself observed. A
 * managed↔managed link (`unifi:<mac> -> unifi:<mac>`, e.g. AP uplink to switch)
 * stays managed — that topology going away IS worth surfacing.
 */
export function classifyRelationshipObservation(
  relationshipKey: string,
): EstateObservationClass {
  return hasObservedToken(relationshipKey) ? "observed" : "managed";
}
