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

### 5.4 Composing discovery with the trust decision

Discovery, enrolment, and the trust decision all existed separately; nothing
joined them, so every discovered peer routed through a SAS session in which a
person compares a short code. `decideAutomaticPairing` is that missing step. It
returns `auto-enroll`, `operator-confirmation`, or `blocked`.

`nearby-candidates` already anticipated this: its `AutomaticPairingReadiness`
names what *blocks* automatic pairing (`tls-validation-required`,
`blocked-insecure-transport`). Nothing consumed it.

Two orderings carry the safety:

1. **Transport is evaluated before trust, and is absolute.** A peer advertised
   over plain HTTP is `blocked` outright — an unverifiable channel cannot carry a
   verifiable identity, however well-formed the certificate claims are. This holds
   even when organization trust would otherwise pass.
2. **HTTPS is not proof.** A candidate discovered over HTTPS but not yet
   chain-validated routes to the operator. `tls-validation-required` is a to-do,
   not a result; treating it as a result would be the vulnerability this design
   exists to avoid.

Only a chain-validated same-organization peer reaches `auto-enroll`. Every other
outcome falls back to the confirmation flow that exists today, so a gap in
evidence costs a human confirmation rather than an unearned trust decision.

`mayPairWithoutOperator` is a named predicate rather than a `!== "blocked"` test,
so a caller cannot skip the pairing code by treating `operator-confirmation` as a
pass.

### 5.5 Resolving the organization trust anchor

Both the enrolment decision and the pairing decision need two facts: the root
this installation pins, and the organization it belongs to. Importing a join
package already establishes them, but the `organization.join.import` evidence
blob deliberately records only a **truncated 12-character fingerprint prefix**.

A prefix is not an identity. `resolveOrganizationTrustAnchor` therefore decrypts
the stored package and parses the **full 64-character fingerprint**, using the
same parser the import path used — so a package that would be rejected on import
cannot be accepted here. Expiry is surfaced from that parser rather than
re-checked, because the parser owns the rule and a second check could only
disagree with the authority.

Every unreadable path fails closed to *no anchor*: no join import, an
undecryptable package (a rotated key returns null rather than throwing), an
unparseable or expired one, or an installation with no organization. That default
is what keeps the rest honest — a null fingerprint makes
`evaluateOrganizationEnrollment` return `organization-trust-not-configured`, so a
decrypt failure costs a human confirmation instead of widening trust.

Decryption is injected, so the resolver never imports the credential store and a
failure is a value rather than a thrown error.

### 5.6 Verifying the peer against the pinned root

§5.4 will only auto-enrol a peer whose chain was *actually* validated against the
organization root. Nothing produced that fact: discovery reports
`tls-validation-required`, which is a to-do, and no peer-certificate inspection
existed anywhere in the codebase.

`verifyPeerChainAgainstRoot` is the evaluation half, and it is pure — the caller
supplies the chain it observed. Keeping it pure means the security rule is
testable without a TLS server, and a network adapter cannot quietly change what
"verified" means.

Two details carry real weight:

- **Fingerprint forms must be normalised.** Node reports `AA:BB:CC:…`; a join
  package records 64 bare hex characters. Comparing those directly would never
  match, so both collapse to lowercase hex, and anything that is not exactly 64
  hex characters is rejected rather than compared loosely.
- **Validity is checked across the whole chain**, not just the leaf. An expired
  intermediate breaks the chain as surely as an expired leaf.

Verification requires a positive match against the pinned fingerprint. There is
no path where an absent, malformed, or unmatched value yields `verified: true`.

### 5.7 Observing the chain

`verifyPeerChainAgainstRoot` is pure and needs a chain to judge. The observer
opens a TLS connection, walks the presented chain leaf-to-root, and hands it over.
Nothing else. Keeping observation apart from the rule means a change to the
network path cannot alter what "verified" means.

**Certificate validation stays on.** An organization CA is a private root the
public trust store does not contain, so the organization root is supplied as the
only acceptable `ca` and Node performs real chain validation against it. That is
narrower than the public trust store, not looser.

An earlier draft disabled validation and compared the root fingerprint by hand.
CodeQL flagged it (`js/disabling-certificate-validation`) and was **right**: a
fingerprint match proves a certificate with that fingerprint appeared in the
chain, not that the leaf was signed by it. Only the TLS stack checks the
signature chain. The fingerprint comparison in §5.6 remains, but as defence in
depth on top of real validation rather than instead of it.

If the organization root is not readable, observation fails closed rather than
falling back to a weaker check.

Three hardening details:

- **Cycle and depth bounds.** A peer that presents a cyclic issuer graph must not
  hold the walk open; the walk tracks seen certificates and caps depth.
- **SNI omits IP addresses.** RFC 6066 forbids an IP in server-name indication, so
  a LAN peer discovered by address is connected to without it.
- **It never throws.** Every failure — unparseable endpoint, plain HTTP, timeout,
  refused connection — is an unobserved result, which leaves the decision at
  `operator-confirmation`. An unreachable peer costs a human confirmation, never
  an assumption.

### 5.8 Composing the evidence, and the open attribution question

`resolveCandidatePairingMode` gathers the anchor (§5.5), the observed chain
(§5.7), the verification (§5.6), and the decision (§5.4) for one candidate, and
returns the mode **together with the evidence that produced it** — so a caller
records *why* a peer was or was not eligible, not merely the verdict. A peer whose
transport already disqualifies it is never dialled.

**What remains, and why it is not guessed here.** Bypassing the pairing code means
approving a `FederationPairingSession` without a human, but
`approveIncomingNearbyPairing` takes a required `approverPrincipalId`. Supplying a
person's principal for a decision no person made would falsify the audit trail,
and the whole point of this design is that trust is *derived from evidence* rather
than asserted.

So the remaining slice is an attribution decision, not wiring:

- attribute an automated enrolment to a governed non-human identity (GAID already
  models non-human actors), or
- record approval provenance as `organization-trust` on the session, distinct
  from principal approval, so the audit trail states plainly that no person
  approved it and which evidence did.

Either is defensible; inventing one silently is not. Until it is settled, the
resolved mode and its evidence are computed and recorded, and the code comparison
still stands.

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
- Discovery transport and advertisement remain owned by `nearby-candidates`;
  this design consumes its readiness signal rather than replacing it. Composing
  discovery with the trust decision is §5.4 and is no longer deferred.
- Calling §5.4 from the pairing path, so a validated same-organization peer
  enrols without the code comparison, is the remaining slice. Trust-anchor
  resolution is §5.5; peer chain verification is §5.6. The network adapter that
  observes a live chain is part of that final slice.

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
6. A plain-HTTP candidate is `blocked` regardless of organization trust; an
   HTTPS-but-unvalidated candidate routes to `operator-confirmation`; only a
   chain-validated same-organization peer reaches `auto-enroll`.
7. The trust anchor resolves the full fingerprint from the stored package, and
   every unreadable path yields a null anchor rather than a partial match.
8. Peer verification matches fingerprints across colon-separated and bare hex
   forms, rejects an expired certificate anywhere in the chain, and never reports
   verified without a positive match against the pinned root.

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
