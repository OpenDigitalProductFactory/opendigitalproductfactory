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

## Live backlog coverage

The umbrella BI remains open until the physical acceptance gate passes. Each
independently shippable increment is mapped below so completion evidence and
remaining work are visible outside this document.

| Increment | Backlog item | Delivery state at 2026-08-08 |
| --- | --- | --- |
| 1. Instance identity | BI-62DE5912 | Done; merged in PR #4097 |
| 2. mDNS/DNS-SD discovery | BI-52D34506 | Source merged in PR #3308; Windows native-host and real add/remove acceptance remain |
| 3. SAS pairing | BI-7432348C | Crypto core merged in PR #4098; identity-bound transport and numeric-comparison workflow remain |
| 4. Introducer / hub | BI-6EF4288A | Open |
| 5. Queue-based inbox delivery | BI-42617832 | Open |
| 6. Version-vector conflict model | BI-51FD61F1 | Done; merged in PRs #4099 and #4102 |
| 7. SAS-first Connections UX; manual recovery only | BI-51F5229B | Open |
| Physical two-instance acceptance | BI-05EB708F | In progress |

## Increments

Each is an independent PR; later increments depend on earlier ones as noted.

1. **Instance identity (BI-62DE5912; delivered).** A stable Ed25519 signing keypair per install;
   the device ID is its public-key fingerprint (`did_<sha256-hex>`). Foundation for SAS
   pairing, discovery, and address-independent links. Stored in the existing
   `PlatformConfig["federation.identity"]` blob (no migration); private key encrypted at
   rest via `credential-crypto` (same as `peerTokenEnc`). Legacy identities upgrade in
   place on first read. Pure crypto in `lib/federation/instance-identity.ts`.
2. **mDNS/DNS-SD discovery (BI-52D34506; acceptance incomplete).** Advertise `_dpf-federation._tcp.local.` (device ID + address);
   browse and list nearby installs. Extends `nearby-candidates` / `nearby-pairing-service`.
3. **SAS pairing (BI-7432348C; transport wiring incomplete).** ECDH ephemeral exchange + 6-digit Short Authentication String numeric
   comparison, authenticated against the increment-1 identity keys. Replaces invite-token /
   pasted URL / bare dual-approve (which has zero MITM protection).
4. **Introducer / hub (BI-6EF4288A).** One trusted peer introduces others (customer→reseller→hub), the
   Syncthing introducer pattern.
5. **Queue-based inbox delivery (BI-42617832).** Deliver demand envelopes to a peer inbox as `WorkQueue`
   jobs (retry/backoff/telemetry), retiring the hand-rolled outbox loop. ActivityPub model.
6. **Version-vector conflict model (BI-51FD61F1; delivered).** Per-installation counters on the mirror; one-sided
   dominance = clean, divergence = explicit conflict. Kernel-decided over CRDT
   (DI-1BC547243903). Supersedes the wall-clock scalar (interim BigInt fix #4092).
7. **SAS-first Connections UX; manual recovery only (BI-51F5229B).** Nav entry landed in #4094;
   this retires the invite/paste/approve flow to recovery-only and fixes the scope/env labels.

## Acceptance gate (was missing the first time)

Every increment carries unit tests; the epic is not "done" until an **end-to-end
two-instance validation** (BI-05EB708F: two installs discover → SAS-pair → demand mirrors both ways with
correct version-vector ordering) passes on real installs.
