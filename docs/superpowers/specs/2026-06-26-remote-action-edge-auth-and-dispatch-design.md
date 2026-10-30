---
status: binding
---

# RemoteAction Edge dispatch — authentication & channel design (EP-REMOTE-ACTION P2)

- **Date:** 2026-06-26
- **Status:** Accepted architecture; P2a/P2b implementation increments are governed by `BI-F12A8D0D` and `BI-A8399604`.
- **Extends (does NOT fork):** `docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md` §7 + `docs/superpowers/specs/2026-06-25-remote-action-edge-dispatch-threat-model.md` (R1–R11).
- **Epic:** `EP-REMOTE-ACTION` · founder-directed ("follow the commercial pattern" for authn/authz).

This pins **how the platform→Edge dispatch channel authenticates** and how a dispatch flows, so P2 can be built. The mutating half stays gated exactly as the threat model requires; this design opens only the **read-only pilot** channel first.

## 1. Decision: mTLS with per-device X.509 client certificates

This is the commercial-RMM standard, and what the founder asked us to match:

- Tanium, ManageEngine, and Microsoft Intune (via SCEP) authenticate the host agent with a **client certificate**; the agent generates a keypair at install, submits a CSR, and the platform CA signs it. ([Tanium clientAuth EKU](https://www.stigviewer.com/stig/tanium_7.x_application_on_tanos/2022-10-31/finding/V-254914), [ManageEngine client-cert auth](https://www.manageengine.com/products/desktop-central/client-certificate-authentication.html), [SCEP auto-enrollment](https://www.appviewx.com/blogs/what-are-certificate-auto-enrollment-protocols-and-why-are-they-important/))
- **Why mTLS over a bearer token:** mTLS binds identity to a private key that **never leaves the device** — there is no credential to steal or replay ([mTLS for agent auth](https://securew2.com/blog/mutual-tls-mtls-authentication)). That *is* threat-model **R1** ("machine-bound Edge trust… bearer-only nodes may collect but never mutate") and closes **T3** (token theft) and **T11** (spoofed dispatch — the channel is mutually authenticated).

**Decision:** the Edge dispatch channel uses **mutual TLS**; the Edge Node holds a per-device client certificate issued by a dedicated **Edge client-auth intermediate/profile rooted in the installation's existing organization Step CA**. The Edge issuer has its own restricted signing key and client-auth EKU policy; it does not reuse the portal server issuer key and does not introduce a second organization root. Governed consultation `DI-F822CC2C9F40` selected this shape with high confidence (composite 7.453, margin 2.844, no commandment conflict). DPoP and TPM/Secure-Enclave attestation remain future hardening layered on the same device key.

## 2. Channel shape: agent-dials-out, long-poll

The Edge is **outbound/pull-only** today (no inbound port; enroll/heartbeat/discovery/events/metrics all go *up*). So the action channel must also be agent-initiated:

**Decision:** the agent **long-polls** a dispatch endpoint over its mTLS connection (`GET …/actions/pending`), executes, and `POST`s results back. This matches the existing pull model and needs no inbound exposure or new transport. A persistent WebSocket/SSE channel is a *later* latency optimization, not required for the pilot.

## 3. Identity issuance — extend the enrollment ceremony

Today: bootstrap token → `POST /api/v1/edge/enroll` → bearer node token (`dpfedge_`). Add a certificate leg:

1. After the node is `trustState=trusted`, it **generates a keypair** (private key stored in the OS keystore / secure element, non-exportable where supported) and submits a **CSR** (`subject CN = nodeId`). The private key never crosses the host boundary.
2. The organization Step CA's restricted Edge client-auth intermediate/profile signs the CSR and returns a per-device client certificate (validity ≤ 90d, `clientAuth` EKU only).
3. New model **`EdgeNodeCertificate`**: `edgeNodeId`, `serial @unique`, `fingerprintSha256 @unique`, `subjectCn`, `notBefore`, `notAfter`, `status` (active|revoked|expired), `issuedAt`, `revokedAt?`, `csrPem`/`certPem`. (Cert metadata is a side table on `EdgeNode`, not a new identity — `EdgeNode` is already a `PrincipalAlias`, AGENTS.md §11.)
4. The Edge intermediate key remains in Step CA custody. The portal receives neither the organization root/intermediate private key nor the CA password. The portal stores certificate lifecycle metadata and invokes the already isolated CA contract; it does not become a CA implementation.

**The bearer token is retained for the read-only up-channel** (heartbeat/discovery/collect). The **mTLS client cert is *required* for the action dispatch channel** — a bearer-only node can never reach `…/actions/*` (R1, R3).

### 3.1 TLS termination boundary

The canonical deployment already assigns HTTPS termination to the Caddy sidecar. Client authentication is a TLS-handshake policy, not an HTTP-path policy, so Edge actions use a **dedicated mTLS site/listener** rather than making the normal browser portal require a client certificate.

- Caddy listens on the normal browser HTTPS endpoint without client authentication and on a separate Edge-action endpoint (default `:8443`) with `client_auth` mode `require_and_verify` and the organization Edge trust bundle.
- The action listener serves only `/api/v1/edge/actions/*`; all other paths return 404.
- Before proxying, Caddy removes every caller-provided `X-DPF-Edge-Cert-*` header and injects the verified fingerprint, serial, and subject from Caddy TLS placeholders.
- The application treats the injected values as transport evidence, not final authorization: every request still resolves an active `EdgeNodeCertificate`, confirms node trust and scope, and checks `action.execute` plus the per-node action-type allow-list.

Governed consultation `DI-4D4877ED738F` selected this boundary with high confidence (composite 7.235, margin 2.390, no commandment conflict). This follows Caddy's documented `client_auth` `require_and_verify` trust-pool contract and its TLS client-certificate placeholders.

## 4. Dispatch protocol (read-only pilot)

- **`POST /api/v1/edge/actions/claim`** — authenticated by both the enrolled client certificate and the existing short-lived/rotatable Edge credential carrying `edge:actions:claim`. It returns `RemoteAction`s where status=`queued`, approval is valid, customer/site scope matches the enrolled node, and `actionType` is in `EdgeNode.scopePolicy.allowedActionTypes`. The pilot permits only `inventory.collect`.
- Each returned dispatch is **signed by the platform authority** over a canonical envelope containing `{actionKey, actionType, parametersDigest, nodeId, nonce, createdAt, expiresAt}`. Signing only the action key/expiry is insufficient because an intermediary could otherwise substitute parameters. The Edge verifies the signature, node binding, digest, expiry, and nonce before execution and persists the consumed action/nonce before side effects.
- The agent executes the read-only action and **`POST /api/v1/edge/actions/result`** with `edge:actions:report`, idempotent on `actionKey`, result, and evidence under a fixed schema (R7).
- The server validates cert-valid-and-not-revoked ∧ scope-match ∧ signature ∧ idempotency, then transitions `status` (`dispatched`→`running`→`succeeded|failed|timed-out`).
- **Independent corroboration (R7):** a node's self-reported success is cross-checked against the next discovery sweep (a node claiming a result whose inventory disagrees is flagged).

## 5. Scopes & capability (R2, R3)

- Retain the existing `edge:actions:claim` + `edge:actions:report` bearer scopes as a second factor; they never authorize an action request without mTLS.
- **`action.execute`** on `EdgeNodeCapability` remains `disabled` by default. `EdgeNode.scopePolicy.allowedActionTypes` is the canonical per-node action allow-list. Capability mode and action-type scope must both allow a claim.

## 6. Certificate lifecycle (the operational reality)

- **Validity** ≤ 90d; **rotation** by re-CSR before expiry (piggybacked on heartbeat) — keys re-generated on the device.
- **Revocation** is a **server-side status check on every mTLS request** (`EdgeNodeCertificate.status`) — no long-lived CRL needed; revocation is instant. **Quarantine a node** = revoke its cert + set `capability.action.execute=disabled`.

### 6.1 Expired authority-host client recovery — BI-AFDB58C8

This is a bounded repair of the existing PKI owner, not a new enrollment or
permission mechanism. Design work is recorded in WC-73B082A8. Implementation,
publication and the physical repair have not yet run.

On the October 29 source `4718cd4f1c5418ab2eba819dd47d5cb839f8eca0`,
`bootstrap-organization-pki.sh` and its PowerShell counterpart renew an existing
Edge client certificate solely because its certificate and key files exist.
The observed authority-host client expired on October 18. The installed native
agent still heartbeats through its separate enrolled bearer channel, but action
certificate registration fails at the TLS boundary. The public root remains
valid. Neither revocation nor enrollment conflict explains this observation.
The actual bootstrap repair against the expired certificate remains unrun.

**OBJ-ECR1:** Restore an expired authority-host Edge client through the existing
restricted organization issuer while preserving device and CA authority.
**OBJ-ECR2:** Leave failed repairs recoverable and existing explicit opt-outs
unchanged, with no private material returned to an agent.

The medium delivery plan quotes the recorded BI-AFDB58C8 acceptance criteria:

- Deterministic fixture first reproduces the existing expired-certificate branch; fixed tests prove the existing restricted issuance route is used only when validity requires it, and renewed/reissued public metadata is verified before replacing usable prior state.
- Valid existing credentials renew normally. Failed issuance, wrong identity/EKU/issuer, changed root or partial output leave prior state and explicit opt-outs intact; no expired certificate becomes authorization.
- The published supported repair can restore actual certificate validity and machine registration on the enrolled host without a human command, private-key handling or TLS bypass by the agent.
- Actual registration/identity observations and scoped rollback evidence are recorded; engine activation remains its own gated operation and is not implied by certificate repair.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-ECR1 | OBJ-ECR1 | Certificate validity selects renewal for a valid existing client and restricted reissuance for an expired authority-host client; missing or invalid identity is refused before replacing a usable credential. |
| AC-ECR2 | OBJ-ECR1, OBJ-ECR2 | Before publication, verify the resulting certificate against the existing root and expected subject, client-auth usage and validity; preserve private-key custody and the enrolled node identity. |
| AC-ECR3 | OBJ-ECR2 | Failed issuance or verification retains the previous client files and reports failure; an explicit disabled dispatch value, node quarantine, revocation and action allow-list remain unchanged. |
| AC-ECR4 | OBJ-ECR1, OBJ-ECR2 | Bash and PowerShell contract tests cover valid renewal, expired recovery, partial failure and identity rejection; the published supported repair proves actual host registration without disabling TLS verification. |

**CONTRACT-ECR-OWNER:** Extend only the authority-mode client portion of the
existing organization PKI bootstrap. Keep the CA key and password with its
existing isolated owner. Do not delete a certificate to force the first-issue
branch, accept an expired certificate as authentication, enable CA renewal after
expiry, add a general command endpoint or use a self-join package as recovery.
Member-host recovery, continuous rotation and changing the channel rollout
policy are outside this narrow correction; section 6 still owns their lifecycle
requirement. No database or enrollment migration is needed.

**FLOW-ECR-REPAIR:** inspect public identity and validity → select the existing
issuer path → write a private temporary client pair → verify the public result
and expected identity → publish through the existing custody owner → let the
existing native agent register the new certificate → verify current registration.
On error, retain the previous pair and the explicit failure. The source fix
must not itself execute this flow on the live installation.

**VERIFY-ECR:** Use deterministic subprocess fixtures before implementation to
reproduce the existing expired-client path, then exercise the real bootstrap
branch without a live CA, real credentials, host mutation or model workload.
Keep source test results separate from actual certificate/registration evidence.
The native inference activation and rollback remain separate operations under
BI-CD4EB130; repairing PKI does not authorize or prove them.

Ordered fix sequence:

1. Commit this repair contract and capture the named-source reproduction and
   rejected causes in the live research receipt.
2. Bind this ordered design to BI-AFDB58C8 with normal plan coverage, then obtain
   current implementation admission for the exact edit scope.
3. Add the failing subprocess fixture; implement the smallest shared-policy
   repair in the existing Bash and PowerShell bootstraps, preserving their
   platform-specific execution adapters and existing caller contracts.
4. Run affected fixture tests and the repository's applicable source gates;
   publish through the DCO PR and protected merge queue. Document how existing
   authority installs consume the verified repair assets.
5. Invoke only the published supported recovery with actual current authority;
   verify certificate identity, validity, root continuity and native registration.
   Stop at any credential, trust or rollout authority refusal.

This single deliverable is atomic: selecting a recovery branch without verified
private publication, failure preservation and both supported host adapters is
not a usable repair. Related completed BI-5727522F fixed the portal/LDAPS leaf
duration, BI-D4F79CE2 fixed stale enrollment supersession, and BI-FFFEA4ED fixed
required-container upgrade recovery; none supplies this client recovery path.

Smallstep's [renewal authorization contract](https://pkg.go.dev/github.com/smallstep/certificates/authority/provisioner#DefaultAuthorizeRenew)
rejects expired renewal when the CA has not allowed it. That describes the
upstream boundary; this installation's live CA renewal-after-expiry policy has
not been inspected. The repair uses the existing restricted issuance owner
instead of weakening that boundary.

## 7. Threat-model coverage

| Requirement | Satisfied by |
| --- | --- |
| R1 machine-bound trust | §1 mTLS client cert (non-exportable key) |
| R2 split scopes | §5 `edge:actions:claim` / `edge:actions:report` plus mTLS |
| R3 per-node allow-list, default-off | §5 `capability.action.execute` + allow-list |
| R4 signed single-use expiring dispatch | §4 signed full action/digest/node/nonce/time envelope + consumed-key tracking |
| R5 scope enforcement | §4 customer/site match at dispatch **and** node |
| R7 result schema + independent re-collection | §4 result schema + sweep corroboration |
| R11 spoofed dispatch | §1 mutual auth + §4 platform signature |
| R6/R8/R9/R10/R12 | **P2b/mutating only** — parameterized actions, federation egress, rollback/health, trust-posture monitoring, least-privilege exec |

## 8. Build slices

- **P2a — `BI-F12A8D0D`, machine-bound identity + read-only channel:** organization-rooted Edge intermediate/profile + `EdgeNodeCertificate` metadata; dedicated Caddy mTLS listener; existing split bearer scopes as a second factor; signed/idempotent claim/result; native Go Edge poll loop running `inventory.collect` only; sweep corroboration. **No mutating action is enabled in this slice.**
- **P2b organization join — `BI-A8399604`:** after P2a is functionally proven, enable only `organization.join.issue` and `organization.join.import`. The founder explicitly authorized these two types for the no-shell Connections outcome. Both require fixed parameter schemas, per-node allow-listing, a locally approved `ChangeRequest`, encrypted/cleared package material, host-role checks, a declared recovery path, and independent post-action TLS/portal/Edge health evidence. This authorization does not extend to another action type.
- **P2b general remediation:** `patch.apply`, `service.restart`, `reboot`, or any other mutating type remains gated on separate founder sign-off and the full R6/R8/R9/R10/R12 controls. `script.run` is not an acceptable implementation shortcut.
- **P3 — backends:** native package managers (patch) etc., per `actionType`.

## 9. Verified substrate

- `docker-compose.tls.yml` and `scripts/issue-authority-tls-cert.sh` establish Caddy as the TLS boundary; the generated configuration must gain the separate mTLS action listener.
- Organization Step CA bootstrap and custody are already shipped. Edge issuance extends that owner with a restricted intermediate/profile; the portal does not store CA keys.
- The installed host runtime is the native Go service in `services/edge-node-go`; the older TypeScript collector is not the host-action executor.
- `RemoteAction`, `EdgeNode`, `EdgeNodeCapability`, `ChangeRequest`, split Edge bearer scopes, claim/result routes, and credential encryption already exist. Extend them rather than create a second queue, identity, approval, or secret store.
- `EdgeNodeCertificate` metadata is absent and justified as a side table; the private key remains host-local.

## 10. Decisions — resolved

- Auth mechanism: mTLS per-device client certificate, with the existing bearer credential retained only as a second factor.
- Trust topology: dedicated Edge client-auth intermediate/profile under the organization root (`DI-F822CC2C9F40`).
- Termination: dedicated Caddy mTLS listener plus application re-authorization (`DI-4D4877ED738F`).
- Channel: agent-initiated pull; no inbound Edge port.
- Pilot: `inventory.collect` only.
- First privileged types: `organization.join.issue` and `organization.join.import`, explicitly founder-authorized for the no-shell organization-join workflow after P2a proof.

## 11. Standards adopted

- [NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final) and [SP 800-207A](https://csrc.nist.gov/pubs/sp/800/207/a/final): network location is not trust; authorize the device/service identity and policy on each request.
- [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421): bind signatures to all security-relevant message components and use nonce/creation/expiry fields for replay control.
- [Caddy `tls` client authentication](https://caddyserver.com/docs/caddyfile/directives/tls) and [TLS placeholders](https://caddyserver.com/docs/caddyfile/concepts): require and verify client certificates at the TLS boundary, then forward only derived certificate identity.
- [OWASP Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html): operator approval is specific to the exact action and parameters and is enforced server-side.
