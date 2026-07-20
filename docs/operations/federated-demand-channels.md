# Federated demand channels

DPF installations keep their own PostgreSQL backlog. A federated demand channel
shares a deliberately minimized demand envelope; it never exposes or co-writes
the source backlog. The source installation decides which item can travel over
which connection and may withdraw that projection independently.

## Customer and reseller operation

1. In **Platform → Connections**, create or accept a service-provider or channel
   invitation. Both installations must approve the link before exchange begins.
2. The customer opens **Operate → Delivery Flow**, selects one local demand item
   and one trusted connection, and chooses **Share selected demand**.
3. Founder forwarding is off by default. The customer may grant a reseller a
   time-bounded right to forward that minimized envelope to Founder Hub. The
   grant does not authorize any other audience or remote action.
4. The reseller can follow or adopt received demand locally, record interest,
   offer help, or forward it to an eligible Founder Hub connection when the
   source grant permits it. Adoption creates a new reseller-owned backlog item;
   it does not turn the remote record into shared mutable work.
5. The source sees received interest and help receipts in Delivery Flow. It may
   stop sharing at any time; a withdrawal is queued over that connection.

Multiple customer, reseller, and specialist relationships can coexist. Each
link has an independent projection contract and selection set. Creating one
partner never grants exclusivity or silently selects demand for another.

## Founder Hub business management

The Arcamanus Founder Hub installation manages resellers from the Connections
page. Enrolling a trusted channel connection creates a business-only partner
account. Operators can maintain standing and safe agreement references while
the following authorities stay separate:

- `FederationLink` owns trust, revocation, and routing.
- `PartnerAccount` and its agreement/entitlement/support records own the
  Founder-reseller commercial relationship.
- `ServiceOffering` owns the reusable offering catalog.
- `HiveContributionLedger` owns submitted contribution results and evidence.
- `BacklogItem` remains the only local work authority.

A Hive contribution never carries the contributor's backlog or work capsule.
If a reseller wants Founder Hub to understand demand behind a result, it shares
a separate minimized demand envelope under the demand-channel consent.

## Privacy and recovery behavior

Pseudonymous sources remain pseudonymous through reseller forwarding. Opaque
origin references support deduplication but cannot be dereferenced into a local
backlog identifier. Responses are bounded to interest/help intent and reject
source-local planning fields. Delivery is durable and retried; local backlog
work continues when a peer or Founder Hub is offline.
