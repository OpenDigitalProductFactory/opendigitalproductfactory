---
status: binding
---

# Portal-Mediated Organization Membership: the join file is sufficient

| Field | Value |
| --- | --- |
| Date | 2026-09-03 |
| Epic | `EP-ZERO-CONFIG-FEDERATION` |
| Backlog | BI-4DD1E739 (blocking), BI-105BB8B2, BI-AC7BCC58, BI-1F69D3F8 |
| Surface | member-side join import, authority-side certificate relay, federation tick |
| Supersedes in part | `2026-09-02-zero-configuration-organization-federation-design.md` §5.6 (how the member obtains its certificate); `2026-08-23-zero-touch-organization-federation-design.md` edge-host import path for members |

## 1. Decision

Choosing the organization join file on a member installation is sufficient to
make it a member. Nothing else is configured, generated or clicked: no edge
node role, no edge-actions overlay, no signing keys, no mTLS secret, no second
network port, no `.env` line. The member portal itself turns the join file into
a certificate by asking the **authority's portal** — the address it already
trusts, on the port it already reaches — to have the organization CA sign a
key the member generated. The authority portal relays that request to its
step-ca over the private compose network; the CA remains the only thing that
decides, and it can stay bound to loopback.

Founder ruling (2026-09-02): "membership — holding the organization's join
package — is the only switch." Founder ruling (2026-09-03): agents must be
able to test and pair installations in the founder's complete absence, never
by bypass.

## 2. What the live pair proved on 2026-09-03

- The member's only existing import path is a host script wrapped by a
  host-native edge node (`scripts/bootstrap-organization-pki.ps1 -Mode join`,
  `services/edge-node-go/internal/action/organization_join.go`). It needs
  `DPF_ORGANIZATION_TRUST_ROLE=member`, `DPF_EDGE_ACTION_*` files, the
  edge-actions compose overlay and a flag in `.env`. No installer sets any of
  it; the development installation's edge node has never reported the member
  role, so the Connections page says "No installation has reported the
  required organization role yet".
- That path runs `step ca root` and `step ca certificate` against the
  authority's step-ca directly. The authority bootstrap binds step-ca to
  `127.0.0.1`; production refuses 9000, 8443 and 443 from the LAN. A join file
  issued on production therefore cannot be imported by any member on the
  network today.
- The authority side's own edge-node cards still read "Enable secure host
  actions" with an enrollment conflict.

Each of these is a seam the founder ruling forbids. This design removes the
member-side seams entirely and keeps the authority's CA private.

## 3. Research and benchmarking

| System | Pattern | DPF decision |
| --- | --- | --- |
| [step-ca sign API](https://smallstep.com/docs/step-ca/provisioners/) (`POST /1.0/sign` with a one-time JWK token and a CSR) | The token, not network position, is the credential; the CSR carries the requester's key. | Adopt: the member generates its key locally, the join file's enrollment token authorises exactly one signing, the CA never sees a private key. |
| [ACME over an existing HTTPS front door](https://datatracker.ietf.org/doc/html/rfc8555) | Certificate issuance rides the same reachable endpoint as the service. | Adopt the shape: the authority's portal is the only endpoint a member needs. |
| [Kubernetes kubelet TLS bootstrap](https://kubernetes.io/docs/reference/access-authn-authz/kubelet-tls-bootstrapping/) | A bootstrap token yields a CSR that policy auto-approves; the node keeps its key in its state directory. | Adopt: material lands in the state directory the installer already preserves (`<state dir>/federation/pki`). |
| [Tailscale auth keys](https://tailscale.com/kb/1085/auth-keys) | One pre-authorised key enrols a device with no interactive step. | Adopt: the join file is the whole act; expiry is measured from issue and long enough for a file to be moved between machines. |

Rejected: opening step-ca to the LAN (a second port to keep reachable, TLS
name and firewall seams, contradicts the loopback default); shipping the CA
password to members (a shared secret); keeping the edge-node host script as
the member path (five prerequisites no installer produces).

## 4. Safety invariants

1. **The CA decides, the portal relays.** The authority portal forwards the
   member's CSR and the join file's enrollment token to step-ca's sign API and
   returns the CA's answer verbatim. It holds no provisioner key and cannot
   sign anything itself. A bad or reused token is refused by the CA.
2. **Private keys never leave the machine that generated them.** The member
   generates its keypair in the portal process and writes it mode `0600`
   under `<state dir>/federation/pki/`, the read-write mount slice 1 already
   established.
3. **Intended peer is enforced twice.** The member refuses a join file whose
   `intended_hostname` is not one of its own addresses; the CA refuses a CSR
   whose subject or SANs are not the ones the token was minted for.
4. **The relay is rate-limited and audited.** One relay call per token; the
   authority records `federation.membership.relay` events (member address,
   token id hash, CA verdict), never the token.
5. **Root pinning is unchanged.** The member pins the root by the join file's
   `root_fingerprint` before trusting the returned chain, exactly as the
   host script did.
6. **Membership survives teardown.** Material and facts live in the state
   directory; a fresh database re-reads them at boot (slice 1 `boot-reconcile`).

## 5. Contracts

### 5.1 Authority: certificate relay

`POST /api/v1/federation/membership/sign` (`@exposure private-mesh`, no
bearer; the enrollment token is the credential).

Request: `{ "spec": "dpf.membership-sign/1", "csrPem": "...", "enrollmentToken": "...", "memberAddress": "http://192.168.0.200:3000" }`.

The portal calls `${DPF_ORGANIZATION_CA_INTERNAL_URL:-https://step-ca:9000}/1.0/sign`
with `{ csr, ott }`, trusting the CA by the pinned root it already reads from
`/dpf-state/pki/root_ca.crt`. Response: `{ "accepted": true, "certPem": "...",
"chainPems": [...], "rootPem": "..." }` or `{ "accepted": false, "reason": "ca-refused" | "ca-unreachable" | "token-invalid" }`.
The route is available only on an installation that holds the organization
root and runs step-ca in its compose chain (`DPF_ORGANIZATION_TRUST_ROLE=authority`
or the `docker-compose.pki.yml` service present); elsewhere it answers 404.

### 5.2 Member: importing the join file

`importOrganizationJoinFile(fileText)` — a session-gated server action on the
Connections page ("Join this installation" → choose file), and the MCP tool
`import_organization_join_file` (pack `federation-membership`, capability
`manage_platform`, grant `sandbox_execute`) for automation.

Steps, all inside the member portal:

1. Parse and validate the package (`parseOrganizationJoinPackage`; version
   V1/V2; expiry; `intended_hostname` must equal one of the member's own
   addresses: `resolveAppBaseUrl()` host, `PUBLIC_URL` host, or any address
   the trusted peer records for us).
2. Generate an EC P-256 keypair and a CSR for `intended_hostname` plus
   `intended_sans`.
3. Derive the authority portal from `ca_url` as slice 2 already does
   (`deriveAuthorityPortalUrls`) and call §5.1.
4. Verify the returned chain against the pinned `root_fingerprint`
   (`verifyMembershipChain`).
5. Write `<state dir>/federation/pki/{root_ca.crt,authority.crt,authority.key}`
   (0600, atomic) and PlatformConfig `federation.membership.v1`
   `{ caUrl, intendedPeer, rootFingerprint, packageId, joinedAt }`.
6. Return `{ imported: true, authorityUrl, expiresAt }`; the next federation
   tick runs `reconcileOrganizationMembership`, which enrols with the
   authority and records the link trusted on both sides.

`membershipPaths()` prefers `<state dir>/federation/pki/` and falls back to
`/dpf-state/pki/` so an authority that bootstrapped by script is unaffected.
`readJoinPackageFacts()` reads `federation.membership.v1` first and the
completed `organization.join.import` RemoteAction second.

### 5.3 Authority: issuing the join file without an edge node

`issueOrganizationJoinFile({ intendedPeer })` — server action on the
Connections page and MCP tool `issue_organization_join_file`. `intendedPeer`
is chosen from the trusted same-organization links and discovery candidates
(BI-1F69D3F8), with a typed hostname as the fallback. The portal asks step-ca
for the one-time tokens the package carries through the CA's token endpoint
using the provisioner password the authority already keeps at
`/dpf-state/pki/secrets/step-ca-password`; the package is returned once and
expires 30 minutes after issue. This slice retires the edge-node
`organization.join.issue` action for the authority once it ships; until then
the existing issue path stays.

## 6. Slices

1. **Member import + authority relay** (§5.1, §5.2): a join file issued by
   today's authority path is importable by a member with nothing else
   configured; the CA stays on loopback.
2. **Authority issues without an edge node** (§5.3) and the MCP tools
   (BI-AC7BCC58 folds in here).
3. Retire the member-side host script path and the "Enable secure setup"
   requirement from the Connections page; the page shows only "Create join
   file" and "Join this installation".

## 7. Acceptance

1. On the live pair, a join file issued on production and imported on
   development by choosing the file, with production's step-ca still bound to
   loopback, results in a `trusted` link on both sides with
   `confirmationProvenance: organization-trust` within two federation ticks,
   with no approval and nothing typed.
2. The same import driven by an agent through the MCP tool, in the platform's
   own browser session or headless, succeeds identically.
3. A tampered or expired join file, or one intended for another host, is
   refused before any network call.
4. Tearing down and reinstalling the member keeping `DPF_STATE_DIR` keeps its
   membership; a fresh database re-reads the material at boot.
5. No route, action or installer step on the member reads
   `DPF_ORGANIZATION_TRUST_ROLE`, `DPF_EDGE_ACTION_*` or the edge-actions
   overlay for membership.

## Ordered fix sequence (this doc is the plan)

1. `apps/web/lib/federation/membership-material.ts`: keypair + CSR generation,
   atomic writes under `<state dir>/federation/pki/`, `membershipPaths`
   preference order; tests.
2. `apps/web/app/api/v1/federation/membership/sign/route.ts` + `lib/federation/membership-relay.ts`:
   step-ca sign relay, pinned-root TLS, audit events, rate limit; tests with a
   fake CA.
3. `lib/federation/organization-join-import.ts` + server action + Connections
   page wiring; `readJoinPackageFacts` reads PlatformConfig first; tests.
4. MCP pack `federation-membership` with `import_organization_join_file`;
   registry/grant/tool-surface updates; tests.
5. Live proof on the pair (acceptance 1–2), evidence on BI-105BB8B2.
6. Slice 2 and 3 as separate PRs.
