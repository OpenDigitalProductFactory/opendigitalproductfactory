# Federation pairing redesign: discovery over manual handshake

Status: draft
Supersedes (human-facing flow): the manual invite → paste-URL → dual-approve pairing
Builds on: `2026-08-06-federation-zero-shell-autodiscovery-increment.md`, mutual-token enrollment (bilateral trust substrate)

## Problem (observed, not theoretical)

Same-organization pairing today is a hand-rolled device-pairing + key-exchange flow:
an operator issues an invitation token on box A, copies it, opens box B **at the
correct LAN address** (not `localhost`), pastes the URL + token, then approves on
both boxes. In a single real pairing session this failed repeatedly, each failure
silent and diagnosable only from the database:

- `localhost` self-advertisement — the auto-derived self address is the browser's
  Host header, so opening the page at `localhost` advertised `localhost` to the peer.
- malformed peer URL (backslashes) accepted but confusing.
- approving the stale link instead of revoking + redoing.
- a genuine one-directional-token defect: the inviter had no outbound token, so its
  approval could never reach the connector — connector stuck `pending` forever
  (fixed separately in the mutual-token enrollment change).

The manual flow reimplements — poorly, and with silent failure modes — what device
meshes solved long ago.

## Precedent

| System | Identity | Rendezvous | Human step |
| --- | --- | --- | --- |
| Syncthing | device ID = public-key hash | discovery server + relays | add device ID once |
| Tailscale | per-device keypair | coordination server, org login | sign in to the org |
| Matrix / ActivityPub | published server keys | DNS / WebFinger | none |
| Chromecast / Bluetooth | — | LAN (mDNS) | confirm a short code |

Two ideas recur: a stable cryptographic **identity** per instance, and a
**rendezvous** (coordination service or LAN discovery) so humans never handle URLs
or tokens.

## Design

Keep the mutual-token link as the trust **substrate** — bilateral tokens/keys are
required under any UX (Tailscale exchanges keys both ways too). Replace only the
**human-facing** invite/paste/approve with discovery + confirm.

### Foundation — instance identity
Give each install a stable keypair and publish the public key at a well-known path.
Peers authenticate signed requests against it (trust-on-first-use, or vouched by the
coordination hub). Identity then travels with discovery instead of operator copy-paste.

### Path A — same-LAN auto-discovery + short code
1. Each box advertises on the LAN via mDNS/DNS-SD (`_dpf-fed._tcp`), carrying its
   installation id, public-key fingerprint, and a **reachable** address the box
   selects from its own non-loopback interface (or an operator-pinned value) — never
   the browser tab, which removes the `localhost` foot-gun by construction.
2. Box B's Connections page lists **Nearby installations** automatically — no URL entry.
3. The operator clicks one; both screens display the **same short numeric code**;
   confirm on both. That single confirm replaces invite-token + paste + dual-approve.
4. On confirm, the mutual-token enroll runs automatically and the link goes trusted.

Existing substrate to extend: `nearby-candidates`, `requestNearbyPairing`,
`summarizeNearbyPairingProjection`, `nearby-pairing-service`. Today auto-pairing
requires cert-valid HTTPS; the short-code confirm makes plain LAN safe without certs.

### Path B — hub-mediated (channel / cross-org)
For downstream→upstream relationships across sites/NAT, boxes register to the same
organization on the coordination hub (the platform's backing-service concept). The
hub knows membership and vouches for keys, so:
- no LAN line-of-sight required;
- trust is org-membership rather than manual approval;
- direction is enforced by the hub's role model.

This is the coordination-server model mapped onto the existing backing-service concept.

### What it retires
Invitation tokens, pasted peer URLs, the dual-approve click sequence, and the
`localhost` / malformed-URL foot-guns. Operator experience becomes: same-org boxes
see each other and confirm a code (LAN), or sign into the same org (hub).

## Increments

1. Instance identity + published public key (enables signed peer auth).
2. LAN advertise/discover hardening — advertise a non-loopback address; list nearby
   installations on the Connections page.
3. Short-code confirmation over plain LAN (replaces token paste for same-org).
4. Auto mutual-enroll on confirm — wire the confirm to the bilateral-token handshake.
5. Hub-mediated org join — register-to-org → auto-mesh for channel / cross-org.
6. Deprecate the manual invite/paste/approve UI once 1–5 cover the cases.

## Non-goals

- Not multi-master backlog replication (unchanged — single-writer sources + versioned mirrors).
- Not changing the projection / minimization contract.
- Not removing the mutual-token substrate — this sits on top of it.
