---
status: binding
---

# Zero-Configuration Same-Organization Federation

| Field | Value |
| --- | --- |
| Date | 2026-09-02 |
| Epic | `EP-ZERO-CONFIG-FEDERATION` |
| Surface | federation identity, links, exchange routes, self-upgrade scheduler, install state |
| Owners | Federation, installation lifecycle |
| Supersedes in part | `2026-08-23-zero-touch-organization-federation-design.md` §5.8 (attribution) and §7 (the "remaining slice"); `2026-07-19-federated-demand-network-design.md` dark-launch flag |

## 1. Decision

An installation that belongs to an organization pairs with the organization's
other installations and keeps its backlog in step with them **with no flag, no
approval click, no token that can go stale, and no page that tells a person to
upgrade the other box**. Membership — holding the organization's join package —
is the only switch. Install and teardown cycles keep the installation's
identity, so a peer's trust never rots.

Founder ruling, 2026-09-02, after a night in which sync between the paired
development and production installs failed at every configurable seam:

> "Any opportunity to fail we will fail. More parameters, switches, blanks to
> fill out, the more failures there will be. We need to prevent opportunities
> to fail at all cost."

## 2. The seams, measured

Each of these had to be right for backlog sync to work on 2026-09-02, and each
was wrong at least once:

| Seam | What happened |
| --- | --- |
| `DPF_FEDERATION_EXCHANGE_ENABLED`, default off, no error anywhere | Off on one side until 2026-08-29; the peer's pushes 404'd and dead-lettered past the re-heal cap. |
| Human dual approval on both sides | Three trusted links from earlier install cycles on production, one live; nobody could tell which. |
| Identity and link tokens only in Postgres | A reinstall mints a new identity; every link the peer holds points at a box that no longer recognises it — forever "waiting". |
| Backlog crossed as adoptable demand | No backlog row ever landed. Fixed by `2026-08-23` §5.11 (work sync as a pull). |
| Hand-written wire validator | First live pull refused on one prose field. |
| Scheduled self-upgrade skips when anything is happening | Never ran once on the development install; the edge node heartbeats every minute. |
| Status on a panel a person has to open | Nobody saw "waiting" for five days. |

## 3. Research and benchmarking

| System | Pattern | DPF decision |
| --- | --- | --- |
| [Tailscale node identity](https://tailscale.com/kb/1010/node-keys) | A node's key pair is generated once and persisted in its state file; the node re-authenticates with the same key across restarts and reinstalls that keep the state directory. | Adopt: the installation's federation identity lives in the state directory the installer already preserves, and the database is a cache of it. |
| [Syncthing device IDs](https://docs.syncthing.net/dev/device-ids.html) | The device ID is the fingerprint of a certificate kept in the config directory; peers trust the ID, not an ephemeral token, and an introducer adds further devices without per-pair confirmation. | Adopt the shape: peer trust is keyed on the durable installation id and device id; the peer ledger is persisted beside the identity. |
| [WireGuard](https://www.wireguard.com/#cryptokey-routing) | Static keys on disk; a peer is `(public key, endpoint)`; no session state to lose. | Adopt: a same-organization peer is `(installationId, deviceId, authority URL)`; everything else is re-derivable. |
| [Kubernetes kubelet TLS bootstrapping](https://kubernetes.io/docs/reference/access-authn-authz/kubelet-tls-bootstrapping/) | A node presents a bootstrap credential and its certificate is auto-approved when it matches policy; humans see only exceptions. | Adopt for the second slice: a member proves membership with the certificate its join package earned it, and the link is born trusted. |
| [SPIFFE / SPIRE](https://spiffe.io/docs/latest/spiffe-about/overview/) | Identity is attested from platform evidence and carried in a document, not typed by an operator. | Adopt: no operator ever types a peer name, URL or code. |

Rejected: trust-on-first-use (a LAN is not a trust boundary), a shared static
pre-shared key across an organization, and "just keep the flag but default it
on" (a flag that is always on is dead code that still fails when someone sets
it).

## 4. Safety invariants

1. **No new authority.** A durable identity and a persisted peer ledger change
   *where* facts live, not *what* a peer may do. Projection contracts, revocation
   and quarantine are unchanged.
2. **Fail closed on identity.** If the state directory is missing or unwritable,
   the portal runs as today (database identity) and reports `durable: false` in
   the federation stance; it never invents a second identity while one is on
   disk.
3. **The file wins.** When the state directory carries an identity and the
   database disagrees, the database is corrected. A reinstalled database never
   overrides the identity a peer already trusts.
4. **Secrets at rest keep the state directory's protection level.** The private
   signing key and the peer-issued tokens are written mode `0600` under
   `<state dir>/federation/`, the same directory that already holds
   `pki/authority.key`.
5. **Supersession is monotone.** A newer trusted link to the same peer revokes
   older ones; it never revives a revoked link.
6. **Only the canonical side mutates** (unchanged from work sync).

## 5. Contracts

### 5.1 Durable federation identity

`<state dir>/federation/identity.json` (portal-owned, mode `0600`):

```json
{ "schemaVersion": 1, "installationId": "inst_…", "projectionSecret": "…",
  "deviceId": "did_…", "signingPublicKey": "…", "signingPrivateKey": "…",
  "writtenAt": "2026-09-02T10:00:00.000Z" }
```

The base compose file mounts `${DPF_STATE_DIR}/federation` read-write at
`/dpf-federation`. Resolution order in `resolveFederationIdentity`:

1. Read the file. If present and well-formed, it is the identity. Ensure the
   database row matches (same ids, private key re-encrypted under the current
   `CREDENTIAL_ENCRYPTION_KEY`); correct it if not.
2. Otherwise read the database as today. Then write the file. If the stored
   private key cannot be decrypted (rotated key), keep `installationId` and
   `projectionSecret` — those are what peers hold — and mint a fresh signing
   keypair; peers re-learn the device id on their next exchange.
3. Otherwise mint, write the file, write the database.

### 5.2 Peer ledger

`<state dir>/federation/peers.json` (portal-owned, mode `0600`): every
non-revoked link, with `linkId`, `role`, `peerAuthorityUrl`, `peerInstallationId`,
`peerDeviceId`, `peerOrganizationRef`, `displayName`, `tokenHash`,
`tokenPrefix`, the peer-issued token in clear, `approvedAtLocal`,
`approvedAtPeer`, `enrolledAt`, and `metadata`.

Written after every link mutation and on every federation tick. Absorbed at
boot: a ledger entry with no database link recreates the principal, alias and
link exactly (state derived from the approvals). Absorption is idempotent and
never overwrites a database link that exists.

Inbound authentication needs only `tokenHash`; the peer keeps presenting the
same bearer token and a rebuilt database validates it. Outbound calls need the
peer's token in clear, which is why it is in the ledger.

### 5.3 Supersession

Among non-revoked `same-org-peer` links, group by `peerInstallationId` when
known, else by normalised `peerAuthorityUrl`. The newest `enrolledAt` wins; the
rest are revoked with reason `superseded-by:<linkId>`. Runs at boot, on every
federation tick, and after any enrolment. On production this retires the two
links from earlier install cycles without a click.

### 5.4 Exchange is always on

Every `DPF_FEDERATION_EXCHANGE_ENABLED` gate is removed. Authentication on a
trusted link is the gate. The compose passthrough stays for one release as a
no-op so an existing `.env` does not break interpolation, then goes.

### 5.5 Scheduled self-upgrade drains instead of skipping

The scheduled poll uses the same rule as a manual "Upgrade now": only a hard
blocker (a coworker reasoning loop, a Build Studio phase) skips; soft signals
such as recent tool executions enter the drain, which converges immediately
when nothing hard is running. An install with an edge node or waiting agent
sessions upgrades on its own.

### 5.6 Membership proof without TLS (second slice)

A member holds `authority.crt` / `authority.key` issued by the organization's
CA from its join package, and the organization root. Pairing therefore does
not need the optional TLS overlay: a member signs an enrolment statement with
its authority key and presents its chain; the receiver verifies the chain
against its pinned root (`verifyPeerChainAgainstRoot`, already pure) and the
signature, and the link is born trusted on both sides with
`confirmationProvenance: "organization-trust"`. The join package gains an
optional `authority_portal_url`; a member enrols with the authority
installation named there at boot, and the authority introduces the other
members over the trusted link (`FederationIntroductionCandidate`). No mDNS, no
discovered candidate, no code comparison, no click.

### 5.7 One health line (third slice)

The federation stance in the cockpit and the MCP briefing carries one of:
`In step`, `Behind by N`, or `Broken because <one sentence>`, where the sentence
names something the platform fixes itself or the exact next step.

## 6. Slices

1. **Durable identity, peer ledger, supersession, no flag, upgrade drains.**
   Server-side only; no new UI; removes every seam that bit on 2026-09-02.
2. **Membership-proof pairing** (§5.6).
3. **Health line** (§5.7) and validator bounds derived from the schema.

## 7. Acceptance criteria

1. Tear down and reinstall a member keeping `DPF_STATE_DIR`; the peer's link
   keeps working with no action on either side.
2. A fresh database on a member absorbs the ledger at boot and shows the same
   trusted links, and the peer's next work-sync pull succeeds.
3. Three trusted links to one peer collapse to one at the next tick, with the
   two older ones revoked `superseded-by:` the newest.
4. No route, action or job reads `DPF_FEDERATION_EXCHANGE_ENABLED`.
5. A scheduled self-upgrade on an install with only soft activity proceeds to
   drain and swaps.
6. (Slice 2) Two installs holding the same organization root pair and reach
   `trusted` on both sides without a person.
