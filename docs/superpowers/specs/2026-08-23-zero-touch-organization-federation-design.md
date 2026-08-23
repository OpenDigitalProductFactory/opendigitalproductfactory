---
status: binding
---

# Zero-Touch Same-Organization Federation and Work Sync

| Field | Value |
| --- | --- |
| Date | 2026-08-23 |
| Epic | `EP-MSP-FEDERATION` (enrollment), `EP-1FABA22D` (instance stance) |
| Surface | `@dpf/db` federation contracts, federated record sync, instance stance |
| Owners | Federation, installation lifecycle |
| Related | `2026-08-22-installation-identity-and-agent-stance-design.md`; federated record sync (B3/B5); organization join package (`BI-A8399604`) |

## 1. Decision

A same-organization federation link shall **derive its trust from the
organization CA instead of asking a human to approve it**, and backlog work shall
be a federated record type so it survives the installation that produced it.

The driving requirement: a development companion is created and destroyed
**thousands of times without human intervention**. Each cycle produces and
resolves backlog items. Any design that needs a person in the loop per cycle
does not work at that cadence, and any design without work sync loses that work
on every teardown.

## 2. The flaw

DPF already models the distinction it fails to act on:

- `FEDERATION_RELATIONSHIP_PRESETS` includes `same-organization` alongside
  `service-provider`, `channel`, and `community-peer`.
- `FEDERATION_ROLES` includes `same-org-peer`.
- The organization join package (`organization.join.issue` / `.import`) already
  establishes PKI trust: an authority install issues a package carrying a CA URL,
  root fingerprint, intended peer, SANs, and a TTL; a member imports it.

And yet **every link requires manual dual approval regardless of relationship**.
A repository-wide search finds no auto-approval path: `approvedAtLocal` and
`approvedAtPeer` are always set by a human action.

Dual approval is *correct* for a cross-organization link. An MSP and its customer
are separate sovereigns; neither may enrol the other unilaterally, and the
approval is the consent record. Applying the same ritual to a same-organization
link re-asks a question the organization CA already answered when it issued the
join package. It buys no security and costs the entire unattended lifecycle.

Verified on a live install on 2026-08-23: zero `FederationLink` rows, zero
`FederatedRecordMirror` rows, peer reachable on the LAN. The mechanism was never
set up because setting it up is a human ritual.

## 3. Research and benchmarking

| System | Useful pattern | DPF decision |
| --- | --- | --- |
| [Kubernetes node bootstrap TLS](https://kubernetes.io/docs/reference/access-authn-authz/kubelet-tls-bootstrapping/) | A node presents a bootstrap credential and its CSR is auto-approved by a controller when it matches policy; humans approve only the exceptions. | Adopt: same-organization links auto-enrol on evidence; everything else falls back to a human. |
| [SPIFFE / SPIRE node attestation](https://spiffe.io/docs/latest/spire-about/spire-concepts/) | Workload identity is *attested* from platform evidence, not typed in by an operator. | Adopt evidence-based enrolment with a closed refusal set. |
| [HashiCorp Consul auto-join with cloud auto-discovery](https://developer.hashicorp.com/consul/docs/install/cloud-auto-join) | Cluster members find each other and join automatically inside a trust boundary. | Adopt for the LAN case; keep the boundary at the organization root, not the subnet. |
| [Step CA provisioners](https://smallstep.com/docs/step-ca/provisioners/) | A short-lived, scoped provisioning token authorises unattended certificate issuance. | Reuse the existing join package TTL as the enrolment window. |
| [Syncthing device introduction](https://docs.syncthing.net/users/introducer.html) | An introducer device can transitively add peers without per-pair confirmation. | Adopt the shape; bound it by the organization root rather than by any peer. |

Rejected: joining on subnet adjacency alone (a LAN is not a trust boundary),
trust-on-first-use without a pinned root, and a shared static pre-shared key
across an organization.

## 4. Safety invariants

1. **Auto-enrolment is evidence-gated and fails closed.** Every path that cannot
   prove same-organization trust returns `manual-approval`. Missing evidence can
   never be the reason a link enrols.
2. **Certificate verification is performed, never claimed.** `certificateVerified`
   must be the result of a real chain verification against the pinned root, not a
   field copied from the peer's request body.
3. **Auto-enrolment does not widen authority.** An auto-enrolled link gets the
   same scoped projection contract, the same revocation path, and the same
   quarantine states as a hand-approved one. It removes a confirmation, not a
   control.
4. **Cross-organization keeps the human.** `service-provider`, `channel`, and
   `community-peer` are unchanged.
5. **An expired join package cannot enrol.** Membership must be re-established.
6. **Only the canonical side mutates a mirrored record**, unchanged from B3.

## 5. Contracts

### 5.1 Enrolment decision core

`evaluateOrganizationEnrollment({ proposal, localTrust, peer, now })` is pure and
total, returning `auto-enroll` or `manual-approval` with a closed reason:

| Reason | Meaning |
| --- | --- |
| `relationship-is-cross-organization` | Not a `same-organization` proposal (includes unrecognised presets). |
| `role-not-allowed-for-relationship` | The role is not permitted for a same-organization link. |
| `organization-trust-not-configured` | This install never joined an organization. |
| `peer-certificate-not-verified` | Chain verification against the pinned root failed. |
| `root-fingerprint-mismatch` | The peer chains to a different organization root. |
| `organization-ref-mismatch` | The peer reports a different organization. |
| `join-package-expired` | Membership window has closed. |

Time is injected so a decision is reproducible.

### 5.2 Work as a federated record type

`FEDERATED_RECORD_TYPES` gains `backlog-item` and `epic`. They reuse the existing
mirror wholesale: canonical-side ownership, per-installation version vectors for
causal ordering, and the existing `conflict` / `dead-letter` / `withdrawn` /
`revoked` states. No new sync engine.

### 5.3 Work sync is not a peer write

The instance stance previously said a development install must "never write to"
its paired peer. That conflated two different things:

- mutating a record the **peer owns** — correctly forbidden from a development
  install; and
- mirroring a record **this install owns** — which the canonical-side rule
  already governs safely.

`peerWrite` now means only the first, and a separate `workSync` stance states the
second. Without this separation the identity work shipped on 2026-08-22 would
have forbidden the very sync this design depends on.

## 6. Lifecycle at scale

The unattended cycle this enables:

1. Install receives an organization join package (already an installer flag:
   `--organization-join-package` / `-OrganizationJoinPackage`).
2. It discovers an organization peer and proposes a `same-organization` link.
3. Enrolment is derived from the shared root — no human.
4. Backlog items and epics mirror as they are created and resolved.
5. Teardown destroys the install; the work is already on the peer.

Step 5 is what makes teardown cheap. The `teardown: capture-required` brake from
the identity design remains the backstop for an install with **no** peer.

## 7. Non-goals

- No change to cross-organization enrolment.
- No new sync engine, transport, or trust root.
- No subnet-based or trust-on-first-use joining.
- Discovery itself is out of scope here; this design covers what happens once a
  peer is proposed.

## 8. Acceptance criteria

1. Two installs chaining to the same organization root, proposing a
   `same-organization` link with an allowed role and an unexpired package,
   auto-enrol.
2. Every other combination returns `manual-approval` with a closed reason.
3. Unrecognised presets and roles refuse rather than defaulting open.
4. `backlog-item` and `epic` are federated record types and reconcile through the
   existing mirror.
5. A development install paired with an organization peer resolves
   `workSync: same-organization` while `peerWrite` stays `read-only`.

## 9. Decision record

- **Derive trust, do not re-ask it.** The join package is the consent record for
  same-organization membership; a second per-link approval restates it.
- **Fail closed on every missing fact.** The failure mode of wrongly auto-enrolling
  is a trust breach; of wrongly refusing, one human click. Asymmetric.
- **Separate `workSync` from `peerWrite`** rather than loosening `peerWrite`.
  Loosening it would have let a development install mutate production business
  records to unblock a backlog sync.
- **Reuse the mirror.** A second sync path for work would duplicate conflict
  handling and diverge from `incident` and `demand-envelope`.
