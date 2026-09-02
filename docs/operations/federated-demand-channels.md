# Federated demand channels

DPF installations keep their own PostgreSQL backlog. A federated demand channel
shares a deliberately minimized demand envelope; it never exposes or co-writes
the source backlog. The source installation decides which item can travel over
which connection and may withdraw that projection independently.

## How an installation advertises its own address

When you invite or connect to a peer, this installation tells the peer the
address to reach it at. That address is resolved automatically — the operator
does not type it:

1. If `PUBLIC_URL` (or `NEXT_PUBLIC_*`) is configured it is used — the correct
   choice for a reverse-proxy or public deployment.
2. Otherwise the address is taken from the **request host** — the address you
   used to open the Connections page. Opening
   `http://192.168.0.152:3000/platform/federation-links` advertises
   `http://192.168.0.152:3000`, which is exactly what a same-network peer can
   reach. (The container's own network address cannot be used: inside the portal
   container it is the Docker bridge address, not the reachable LAN address.)

So a same-organization LAN pairing needs no typed URL — open the Connections
page at the installation's LAN address and pair.

Because the address is taken from how you reached the page, **open it at the LAN
address, not `localhost`** — the address you view it at is exactly what the peer
is told to use. As a safety net, connecting is refused with a clear message if
this installation would advertise a loopback address (`localhost` / `127.x` /
`::1`) to a peer on a different host, since the peer could never reach it. Two
instances on one host may still pair over loopback.

## Local-network peers over http

Outbound calls to a peer default to HTTPS-only with private/loopback networks
blocked (SSRF protection). Two things relax that for on-premises LAN federation:

- `DPF_FEDERATION_ALLOW_INSECURE_PEERS=1` — a global operator flag (all peers).
- **Automatically, with no flag, for a same-organization peer whose address is a
  private/loopback host** (for example `http://192.168.0.200:3000`). This scoped
  allowance is narrower than the global flag: a public or DNS-named peer still
  requires HTTPS even when it is a same-organization link, so channel/reseller
  connections to public hosts are unaffected.

Combined with automatic address resolution above, a same-organization LAN
pairing needs no typed URL and no typed flag — install, then Connect and Approve.

## Same-company installations

Approved `same-organization` connections synchronize share-safe platform demand
in both directions. Every installation runs the same reconciliation policy, so
new eligible work and later source updates become visible to the other internal
installations without another sharing click. This is the normal pattern for a
company operating separate Mac, Windows, development, or test installations.

Both directions work because enrollment is a **mutual** exchange: each side issues
the other an inbound link token, so either box can relay its approval and push
demand to the other. This is what lets a link reach `trusted` on **both** sides
(not just the inviter) and demand flow each way — a one-directional token exchange
would leave the connecting side stuck at `pending`.

This is not multi-master backlog replication. Each source backlog item remains
single-writer authoritative. Either installation can pause or revoke its link,
and expanding the projection requires approval on both sides.

### What survives a reinstall

An installation's federation identity and its list of peers live in the
`federation/` folder of the state directory (`~/.dpf` by default), beside the
organization certificates. A reinstall that keeps that directory keeps the
identity its peers trust and every connection it had; nothing needs to be
re-connected or re-approved on either side. Exchange is always on: a trusted
connection is the only switch, and there is no flag to set.

If an installation is rebuilt without its state directory, its peers see the
new identity arrive over the same address and retire the old connection on
their own ("superseded by" the new one) once a new connection is made. The
Connections page never carries two live rows for one installation.

### Backlog sync between your own installations

Approved `same-organization` connections also keep each other's **backlog** in
step. Every five minutes each installation pulls the other's share-safe backlog
items and epics and stores them as read-only rows in its own backlog, under the
same `BI-*` / `EP-*` ids. So a development installation shows the production
backlog it is meant to evolve, and the work a development installation files
is already on production before the development box is torn down.

- An item is changed only on the installation that created it; the copy follows
  on the next cycle, and a local edit to a copy is overwritten.
- Items marked `confidential` or `restricted` never leave their installation.
- If the source retires or deletes an item, the copy is retired.
- A copy carries a final body line `[origin:federatedWork:<installation>:<id>]`.
  That line is what keeps the copy from being shared onward, re-copied, or
  triaged here.
- **Operate → Delivery Flow** shows, per connection, how many items are
  mirrored, when the last copy landed, and whether any item shares an id with
  work created locally (those are left alone until the local one is renamed or
  retired).
- Each connection carries one sentence — "In step …", "Behind by …" or
  "Broken because …" — and the same sentence is what an AI coworker reads in
  its briefing. A "Broken because" sentence names the cause and what the
  platform does next; there is nothing for a person to type or click.

Demand sharing (above) is separate: a copy of a backlog item is not "demand"
to follow or adopt, and adopted demand is still owned by whoever adopted it.

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
