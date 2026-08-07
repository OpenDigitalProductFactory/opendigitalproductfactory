# Federated demand channels

DPF installations keep their own PostgreSQL backlog. A federated demand channel
shares a deliberately minimized demand envelope; it never exposes or co-writes
the source backlog. The source installation decides which item can travel over
which connection and may withdraw that projection independently.

## Preparing an installation to connect

Before two installations can pair, each one needs three install-local settings.
**Platform → Connections** shows a **Connection readiness** checklist at the top
of the page that reports which of the three is missing and the exact line to add,
so a missed value surfaces as a fixable step instead of an opaque pairing error:

- **Exchange enabled** — `DPF_FEDERATION_EXCHANGE_ENABLED=1`. Turns on the
  demand-exchange surface; without it nothing crosses a connection.
- **This installation's address** — `PUBLIC_URL=http://<this installation's LAN
  address>:3000` (for example `http://192.168.0.152:3000`). The address a peer is
  told to reach this installation at during pairing.
- **Local-network peers** — `DPF_FEDERATION_ALLOW_INSECURE_PEERS=1`. Required only
  when the address above is plain `http` or a private-LAN host; an HTTPS public
  address does not need it, and the checklist marks it *Not needed* in that case.

These are added to the installation's `.env` and take effect on the next
`/ops/self-upgrade`. The application never edits these itself — the live install
advances only through the governed self-upgrade path.

## Same-company installations

Approved `same-organization` connections synchronize share-safe platform demand
in both directions. Every installation runs the same reconciliation policy, so
new eligible work and later source updates become visible to the other internal
installations without another sharing click. This is the normal pattern for a
company operating separate Mac, Windows, development, or test installations.

This is not multi-master backlog replication. Each source backlog item remains
single-writer authoritative. A peer receives a versioned mirror that it can
follow, respond to, or adopt as separately owned local work. Status, priority,
estimate, build state, private planning, discussion, attachments, and customer
context are not remotely overwritten. Either installation can pause or revoke
its link, and expanding the projection requires approval on both sides.

## Customer and reseller operation

Across company boundaries, the supported business route is **end company →
distributor/reseller → Founder Hub**. On founder-managed networks, the configured Founder Hub
is the Founder Hub installation; other deployments use the configured name of
their own central hub.

1. In **Platform → Connections**, create or accept the appropriate relationship.
   The end company records the distributor as the service provider
   (`managed-by` locally). The distributor records the central installation as
   its upstream Founder Hub (`channel-downstream` locally). Both installations
   must approve each link before exchange begins.
2. The end company opens **Operate → Delivery Flow**, selects one local demand
   item and its distributor, and chooses **Share with _distributor name_**.
3. Founder forwarding is off by default. The customer may grant a reseller a
   time-bounded right to forward that minimized envelope to Founder Hub. The
   grant does not authorize any other audience or remote action.
4. The distributor can follow or adopt received demand locally, record interest,
   offer help, or choose **Forward to _Founder Hub name_** when the source grant
   permits it. Adoption creates a new distributor-owned backlog item; it does
   not turn the remote record into shared mutable work.
5. The source sees received interest and help receipts in Delivery Flow. It may
   stop sharing at any time; a withdrawal is queued over that connection.

Multiple customer, reseller, and specialist relationships can coexist. Each
link has an independent projection contract and selection set. Creating one
partner never grants exclusivity or silently selects demand for another.
The interface deliberately hides the reverse faces (`manages` and
`channel-upstream`) from outbound sharing, and the server rejects a crafted
request that attempts to use them.

## Founder Hub business management

The central Founder Hub installation manages resellers from the Connections
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
