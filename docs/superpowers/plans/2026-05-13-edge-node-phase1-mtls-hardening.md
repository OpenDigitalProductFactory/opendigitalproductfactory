# DPF Edge Node — Phase 1: mTLS Hardening (sibling thread T4)

> **Status:** planning artifact. No code in this PR.
>
> **Naming reconciliation.** The Edge Node spec
> ([`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../specs/2026-05-09-dpf-edge-node-design.md))
> uses "**Phase 1+**" to describe cryptographic token binding
> (mTLS / DPoP / platform-attested keys). The Phase 0 and T2
> plan docs use the "**T4**" sibling-thread label for the same
> body of work. This plan is both — it is the spec's Phase 1
> mTLS slice **and** the T4 entry in the Phase 0 roadmap's
> "Real-LAN multi-host verification is then T2's job. … mTLS is
> T4's." sequence. The two labels are synonymous here.
>
> **Parent roadmap:**
> [`docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md`](2026-05-12-edge-node-phase0-roadmap.md)
> — "Verification gate" section names this thread as T4.
>
> **Sibling threads:**
> [`docs/superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md`](2026-05-12-edge-node-t2-multi-host-lan.md)
> (T2, **landed**); T3 (macOS/Windows native binary, planned); T5
> (air-gapped operation, planned).
>
> **Spec:**
> [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../specs/2026-05-09-dpf-edge-node-design.md).
> See § "Phase 0 token-binding posture (downgrade documented)"
> and § "Phase 1+ upgrade path (planned, not committed)".
>
> **What this doc is:** the work that takes Edge Node
> authentication from "per-node bearer over HTTPS" (Phase 0 / T2
> floor) to "Authority-signed client certificates with rotation,
> revocation, and CRL distribution" (Phase 1 / T4). Each item is
> sliced into a follow-on PR. The end of this doc commits the PKI
> substrate decision that gates every implementation slice.

## Phase 1 scope (what "done" means)

End-to-end demo, the same two-Linux-host LAN topology that T2
verifies, but the wire-level auth contract has changed.

```bash
# Host A (Authority Core)
bash dpf-start.sh
# First-run bootstrap mints the Authority Core CA (operator
# is prompted to record the root-key recovery passphrase).
# Operator opens Admin > Platform Development > Edge Nodes,
# clicks "Issue bootstrap token", copies the token.

# Host B (Edge Node — a different machine on the same LAN)
docker compose -f docker-compose.edge-standalone.yml up -d \
  -e DPF_AUTHORITY_URL=https://dpf-host-a.lan:443 \
  -e DPF_BOOTSTRAP_TOKEN=<token>

# On first boot, the Edge Node:
#   1. Generates a P-256 keypair in its container-private state dir
#      (libsecret / Keychain / Cred-Mgr-backed once T3 native
#      binaries land; 0600 file under Mode 1 for Phase 1, mirroring
#      the per-node-bearer storage downgrade with the same
#      `verifyStatePerms` gate)
#   2. Builds a CSR with SAN = nodeId, CN = <displayName>
#   3. POSTs CSR alongside the bootstrap token to /api/v1/edge/enroll
#   4. Authority signs the CSR, returns { cert, chain, nodeId,
#      heartbeatIntervalSec, sweepIntervalSec, certNotAfter }
#      (note: no `nodeToken` field — that field is null and
#      bearer issuance is disabled for cert-presenting enrollments;
#      see § Bearer-token deprecation)

# Verify on Host A (Authority Core):
#   - tcpdump / wireshark on :443 shows the ClientHello *with*
#     a Certificate message — mTLS handshake observed at the wire
#   - Admin > Platform Development > Edge Nodes row shows:
#       certSubject = CN=<displayName>, SAN=<nodeId>
#       certNotAfter within 90 days
#       certFingerprint matches what `openssl x509 -fingerprint`
#         reports for the cert on Host B
#   - Operator clicks "Revoke" → within one heartbeat interval
#     (default 60s) the Edge Node's next call returns 401 with
#     a revocation reason, and the audit row shows the revoke
#     event with the operator principal attribution
#   - Cert renewal: fast-forward the system clock on Host B to
#     14 days before `certNotAfter` (the configured renewal
#     window). The Edge Node submits a new CSR via
#     /api/v1/edge/rotate-cert on the next heartbeat. The new
#     cert lands, the old cert is honored for a grace window,
#     then refused. No operator action required.
```

## Out of scope for Phase 1 (deferred to later threads)

- **DPoP / OAuth2 token binding (RFC 9449 / RFC 8705).** The spec
  enumerates DPoP as an alternative cryptographic binding to
  mTLS. Phase 1 picks one — mTLS — because the operator burden
  (running a CA, distributing roots) is the right shape for a
  managed-host fleet. DPoP remains an open option for the
  external-MCP transport (`dpfmcp_*`) where browser / human
  clients are more common; that's a separate spec, not this one.
- **Platform-attested keys (TPM 2.0 / Secure Enclave / Windows
  Platform Crypto).** Strongest possession guarantee, but
  requires the T3 native-binary mode to reach the host's secure
  element. Phase 1 generates keys in software; T3 + a follow-on
  Phase 1.5 adds platform attestation.
- **Post-quantum crypto.** The spec's R&B comparator section
  flags PQC as a 5-year horizon item. Phase 1 ships ECDSA P-256
  + RSA-3072 fallback; PQC slot-in is a future migration.
- **Full air-gap CA operation.** T5 owns air-gap; Phase 1 assumes
  the Authority Core has network reachability to mint certs
  during enrollment and rotation. Air-gap PKI (offline-signing
  ceremony, USB-shuttled CRLs) is T5 territory.
- **Cross-organisation trust / federated CAs.** Single-org
  install (per project memory) — the Authority Core is the
  single trust anchor. Federated PKI is a B2B feature, not a
  Phase 1 concern.
- **Hardware Security Module (HSM) backing.** Operator can
  bolt a PKCS#11 HSM onto the chosen substrate in Phase 2;
  Phase 1 keeps the CA private key in the Authority Core's
  encrypted state directory.

## PKI substrate decision (load-bearing)

This decision gates every other slice. Three candidates, each
evaluated against the AGENTS.md §10 "Research & use standards"
rule and the project's stated principles.

### Option A — Build a minimal CA inside Authority Core

**Shape:** `apps/web/lib/pki/*` implements key generation,
CSR validation, x509 signing, CRL generation. The CA private
key lives in the Authority Core's encrypted state (Postgres
table with envelope encryption by an operator-supplied root
key) or in `~/.dpf/ca/` on the host filesystem.

**Pros:**
- Zero external runtime dependency; ships in the same container.
- Single trust anchor co-located with policy + audit envelope —
  the doctrine the Edge Node spec already establishes.
- Operator footprint matches "Zero-click provider setup"
  memory: bootstrap mints the CA on first run, no extra step.

**Cons:**
- **Building x509 + CRL correctly is high-risk work.** Every
  prior attempt by mid-size teams to roll their own CA has
  produced a CVE within 18 months. AGENTS.md §10's "find the
  existing standard" rule cuts strongly against this.
- No off-the-shelf revocation, OCSP, or audit tooling.
- The security reviewer's threat-model effort grows linearly
  with the surface we built ourselves rather than referenced.

**Risk grade:** **high** on implementation correctness.

### Option B — Embed Step CA (`smallstep/certificates`) as a sibling service

**Shape:** Step CA runs as a sidecar container under the same
docker-compose project as the portal. Authority Core's
`apps/web/lib/pki/*` becomes a thin client that talks to Step
CA over its loopback gRPC / REST API. Step's database lives in
the same Postgres instance (Step supports Postgres backends)
or in a dedicated volume.

**Pros:**
- **Standards-grade x509 PKI** — ACME, JWK, X5C provisioners
  built in; CRL + OCSP responders ship out of the box; rotation
  + revocation are first-class. Aligns with AGENTS.md §10.
- Step CA is the modern open-source equivalent of OpenSSL +
  EJBCA. Strong production track record (Cloudflare, GitHub,
  Smallstep itself dogfood it).
- Aligns with the **"Mirror Claude Code patterns"** memory:
  use the well-known production pattern, don't invent.
- The external security reviewer's effort focuses on the
  *integration* — provisioner config, key custody on disk,
  Authority-Core ↔ Step-CA channel — not on x509 correctness.
- Small footprint: ~25 MB static binary, single Go process.

**Cons:**
- Adds one container to the operator-visible compose surface.
  Mitigated by bundling under the bundled-services-active-by-
  default memory pattern: Step CA is platform plumbing, not an
  operator decision.
- One more upstream dependency to track (per the
  "Stay current on dependencies" memory — Step CA cuts
  releases monthly; that's manageable, but it's another
  bump-PR every month).

**Risk grade:** **low-to-medium**. The main risks are key
custody (covered by ops runbook) and Step CA stewardship
(covered by the project's stated dependency-bump cadence).

### Option C — Operator-provided external CA (BYO PKI)

**Shape:** Authority Core ships with no CA. Operator points
DPF at their existing internal CA (Active Directory CS,
Vault PKI engine, ACME endpoint they already run). DPF
submits CSRs via a configured protocol (ACME, EST, manual
upload) and stores the resulting certs.

**Pros:**
- Smallest DPF surface; aligns with the **"DPF is a conduit,
  not a broker"** memory pattern (the user runs their own
  CA, DPF just integrates).
- Enterprise customers with existing PKI infrastructure get
  drop-in integration without operating a second CA.

**Cons:**
- **Fresh-install onramp dies on PKI prereq.** A single-host
  install with no enterprise CA can't bring up the Edge Node
  without a manual CA-set-up step — that violates the
  "Zero-click provider setup" memory.
- High-friction adoption for the design-partner phase; only
  works for customers who already have a working internal CA.
- The "operator-trusted CA bundle" feature from T2.2 already
  covers the BYO server-cert case; adding BYO client-cert PKI
  is structurally different and much heavier.

**Risk grade:** **low technical, high adoption.**

### Recommendation: **Option B (Step CA embedded) with Option C
as a follow-on adapter for enterprise customers**

Rationale, mapped to project principles:

1. **AGENTS.md §10 — research & use standards.** Step CA is the
   standards-track open-source x509 PKI. Building our own (A)
   is the case AGENTS.md tells us to avoid; Step CA *is* the
   standard for this category.
2. **Memory: "Approach zero technical debt".** Option A is
   technical debt by construction — every CVE in x509 land
   becomes our incident. Option B is one Step CA bump per
   month and a small integration surface.
3. **Memory: "Zero-click provider setup".** Option B can
   auto-bootstrap on first run (Step CA's `step ca init`
   automation). Option C cannot; it requires an operator PKI
   step that doesn't exist in single-host installs.
4. **Memory: "Bundled services active by default".** Step CA
   becomes platform plumbing; the operator sees an Edge Node
   "just working" without ever being asked "which CA do you
   want to use".
5. **Memory: "DPF is a conduit, not a broker".** Option B
   doesn't violate this — Step CA is operator-owned, runs in
   the operator's compose project, and the operator can swap
   it for their own CA via Option C at any time. The
   `apps/web/lib/pki/*` interface is the seam.

The **Option C adapter** ships as a *follow-on thread* (call it
T4.5 / Phase 1.5) once Phase 1 lands. Same interface; different
backend. Enterprise customers who already run a CA get a
config knob; everyone else gets the embedded Step CA by default.

**Decision committed.** The remainder of this plan assumes
**Option B**.

## Phase 0 / T2 assumptions that don't survive an mTLS world

Each item below names the existing surface, the assumption that
breaks, and the slice that closes it.

### M1 — Bearer-only auth middleware on `/api/v1/edge/*`

**Surface:** `apps/web/lib/auth/edge-node-token.ts` validates
`Authorization: Bearer dpfedge_*` against `EdgeNode.tokenHash`.
There is no TLS client-cert plane on the request object — the
middleware can't yet read the peer cert.

**Action (T4 PR M3 — Authority mTLS middleware):** introduce an
mTLS-aware middleware that:
- reads the peer's client cert from the TLS termination layer
  (Next.js / Node `req.socket.getPeerCertificate()` or the
  proxy header `X-SSL-Client-Cert` when terminated upstream),
- validates the cert chain against the Authority CA bundle,
- looks up `EdgeNode` by `certFingerprint`,
- enforces `EdgeNode.trustState` and per-route scope (heartbeat
  / discovery:submit / rotate),
- writes an audit row via `apps/web/lib/edge-node/audit.ts`.

The bearer middleware stays in place during the transition
window and is removed by the bearer-token deprecation slice.

### M2 — `EdgeNode` table has no cert columns

**Surface:** `EdgeNode` carries `tokenHash` and rotation
timestamps but no place for cert serial / fingerprint / expiry.
The spec § "Phase 1+ upgrade path" foreshadows this; no schema
yet.

**Action (T4 PR M1 — Schema):** new tables and columns —

```prisma
model EdgeNodeCertificate {
  id                  String   @id @default(cuid())
  edgeNodeId          String                          // FK EdgeNode.id
  serial              String   @unique                // hex; matches x509 serial
  subject             String                          // canonical DN
  sanNodeId           String                          // SAN URI: spiffe://dpf/edge-node/<nodeId>
  fingerprintSha256   String   @unique                // hex; used for fast cert-to-row lookup
  notBefore           DateTime
  notAfter            DateTime
  issuedAt            DateTime @default(now())
  issuedByCaSerial    String                          // FK to CertificateAuthority.serial
  revokedAt           DateTime?
  revocationReason    String?                         // RFC 5280 reason code or "operator-action"
  rotatedFromSerial   String?                         // links to the previous cert during rotation grace
  edgeNode            EdgeNode @relation(fields: [edgeNodeId], references: [id], onDelete: Cascade)
  @@index([edgeNodeId, notAfter])
}

model CertificateAuthority {
  id              String   @id @default(cuid())
  serial          String   @unique
  subject         String                  // CN=DPF Authority CA, ...
  publicKeyPem    String   @db.Text       // for distribution to Edge Nodes + audit
  notBefore       DateTime
  notAfter        DateTime
  role            String                  // "root" | "intermediate"
  parentSerial    String?                 // null for root
  createdAt       DateTime @default(now())
  rotatedAt       DateTime?               // when this CA was rotated out
  // Private key is NOT stored here; it's in Step CA's encrypted store
  // referenced by `provisionerRef` below.
  provisionerRef  String                  // opaque Step CA provisioner identifier
}

model CertificateRevocation {
  id              String   @id @default(cuid())
  certSerial      String                  // FK EdgeNodeCertificate.serial (logical; not enforced because we keep CRL entries after the cert row is deleted)
  revokedAt       DateTime @default(now())
  revokedByPrincipalId String?           // null for automated revocations
  reason          String                  // RFC 5280 reason code
  crlSequence     BigInt                  // monotonic; CRL distribution uses this
  @@index([crlSequence])
}
```

`EdgeNode` gains nullable columns:
- `currentCertSerial String?` — FK to `EdgeNodeCertificate.serial`
- `bearerTokenIssuanceDisabled Boolean @default(false)` — flipped
  per-node when cert auth succeeds for the first time

### M3 — Enrollment endpoint discards CSR field

**Surface:** the spec's enrollment payload reserves a CSR field,
but the existing route at `apps/web/app/api/v1/edge/enroll/route.ts`
ignores it (Phase 0 / T2 are bearer-only).

**Action (T4 PR M4 — CSR signing at enrollment):**
- enroll route accepts `{ csr: string (PEM), ...existing fields }`
- validates CSR shape (Zod + node-forge or `pkijs` parse)
- enforces CSR constraints: SAN URI must be `spiffe://dpf/edge-node/<nodeId>`
  where `<nodeId>` matches the Authority-issued nodeId; CN is
  free-form but capped; key algorithm allowlist (P-256 default, RSA-3072 fallback)
- calls `signEdgeNodeCsr(prisma, stepCaClient, { edgeNodeId, csr })`
  in `apps/web/lib/pki/sign-csr.ts`
- response includes `{ cert: string (PEM), chain: string[] (PEM), certNotAfter }`
- `nodeToken` in the response is `null` when CSR signing
  succeeded; the slice flips `EdgeNode.bearerTokenIssuanceDisabled = true`
  the first time the new cert is presented on a heartbeat

### M4 — Edge Node has no keypair, no CSR generation, no cert storage

**Surface:** `services/edge-node/src/state.ts` stores
`{ nodeToken, edgeNodeId }`. No keypair, no cert chain.

**Action (T4 PR M5 — Edge Node CSR + cert lifecycle):**
- `services/edge-node/src/keypair.ts` — generate P-256 keypair
  using Node's `crypto.generateKeyPairSync('ec', ...)`; persist
  private key to state dir under `0600` with the same
  `verifyStatePerms` gate the per-node bearer uses.
- `services/edge-node/src/csr.ts` — build CSR via `node-forge`
  or `pkijs`; SAN URI = `spiffe://dpf/edge-node/<nodeId>`.
- `services/edge-node/src/enroll.ts` — generate keypair, build
  CSR, POST CSR alongside bootstrap token, store returned cert
  + chain in state file. Cert is not secret; private key is.
- `services/edge-node/src/state.ts` — extend state shape to
  `{ edgeNodeId, certPem, chainPem, certNotAfter, privateKeyPem }`.

### M5 — Edge Node HTTP client uses bearer auth, not mTLS

**Surface:** `services/edge-node/src/http.ts` (or equivalent;
the heartbeat / submission paths set `Authorization: Bearer
<nodeToken>`). The T2.2 work added a custom CA bundle via
`NODE_EXTRA_CA_CERTS` but did not introduce a client cert.

**Action (T4 PR M6 — Edge Node mTLS client):**
- HTTP client uses `https.Agent({ cert, key, ca })`
  constructed from state.
- Remove the `Authorization: Bearer` header on heartbeat /
  discovery-runs / rotate-cert calls when a cert is present.
- During transition, the client falls back to bearer auth if
  cert is missing (so an upgrade-in-place from Phase 0 / T2
  works without a re-enrollment); once a cert lands, bearer
  fallback is permanently disabled for that Edge Node.

### M6 — No cert rotation endpoint or loop

**Surface:** the spec mentions Phase 1+ rotation; nothing
exists yet.

**Action (T4 PR M7 — Cert rotation):**
- `POST /api/v1/edge/rotate-cert` — accepts a new CSR; current
  cert (presented via mTLS) must be valid and the calling
  Edge Node must own it; mints a replacement cert with a fresh
  serial; old cert enters a 24-hour grace window during which
  both serials are accepted; after grace, old cert is
  revoked silently (reason = "rotation-grace-expired").
- Edge Node side: `services/edge-node/src/rotate.ts` — kicks
  off when `certNotAfter` is less than 14 days away; new CSR
  + atomic state-file swap; failure backs off exponentially
  and surfaces a warning in the next heartbeat envelope.

### M7 — No revocation surface for operator or for the wire

**Surface:** Admin UI's existing "Revoke" button calls
`apps/web/lib/actions/edge-nodes.ts` which sets `trustState =
"revoked"` and zeros `tokenHash`. There is no cert revocation
because there is no cert.

**Action (T4 PR M8 — Revocation + CRL distribution):**
- Admin UI revoke action now also writes a
  `CertificateRevocation` row for the current cert serial and
  bumps the CRL sequence.
- `GET /api/v1/edge/crl` returns a signed CRL (Step CA generates
  it; Authority Core serves it from cache, refreshed every 60s
  from Step CA's CRL endpoint).
- Heartbeat response includes the current `crlSequence`; Edge
  Node refuses to operate (deny on submit / rotate) if its
  cached CRL sequence is more than 24h stale.
- mTLS middleware (M3 PR M3) consults `CertificateRevocation`
  on every request — cached in-memory with TTL ≤ 60s, refreshed
  from DB on miss. Operator revocation propagates within one
  heartbeat interval (default 60s) plus the cache TTL — total
  ≤ 120s, well inside the "one heartbeat interval" success
  criterion when defaults are used.

### M8 — Admin UI has no cert columns, no revoke-cert flow

**Surface:** `apps/web/components/platform/edge-nodes/*`
shows trustState, lastSeenAt, capabilities, hostname/IP.
No cert info.

**Action (T4 PR M9 — Portal Admin UI):**
- New columns: cert subject (truncated CN), expiry (relative —
  "in 87 days"), fingerprint (first 12 hex chars), CRL status.
- "Revoke certificate" action (distinct from "Revoke node" —
  cert revocation can be a single-cert action while leaving
  the node enrolled for a re-issuance, used during incident
  response).
- Bootstrap-token issuance modal updated: explains that
  Phase 1 enrollment generates a keypair on the Edge Node and
  the operator will see the cert subject + fingerprint
  populate after enrollment.

### M9 — Audit table has no cert lifecycle events

**Surface:** `apps/web/lib/edge-node/audit.ts` writes
`ToolExecution` rows for enroll / heartbeat / discovery-runs
state changes. There are no cert events.

**Action (T4 PR M10 — Audit integration):**
- Emit `ToolExecution` rows for: CA bootstrap, intermediate
  issuance, CSR sign success / failure, cert rotation, cert
  revocation, CRL sequence bump, mTLS handshake failures
  (sampled).
- `surface = "edge-node-pki"` distinguishes from existing
  `surface = "edge-node"` rows.

### M10 — Bearer-token issuance is unconditional

**Surface:** every successful enroll currently mints a bearer.

**Action (T4 PR M11 — Bearer deprecation flip):**
- After M3 / M4 / M5 land, the enroll route returns
  `nodeToken: null` when a valid CSR is submitted; bearer
  issuance only happens for Edge Nodes that omit the CSR
  field (backwards-compat for Phase 0 / T2 nodes during
  upgrade).
- A follow-on migration sweeps existing
  `bearerTokenIssuanceDisabled = false` rows: any node that
  has presented a cert at least once gets the flag flipped
  and its `tokenHash` zeroed.
- Spec amendment to retire the "Phase 0 risk accepted" row
  on the replay-protection line and the bearer-token
  language throughout § "Token namespaces and lifecycle."

## Slice plan (10 implementation PRs + 1 spec amendment + 1
security review doc)

| # | PR title | Closes | Depends on | Notes |
|---|---|---|---|---|
| **M1.0** | (this doc) — `plan(edge-node): Phase 1 mTLS hardening roadmap (T4)` | — | — | Committed first per the "after spec review = commit + plan" process |
| **M1** | `feat(db): Edge Node Phase 1 PKI schema (certs, CA, revocation)` | M2 | M1.0 | Prisma migration + invariant tests; no behavior change |
| **M2** | `feat(pki): Step CA sidecar + first-run CA bootstrap` | — | M1 | `docker-compose.pki.yml` overlay; Step CA service; `apps/web/lib/pki/step-ca-client.ts`; operator-runbook entry for root-key recovery passphrase |
| **M3** | `feat(auth): Edge Node mTLS middleware on /api/v1/edge/*` | M1 (gap) | M1, M2 | Adds mTLS validation alongside existing bearer middleware; no removal yet |
| **M4** | `feat(api): /api/v1/edge/enroll signs CSR + returns cert chain` | M3 (gap) | M1, M2, M3 | Enroll route accepts CSR; bearer still issued for legacy clients |
| **M5** | `feat(edge-node): keypair, CSR, cert state lifecycle` | M4 (gap) | M1, M2 | Edge Node service generates keypair + CSR; state file extended |
| **M6** | `feat(edge-node): mTLS HTTP client (bearer fallback during transition)` | M5 (gap) | M4, M5 | Switches outbound calls to client-cert; bearer fallback only if no cert |
| **M7** | `feat(api+edge-node): cert rotation endpoint + Edge Node rotation loop` | M6 (gap) | M4, M5, M6 | 90-day cert lifetime; 14-day renewal window; 24h grace |
| **M8** | `feat(api+admin): cert revocation + CRL distribution` | M7 (gap) | M1, M3, M4 | Operator revoke + CRL sequence on heartbeat; in-memory revocation cache |
| **M9** | `feat(admin): Edge Nodes UI — cert columns + revoke-cert action` | M8 (gap) | M1, M8 | Admin > Platform Development > Edge Nodes updates |
| **M10** | `feat(audit): cert lifecycle events on ToolExecution` | M9 (gap) | M2, M3, M4, M7, M8 | `surface = "edge-node-pki"` rows |
| **M11** | `feat(api): retire bearer-token issuance for cert-presenting nodes` | M10 (gap) | M3, M4, M5, M6 | Spec amendment landed in same PR retiring the Phase 0 risk-accepted row |
| **M12** | `docs(edge-node): external security review report — Phase 1 mTLS` | — (heavy gate) | M1–M11 verified locally | Files report at `docs/superpowers/specs/2026-05-XX-edge-node-phase1-mtls-security-review.md`; one PR per the prior security-review-pass pattern (#509, #515) |

**Critical path:** M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M11 → M12.

**Parallel-safe:** M9 (admin UI) can start after M8 in parallel
with M11. M10 (audit) can start after M4 lands, in parallel with
M5–M9. The security review (M12) is sequential — it gates the
spec-text flip from "Phase 0 risk accepted" to "Phase 1
implemented" and the maturity-gate update.

Total: **12 PRs** (10 implementation + 1 plan doc + 1 security
review doc), inside the 8–12 envelope.

## Verification gate

A clean-checkout developer follows the demo block at the top of
this doc on two distinct Linux hosts. The four observations in
"Verify on Host A" all pass:

- **mTLS handshake observed at the wire** (`tcpdump` /
  `wireshark` shows Certificate message in the ClientHello)
- **Admin UI cert fields populate** (subject, expiry,
  fingerprint match the cert on the Edge Node host)
- **Revocation propagates within one heartbeat interval**
  (operator revoke → next Edge Node call returns 401 within
  the configured heartbeat window)
- **Cert rotation succeeds without operator intervention**
  (system-clock fast-forward triggers renewal; new cert
  lands; old cert honored during grace then refused)

`bash install-dpf.sh doctor` from Host A includes a new "Edge
Node PKI" section showing CA status, signed-cert count, CRL
sequence, and recent revocations.

When that passes, **the Phase 0 spec's
"Replay protection on bearer credential — Phase 0 risk accepted"
row flips to "Phase 1 implemented (mTLS, #PR-M3 / #PR-M11)"** and
the parent roadmap's T4 entry flips to `verified on real LAN
with mTLS`.

## Security review (heavy — spec maturity-gate equivalent)

The Phase 0 maturity-gate language treats security review as
weighted heavier than other specs ("an architectural defect
here has wider blast radius than a deployment-target
misconfiguration"). The same posture applies to Phase 1, doubly
so because Phase 1 introduces:

- CA private-key custody on the Authority Core host
- A new server-side trust path (mTLS chain validation +
  revocation cache) that runs on every Edge Node request
- A new long-lived secret on each Edge Node (the private key)
- A new failure mode (CRL freshness staleness → deny)

The Phase 1 security review (M12) must produce a doc at
`docs/superpowers/specs/2026-05-XX-edge-node-phase1-mtls-security-review.md`
containing:

1. **Threat model.** Attacker capabilities at each trust
   boundary (Edge Node host owned, Authority Core host owned,
   LAN sniffer, malicious operator, supply-chain Step CA).
2. **Attack surface.** Every new endpoint, every new
   long-lived secret, every new validation path. Reference
   the [STRIDE-per-element](https://learn.microsoft.com/en-us/training/modules/tm-introduction-to-threat-modeling/)
   pattern; AGENTS.md §10 expects standards-grounded analysis.
3. **Residual risks.** What does mTLS *not* close that the
   spec previously listed as "Phase 1+ closes structurally"?
   Where does Phase 1.5 (platform-attested keys) become the
   next gate?
4. **Recommendations.** Spec amendments, code changes, ops
   runbook changes, monitoring additions. Each one tagged
   blocker / high / medium / low per the prior Edge Node
   security-review-pass convention (#509 / #515).

**External reviewer:** the task brief stipulates "fleet-agent /
IoT experience" — the same scoping that produced the Phase 0
review passes. The reviewer pool that signed off #509 / #515 is
the natural starting point, expanded with at least one
PKI-specialist reviewer.

## Cross-references

- Spec: [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../specs/2026-05-09-dpf-edge-node-design.md)
  — § "Phase 0 token-binding posture (downgrade documented)",
  § "Phase 1+ upgrade path (planned, not committed)",
  § "Implementation status".
- Parent roadmap: [`docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md`](2026-05-12-edge-node-phase0-roadmap.md)
- Sibling roadmaps:
  [`docs/superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md`](2026-05-12-edge-node-t2-multi-host-lan.md)
  (T2, landed); T3 macOS/Windows (planned); T5 air-gapped
  (planned).
- Deployment contracts: [`docs/superpowers/specs/2026-05-09-deployment-contracts.md`](../specs/2026-05-09-deployment-contracts.md)
  — Contract 5 (host trust + discovery) is the doctrine this
  plan extends.
- Principal convergence: AGENTS.md §11 — `EdgeNode` is a
  `PrincipalAlias.kind = "edge_node"`. Phase 1 introduces
  `EdgeNodeCertificate` as the per-Principal credential
  artefact; no change to the Principal convergence model.
- Prior security review precedent: PR #509 (six findings),
  PR #515 (alignment + storage). M12 mirrors that shape and
  cadence.
- Open-source standards relied on: [Step CA](https://github.com/smallstep/certificates),
  [RFC 5280](https://www.rfc-editor.org/rfc/rfc5280) (x509 + CRL profile),
  [SPIFFE ID format](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE-ID.md)
  for the SAN URI shape.
