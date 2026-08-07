# Federation Robust-Design Build Plan (BI-67315C4A)

| Field | Value |
| --- | --- |
| Status | In progress |
| Date | 2026-08-07 |
| Backlog item | BI-67315C4A (EP-DELIVERY-FLOW) |
| Spec | `docs/superpowers/specs/2026-08-06-federation-zero-shell-autodiscovery-increment.md` |
| Reviews | dpf-architecture-review + dpf-ux-fit-review (recorded on BI-67315C4A); kernel decision DI-1BC547243903 (version vector) |

## Why

The Federated Demand Network shipped without market research, expert review, or the
queue substrate, and its core data path never worked end-to-end. This plan builds the
reviewed robust design in verifiable increments, each a PR with tests, replacing the
brittle invite-token/paste-URL/wall-clock-version machinery with standard mechanisms
(Syncthing device IDs, mDNS/DNS-SD, IETF SAS pairing, ActivityPub-style inbox on the
canonical `WorkQueue`, version vectors).

## Increments

Each is an independent PR; later increments depend on earlier ones as noted.

1. **Instance identity (THIS increment).** A stable Ed25519 signing keypair per install;
   the device ID is its public-key fingerprint (`did_<sha256-hex>`). Foundation for SAS
   pairing, discovery, and address-independent links. Stored in the existing
   `PlatformConfig["federation.identity"]` blob (no migration); private key encrypted at
   rest via `credential-crypto` (same as `peerTokenEnc`). Legacy identities upgrade in
   place on first read. Pure crypto in `lib/federation/instance-identity.ts`.
2. **mDNS/DNS-SD discovery.** Advertise `_dpf-federation._tcp.local.` (device ID + address);
   browse and list nearby installs. Extends `nearby-candidates` / `nearby-pairing-service`.
3. **SAS pairing.** ECDH ephemeral exchange + 6-digit Short Authentication String numeric
   comparison, authenticated against the increment-1 identity keys. Replaces invite-token /
   pasted URL / bare dual-approve (which has zero MITM protection).
4. **Introducer / hub.** One trusted peer introduces others (customer→reseller→hub), the
   Syncthing introducer pattern.
5. **Queue-based inbox delivery.** Deliver demand envelopes to a peer inbox as `WorkQueue`
   jobs (retry/backoff/telemetry), retiring the hand-rolled outbox loop. ActivityPub model.
6. **Version-vector conflict model.** Per-installation counters on the mirror; one-sided
   dominance = clean, divergence = explicit conflict. Kernel-decided over CRDT
   (DI-1BC547243903). Supersedes the wall-clock scalar (interim BigInt fix #4092).
7. **Deprecate manual pairing UI + finish navigation/labels.** Nav entry landed in #4094;
   this retires the invite/paste/approve flow to recovery-only and fixes the scope/env labels.

## Acceptance gate (was missing the first time)

Every increment carries unit tests; the epic is not "done" until an **end-to-end
two-instance validation** (two installs discover → SAS-pair → demand mirrors both ways with
correct version-vector ordering) passes on real installs.
