---
status: draft
---

# DPF preview Workroom proposal and receipt readback

**Backlog item:** BI-348CC53B · **Epic:** EP-INPLATFORM-CODING
**Parent:** [DPF-to-DPF2 convergence, §5.3](2026-11-22-dpf-to-dpf2-convergence-export-and-cutover-readiness.md) and [S5 Workroom-bound toolsets](2026-11-25-workroom-bound-toolset-design.md).
**Scope brief SHA-256:** `102ae846114b4036b0e012fbce9cdbb622b2f2465d18f80e9014941b7eedf4f7`.

DPF2 can recover a fixture receipt after restart. This design lets an admitted, isolated Contributor preview record exactly one synthetic Workroom proposal in DPF and lets DPF2 read back the original receipt. It is a design for independent review, not implementation admission, test evidence, or runtime authorization.

## Objectives

**OBJ-S5-PROPOSAL:** Record one quiet synthetic Workroom proposal through the existing DPF broker and authoritative receipt store.

**OBJ-S5-READBACK:** Recover the original receipt after restart through an independent, body-free read of the exact operation and attempt.

**OBJ-S5-BOUNDARY:** Preserve current authority, isolation, and compatibility. A refusal or unknown result never widens the scope or starts another effect.

## Acceptance

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-S5-PROPOSAL, OBJ-S5-BOUNDARY | On pinned DPF and DPF2 candidate revisions, an admitted Contributor preview records one proposal and one durable receipt for the original synthetic Workroom attempt. The signed POST binds the exact body bytes to the peer, proposal endpoint, preview and operation. The separately carried bearer is bound to that proposal resource. The broker checks the exact subject, lease, stage and attempt. |
| AC-2 | OBJ-S5-READBACK, OBJ-S5-BOUNDARY | After a cold reopen, the body-free lookup returns the same operation and receipt to an independently authorized reader. The distinct signed GET binds the original locator and requires independent result access, even when the proposal bearer is absent or spent. It refuses a body or any bearer. Only DPF's authenticated exact reply can reconcile the original claim. |
| AC-3 | OBJ-S5-PROPOSAL, OBJ-S5-READBACK | Exact replay records no second effect. A lost or mismatched reply stays unknown until the independently authorized GET confirms the exact original receipt. FB-2c records separate durable evidence under the original claim without rewriting uncertainty or resending. |
| AC-4 | OBJ-S5-BOUNDARY | A purpose or path swap, altered bytes or locator, foreign lease/source/receiver, too-old proof, missing read permission, or foreign, expired or revoked authority produces zero writes. Use the exact reviewed S6 profile and current owner authority. |
| AC-5 | OBJ-S5-BOUNDARY | The joined attempt preserves the 120-second Workroom bound and produces no provider request, proposal delivery, message, notification, or wake. Existing enrollment and lease prerequisites still apply to the installed preview. |

## Pinned findings

- DPF commit [4e7b9d86](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/commit/4e7b9d8613e13810dcbadfdc77789801cf4a73a7), tree `798b02d91cb8d4199ea2e1c8faae5904d11c3091`. [Protected transport](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/4e7b9d8613e13810dcbadfdc77789801cf4a73a7/apps/web/lib/workroom-runtime/protected-execution-transport.server.ts#L43) selects an outbound channel through an injected connector. It does not verify incoming HTTP requests. [The owner reader](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/4e7b9d8613e13810dcbadfdc77789801cf4a73a7/apps/web/lib/workroom-runtime/s5-rehearsal-owner.server.ts#L192) verifies the admission-read purpose and path only. [The merged S5 handlers](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/4e7b9d8613e13810dcbadfdc77789801cf4a73a7/apps/web/lib/workroom-runtime/s5-rehearsal-coordination-wire.server.ts#L8) take separate proof callbacks and remain unregistered.
- DPF2 FB-2c commit `2c329ec80b484969373b9e3bb3f80c65ab5d3b9d`, tree `1f0196c6d1bebb8427377cd2e263d29afce632e6`. At that revision, `apps/control/src/fb2c-control.ts:24–41` takes caller transports and a broker, `apps/control/src/room-token-custody.ts:35–37` keeps the room bearer in proposal custody, and `evaluations/fb2c-served-proof.test.mjs:198–266` uses a file-backed mock receipt. The fixture shows restart and no resend on its own side. DPF's existing instance-signing primitives are in [instance-identity.ts](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/4e7b9d8613e13810dcbadfdc77789801cf4a73a7/apps/web/lib/federation/instance-identity.ts#L91). It does not prove the independent DPF GET, an authenticated reply, or a real DPF effect count.
- Keep the current private Ed25519 proof shape with a different purpose per action. [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032.html) specifies Ed25519. [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html) covers binding method, target, and expiry in HTTP signatures, and [RFC 9530](https://www.rfc-editor.org/rfc/rfc9530.html) distinguishes content bytes from a parsed representation. Adopt those binding properties and the existing DPF canonical JSON codec, without claiming RFC 9421 wire compatibility or adding its header profile. A full generic HTTP signature profile would add a second parser and enrollment change for two fixed routes. Reusing the admission proof or signing parsed JSON would hide the trust-boundary or byte-level differences this slice must enforce. Treat GET as body-free, consistent with [RFC 9110 §9.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#name-get).

## Design amendment

S6 owns the versioned inbound proof profile, enrolled peer and receiver binding, and shared request and response vectors. S5 owns the preview route registration, durable proposal, and separate receipt lookup. FB-2c owns the matching served HTTP caller and existing room-token custody. The outbound selector, admission reader, and fixture do not fill in any of these roles. No new store, issuer, token kind, grant, or v1 fallback.

### Resource and authority separation

The current owner pin carries one token ID. The admission reader at the pinned DPF revision verifies the token against the pin's `snapshot.resource`. The approval producer requires that resource to be `origin + /api/internal/s5-rehearsal-admission`. The broker requires the pinned token ID, and `readS5CredentialCeiling` requires exact resource equality. The existing token therefore cannot also authorize a POST to a different resource.

Keep `snapshot.resource` and `dpf.s5.rehearsal.admission.read.v1` bound to the admission GET. On the amended, explicitly versioned enrollment, the owner records a distinct, exact proposal credential resource and binds the attempt's **single** existing-kind `S5_WORKROOM_TOKEN_KIND` bearer to that proposal resource at issue time. The owner reader continues to validate the exact token ID, lease, subject, stage, deadline, policy, and revocation. For the amended enrollment it validates the token against the registered proposal credential resource while separately retaining the admission path, proof, approval and permit checks. Do not reinterpret a legacy pin, accept an alternate resource, rebind an issued token, or relax `readS5CredentialCeiling`. An admission proof or approval does not authorize either coordination route.

The same enrolled Ed25519 public key can prove peer identity for both actions only when the corresponding registration explicitly binds the key, peer, endpoint, preview and attempt to that action. The key is not a grant. POST still requires the proposal bearer and current canonical write, actor and owner-fence checks. GET must establish independent current result access through its own registration and owner checks, with no bearer lookup or write authorization substituted for read permission. No write deadline extension or change to issuance caps.

### Private wire profile

Both paths use `@exposure private-mesh` and `Cache-Control: no-store`. Require `previewIdentity(env)` to match development, the exact Contributor-preview lease and source, and disposable `dev-postgres:5432/dpf`. Only the registered loopback origin on port 3001 may serve the paths. Refuse a different origin, unregistered peer, or missing or invalid current owner data before reaching the broker.

| Action | Method and path | Exact Ed25519 purpose |
| --- | --- | --- |
| Submit one synthetic proposal | POST `/api/internal/s5-rehearsal-coordination/proposal` | `dpf.s5.rehearsal.proposal.submit.v1` |
| Read the original receipt | GET `/api/internal/s5-rehearsal-coordination/receipt` | `dpf.s5.rehearsal.receipt.observe.v1` |

- The signed message is the UTF-8 encoding of DPF canonical JSON. It contains `purpose`, `method`, `receiver` (`issuer`, `audience`, `hostRef`, `resource`), `peerRef`, `leaseId`, `sourceSha`, `locator` and integer Unix `expiresAt` in milliseconds. Receiver resource is the exact registered `origin + pathname`, not a request-selected destination. Use `x-dpf-s5-proof` for standard padded Base64 of the 64-byte signature and `x-dpf-s5-proof-until` for decimal `expiresAt`. Require a positive remaining lifetime no greater than 15,000 ms at verification. That is independent of the 120-second attempt bound checked at effect commit.
- Both routes take the exact original operation and attempt as a unique, bounded query parameter set validated by `s5ProposalObservationSchema`. This permits POST to verify the signed locator before parsing the body. For POST only, `bodySha256` is the lowercase hex SHA-256 of the exact bounded request body bytes. Read the stream once, verify the signature over that digest and locator, parse those same bytes as strict UTF-8 JSON using `s5BrokerCallSchema`, then require its locator to equal the signed query. The proposal bearer is a separate `Authorization: Bearer` value, never JSON or query data. Use `proposeRehearsal` and the existing broker with the owner predicates in force. Hold if its server-owned operation binding key is absent or shorter than 32 bytes.
- GET has no `bodySha256` field. Require `request.body === null`, no transfer encoding, absent or zero content length, and no authorization or other room bearer header. Pass only the verified locator and receiver to `observe`. A settled response returns the full immutable `S5BrokerReceipt` to the authenticated caller, which must check its exact operation and attempt binding. Hold or unknown responses are opaque and non-cacheable. Unknown permits only authorized readback, not a resend. Exact replay under current authority returns the same immutable result and adds no effect.
- Shared `s5-rehearsal-coordination-profile.v1` vectors must carry the raw POST bytes, canonical statement bytes, signature, verify time, and expected outcome for each purpose. Include purpose/path swaps, changed raw bytes or locator, bad proof expiry, foreign lease/source/receiver, missing independent read permission, expired or revoked authority, body or bearer on GET, authenticated reply mismatch, and reply loss. No real bearer, secret, or using fixed test credentials in a served run.

### Authenticated replies

Control must not trust loopback, private-mesh classification, an outbound HTTPS rule, or receipt JSON by itself. DPF signs a reply using the same registered preview installation Ed25519 identity across this lease and its cold restart, through `instance-identity`. Control pins that identity from its current trusted registration. It must not accept a signer supplied by HTTP. If the preview cannot use a registered installation identity in its existing isolation boundary, hold without importing a live key or creating an issuer.

Use `dpf.s5.rehearsal.proposal.reply.v1` for POST and `dpf.s5.rehearsal.receipt.reply.v1` for GET. The reply statement is UTF-8 DPF canonical JSON with exact fields `purpose`, `installationRef`, `requestSha256`, `method`, `resource`, `peerRef`, `leaseId`, `sourceSha`, `locator`, integer HTTP `status`, and `bodySha256`. `requestSha256` is lowercase hex SHA-256 of the verified request's canonical UTF-8 statement bytes. The response `bodySha256` hashes the exact bytes sent. `x-dpf-s5-reply-proof` carries the canonical padded standard Base64 64-byte signature. Sign only replies to authenticated requests. An unsigned rejection is not a confirmed outcome.

Verify the signature and both digests against the original request and pinned installation key before decoding the same response bytes as JSON. Require an exact matching `S5BrokerReceipt` on a settled reply. Wrong status, peer, installation, request, locator, or bytes cannot reconcile an operation. Absent or invalid replies leave a possibly sent proposal unknown and do not trigger a resend.

The shared `s5-rehearsal-coordination-profile.v1` profile caps the UTF-8 absolute request URL at 4,096 bytes, POST body at 24,576 bytes, and reply body at 8,192 bytes. Stream bounds apply regardless of declared length. Decode JSON with strict UTF-8, no BOM or content coding. Hash lowercase hex and reject noncanonical signature encodings. Keep exact request and response bytes, canonical statements, signatures, verification times, and expected verdicts in nonsecret positive and negative vectors. Add wrong-peer, cross-request, wrong-status, and reply substitution cases to the existing request matrix.

#### Preview signer custody

At DPF `4e7b9d86`, [the Contributor preview override](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/4e7b9d8613e13810dcbadfdc77789801cf4a73a7/scripts/lib/dev-preview-runtime.mjs#L43) pins lease, source, and loopback. [The dev portal](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/4e7b9d8613e13810dcbadfdc77789801cf4a73a7/docker-compose.yml#L817) uses the disposable dev database and does not mount production's `/dpf-federation`. These pins do not establish a reply signer. [The default federation resolver](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/4e7b9d8613e13810dcbadfdc77789801cf4a73a7/apps/web/lib/federation/demand-identity.ts#L104) can write durable state, upsert or repair the database, or mint a key on fallback. Neither HTTP handler may invoke that resolver or another lazy, minting, or repairing path.

S6's enrolled Contributor-preview owner must provision the response signer in the governed preview initialization step, after the active lease and isolated database are verified and before serving the S5 routes. Use the existing installation identity representation in the preview database, not production's mount, identity row, or keys. Explicitly provision the preview installation's own key once if this lease has no identity. Do not copy a live identity, adopt an unproven row, or replace a different pinned identity in place. Persist the preview-only key in lease-owned dev database custody which survives process restart. This is provisioning of the preview installation's identity with the existing signer, not a new issuer, grant, or key store for S5.

Before either route can serve, the existing preview-owner enrollment and the exact DPF2 receiver must agree on the registered preview installation/device ID and public key for the same lease, source, peer, receiver and both reply purposes. Pin the public binding through the existing trusted enrollment channel, never by trusting a self-reported HTTP key. The private key never goes to Control. If this provisioning or registration is not proven, keep both routes held. The reviewed source did not prove an already-enrolled signer at this pin.

At request time, read and verify the pre-enrolled key from the disposable preview database without writing any state. Use the pure `signIdentityStatement` primitive only after the key matches the current pinned installation, public key, preview and peer. Fail closed on missing, unreadable, revoked or mismatched custody or binding. For the intended cold restart, keep the same active lease and dev database, and verify the GET's reply against the same enrolled public key without provisioning again. Explicitly prove missing and mismatched signer refusal with no key generation, repair, registration write, or new proposal. A new lease or replacement database requires separate pre-serve enrollment and does not count as a same-identity restart.

### Cold restart and durable reconciliation

At the pinned FB-2c revision, reconciling a proposal is not a normal retry. `packages/core/src/room-operation-claim.ts:75–95` sweeps an interrupted in-flight claim to `unknown` and refuses normal settlement after that transition. The FB-2c caller reconstructs the exact locator from the persisted original claim and operation ID plus its `S5LaunchRecord`. It does not open the proposal body, regain custody of the bearer, or issue another claim.

FB-2c's existing Store owner performs `N1-OI-4`. A verified, response-authenticated DPF GET appends a separate durable reconciliation evidence record under that exact original claim. It carries the corroborated outcome and private receipt binding. It preserves the earlier uncertainty, interrupted status, floor crossings, and close history. Derived knowledge changes only on an authenticated exact receipt match. Reapplying the same evidence is idempotent, sends nothing, and never exposes raw receipts outside custody. A missing, mismatched, or unverified receipt leaves the original operation unknown.

Prove positive GET after cold restart with the proposal bearer absent or spent and independent result permission still current. Prove denial when that permission is absent even if the prior write was authorized. Separate result access does not extend the proposal deadline or repair an expired or revoked read authorization.

### Joined acceptance

Run `VERIFY-JOIN` for `s5-route-handoff@0.1.0` only on the reviewed exact S5/S6 and matching FB-2c commit and tree in the governed Contributor preview. Independently read back one accepted synthetic `post_room_message` proposal and its receipt, recover that same receipt after a cold restart, and prove no duplicate proposal, delivery, notification, wake, or provider send. Prove the preview installation key is unchanged across the restart. Collect zero-effect readback for the refusal matrix, including missing and mismatched signer custody. A lost reply remains unknown until a response-authenticated independent GET confirms the exact receipt and FB-2c records reconciliation under the original claim. No fixture or standalone route test counts as joined proof.

## Non-goals

No change to v1 launch, existing previews, generic MCP, runtime ownership, production activation, or live data. No provider request, guest execution, or recipient wake. Do not use the contract-only BI-588688A7 as an implementation claim or reopen a completed S5 carrier. The Windows path and migration of existing T3 threads are outside this slice.
