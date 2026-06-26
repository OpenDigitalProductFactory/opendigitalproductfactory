# RemoteAction Edge dispatch — authentication & channel design (EP-REMOTE-ACTION P2)

- **Date:** 2026-06-26
- **Status:** Design for review — resolves the auth-mechanism decision left open by the convergent design (§10-Q1) and the threat model (R1).
- **Extends (does NOT fork):** `docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md` §7 + `docs/superpowers/specs/2026-06-25-remote-action-edge-dispatch-threat-model.md` (R1–R11).
- **Epic:** `EP-REMOTE-ACTION` · founder-directed ("follow the commercial pattern" for authn/authz).

This pins **how the platform→Edge dispatch channel authenticates** and how a dispatch flows, so P2 can be built. The mutating half stays gated exactly as the threat model requires; this design opens only the **read-only pilot** channel first.

## 1. Decision: mTLS with per-device X.509 client certificates

This is the commercial-RMM standard, and what the founder asked us to match:

- Tanium, ManageEngine, and Microsoft Intune (via SCEP) authenticate the host agent with a **client certificate**; the agent generates a keypair at install, submits a CSR, and the platform CA signs it. ([Tanium clientAuth EKU](https://www.stigviewer.com/stig/tanium_7.x_application_on_tanos/2022-10-31/finding/V-254914), [ManageEngine client-cert auth](https://www.manageengine.com/products/desktop-central/client-certificate-authentication.html), [SCEP auto-enrollment](https://www.appviewx.com/blogs/what-are-certificate-auto-enrollment-protocols-and-why-are-they-important/))
- **Why mTLS over a bearer token:** mTLS binds identity to a private key that **never leaves the device** — there is no credential to steal or replay ([mTLS for agent auth](https://securew2.com/blog/mutual-tls-mtls-authentication)). That *is* threat-model **R1** ("machine-bound Edge trust… bearer-only nodes may collect but never mutate") and closes **T3** (token theft) and **T11** (spoofed dispatch — the channel is mutually authenticated).

**Decision:** the Edge dispatch channel uses **mutual TLS**; the Edge Node holds a per-device client certificate issued by a platform **Edge-CA**. DPoP and TPM/Secure-Enclave **attestation** are noted as future hardening *layered on the same cert* (attested key → non-exportable proof), not a different mechanism.

## 2. Channel shape: agent-dials-out, long-poll

The Edge is **outbound/pull-only** today (no inbound port; enroll/heartbeat/discovery/events/metrics all go *up*). So the action channel must also be agent-initiated:

**Decision:** the agent **long-polls** a dispatch endpoint over its mTLS connection (`GET …/actions/pending`), executes, and `POST`s results back. This matches the existing pull model and needs no inbound exposure or new transport. A persistent WebSocket/SSE channel is a *later* latency optimization, not required for the pilot.

## 3. Identity issuance — extend the enrollment ceremony

Today: bootstrap token → `POST /api/v1/edge/enroll` → bearer node token (`dpfedge_`). Add a certificate leg:

1. After the node is `trustState=trusted`, it **generates a keypair** (private key stored in the OS keystore / secure element, non-exportable where supported) and submits a **CSR** (`subject CN = nodeId`).
2. The platform **Edge-CA signs** the CSR → a per-device client cert (validity ≤ 90d).
3. New model **`EdgeNodeCertificate`**: `edgeNodeId`, `serial @unique`, `fingerprintSha256 @unique`, `subjectCn`, `notBefore`, `notAfter`, `status` (active|revoked|expired), `issuedAt`, `revokedAt?`, `csrPem`/`certPem`. (Cert metadata is a side table on `EdgeNode`, not a new identity — `EdgeNode` is already a `PrincipalAlias`, AGENTS.md §11.)
4. **Edge-CA**: a platform CA keypair (self-managed intermediate, kept as a managed secret; reuse the `packages/integration-shared/credential-crypto.ts` storage pattern). Signing is server-side only.

**The bearer token is retained for the read-only up-channel** (heartbeat/discovery/collect). The **mTLS client cert is *required* for the action dispatch channel** — a bearer-only node can never reach `…/actions/*` (R1, R3).

## 4. Dispatch protocol (read-only pilot)

- **`GET /api/v1/edge/actions/pending`** — authenticated by the **client cert** (mTLS), scope **`action:dispatch`**. Returns `RemoteAction`s where: status=`queued` ∧ the action's `customerAccountId`/`customerSiteId` **matches the node's enrolled scope** (R5) ∧ `actionType` is in the node's **capability allow-list** (R3). In the pilot, only `inventory.collect` / `diagnostics.collect` are allow-listed (read-only; R-pilot).
- Each returned dispatch is **signed by the platform authority** over `{actionKey, nonce, expiresAt}` (R4 anti-replay, R11 anti-spoof — the agent verifies the platform signature; the server records consumed `actionKey`s).
- The agent executes the read-only action and **`POST /api/v1/edge/actions/{actionKey}/result`** — scope **`action:report`**, **idempotent on `actionKey`**, result + evidence per a fixed schema (R7).
- The server validates cert-valid-and-not-revoked ∧ scope-match ∧ signature ∧ idempotency, then transitions `status` (`dispatched`→`running`→`succeeded|failed|timed-out`).
- **Independent corroboration (R7):** a node's self-reported success is cross-checked against the next discovery sweep (a node claiming a result whose inventory disagrees is flagged).

## 5. Scopes & capability (R2, R3)

- Add **`action:dispatch`** + **`action:report`** to the closed Edge token-scope vocabulary (`edge-node-types.ts`).
- **`capability.action.execute`** on `EdgeNodeCapability`, mode `disabled` by default, with a per-`actionType` **allow-list**. The pilot enables only the read-only types.

## 6. Certificate lifecycle (the operational reality)

- **Validity** ≤ 90d; **rotation** by re-CSR before expiry (piggybacked on heartbeat) — keys re-generated on the device.
- **Revocation** is a **server-side status check on every mTLS request** (`EdgeNodeCertificate.status`) — no long-lived CRL needed; revocation is instant. **Quarantine a node** = revoke its cert + set `capability.action.execute=disabled`.

## 7. Threat-model coverage

| Requirement | Satisfied by |
| --- | --- |
| R1 machine-bound trust | §1 mTLS client cert (non-exportable key) |
| R2 split scopes | §5 `action:dispatch` / `action:report` |
| R3 per-node allow-list, default-off | §5 `capability.action.execute` + allow-list |
| R4 signed single-use expiring dispatch | §4 signed `{actionKey,nonce,expiresAt}` + consumed-key tracking |
| R5 scope enforcement | §4 customer/site match at dispatch **and** node |
| R7 result schema + independent re-collection | §4 result schema + sweep corroboration |
| R11 spoofed dispatch | §1 mutual auth + §4 platform signature |
| R6/R8/R9/R10/R12 | **P2b/mutating only** — parameterized actions, federation egress, rollback/health, trust-posture monitoring, least-privilege exec |

## 8. Build slices

- **P2a — machine-bound identity + read-only channel (buildable now; mutates nothing):** Edge-CA + `EdgeNodeCertificate` model + CSR-at-enrollment; `action:dispatch`/`action:report` scopes + `capability.action.execute` (read-only allow-list); the mTLS-authed `GET pending` / `POST result` routes (scope-filtered, signed, idempotent); the `services/edge-node` agent's mTLS client + poll loop running `inventory.collect` only; sweep corroboration. **This is the threat model's recommended read-only pilot.**
- **P2b — mutating (GATED on P2a proven + founder per-`actionType` sign-off):** enable `patch.apply` / `service.restart` / `reboot` behind the full R6/R8/R9/R10/R12 gates (parameterized handlers, `ChangeRequest`, window/blackout, no-downgrade via `@dpf/db/patch` `compareVersions`, recovery/health/rollback, federation sovereignty egress).
- **P3 — backends:** native package managers (patch) etc., per `actionType`.

## 9. Substrate to verify before P2a code
- The **mTLS termination point**: does the portal sit behind a proxy (Caddy/nginx/Traefik in compose) that can verify client certs and pass the subject to the app, or must verification be app-layer? (Drives whether `…/actions/*` reads a verified-client-cert header or does the TLS itself.)
- CA-key storage: confirm the `credential-crypto` / managed-secret path for the Edge-CA private key.
- The `services/edge-node` runtime (Go native vs TS container per the 2026-05-16 runtime decision) for the mTLS client + keystore integration.

## 10. Decisions — resolved & remaining
- **Resolved:** auth mechanism = **mTLS per-device client cert** (commercial standard); channel = agent long-poll; read-only pilot first.
- **For the founder:** (a) Edge-CA as a self-managed intermediate vs. rooted under an existing internal CA; (b) mTLS termination at the proxy vs. app layer (§9); (c) confirm `inventory.collect`-only for the pilot before any mutating `actionType` is enabled.
