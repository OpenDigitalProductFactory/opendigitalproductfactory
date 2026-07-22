# Federation no-shell organization join implementation plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

**Umbrella backlog item:** `BI-52D34506`

**Parent outcome:** `BI-E3A084ED`

**Design authorities:**

- `docs/superpowers/specs/2026-07-19-federated-demand-network-design.md`
- `docs/superpowers/specs/2026-06-26-remote-action-edge-auth-and-dispatch-design.md`
- `docs/superpowers/specs/2026-06-25-remote-action-edge-dispatch-threat-model.md`

## Outcome

A non-technical operator can use Connections to create an expiring organization
join file on the Founder Hub authority installation and import it on the second
Mac or Windows installation. No terminal commands, installer arguments,
certificate copying, CA passwords, or hand-edited environment files are part
of the normal workflow. Privileged host work runs only through the
machine-bound, signed, allow-listed native Edge action channel.

This closes the trust prerequisite for certificate-valid nearby pairing and
automatic reconciliation of policy-eligible same-organization demand. It does
not weaken local backlog authority or make discovery itself trusted.

## Backlog coverage

- Decision: decomposed
- Umbrella: `BI-52D34506`
- Receipt: `cmrvft9zf0mj301qkdb9e44w2`
- `p2a-machine-dispatch` -> `BI-F12A8D0D`; dependencies: none
- `p2b-organization-join-actions` -> `BI-A8399604`; depends on `p2a-machine-dispatch`
- `connections-no-shell-ux` -> `BI-87B0DBD7`; depends on `p2b-organization-join-actions`
- `physical-two-host-acceptance` -> `BI-05EB708F`; depends on `connections-no-shell-ux`

The four deliverables are independently shippable: the read-only channel is a
general security foundation; the two host actions are independently testable
without UI; the Connections workflow is a user capability; installed-host
acceptance is governed release evidence rather than source implementation.

## Architecture decisions

- `DI-F822CC2C9F40` — high-confidence selection of an organization-rooted,
  dedicated Edge client-auth intermediate/profile. One organization trust
  anchor, separate issuer key and EKU policy.
- `DI-4D4877ED738F` — high-confidence selection of a dedicated Caddy mTLS
  listener with application-level certificate lifecycle and scope checks on
  every action request.
- The native Go Edge Node remains outbound-only and polls. No privileged
  localhost broker, inbound Edge port, Docker socket in the portal, or generic
  `script.run` action is introduced.
- `RemoteAction`, `ChangeRequest`, `EdgeNode`, `EdgeNodeCapability`,
  `EdgeNode.scopePolicy`, credential encryption, Step CA, and the existing
  cross-platform bootstrap scripts remain the canonical owners.

## Deliverable 1 — BI-F12A8D0D: machine-bound read-only dispatch

**Independently shippable:** yes. No host mutation.

### Source changes

1. Add a fleet-safe `EdgeNodeCertificate` side table and relations on
   `EdgeNode`; persist only CSR/certificate metadata, never a device private
   key. Add active fingerprint, node, status, and expiry indexes.
2. Extend Step CA bootstrap with a dedicated Edge client-auth
   intermediate/profile and CSR signing contract. Generate the device key in
   the native Edge OS keystore and enroll/renew from the host.
3. Generate a second Caddy site/listener for Edge actions (default `:8443`)
   using `client_auth require_and_verify`. Route only
   `/api/v1/edge/actions/*`, strip all incoming certificate-identity headers,
   and inject Caddy-derived fingerprint, serial, and subject values.
4. Add a transport-auth resolver that requires both the verified certificate
   metadata and the existing split bearer scope. Re-check active certificate,
   node trust, tenant/site scope, capability mode, and
   `scopePolicy.allowedActionTypes` on every request.
5. Sign a canonical dispatch envelope over action key/type, parameters digest,
   node ID, nonce, creation, and expiry. Persist consumption before execution.
6. Extend `services/edge-node-go` with an mTLS client, poll loop, authority
   signature verification, replay journal, and only an `inventory.collect`
   handler. Report fixed-schema evidence and support certificate renewal.

### TDD and verification

- Red tests first for bearer-only rejection, spoofed header stripping,
  unknown/revoked/expired/wrong-node certificate rejection, scope/allow-list
  enforcement, signature tamper/expiry/replay rejection, and claim races.
- Migration deploys against populated fixtures and a clean database.
- Caddy configuration adapts successfully and a TLS harness proves no-cert,
  wrong-cert, revoked-cert, and valid-cert behavior.
- Go tests exercise the poller and replay journal on darwin/windows/linux
  builds; an installed read-only pilot executes `inventory.collect` once.
- Full DB/web tests, typechecks, production build, security scan, and governed
  exact-SHA merged-code gate pass.

### Risk and rollback

- Default-off feature flag and disabled `action.execute` capability prevent
  activation during rollout.
- Removing the mTLS overlay and disabling the capability returns to the current
  read-up-channel behavior; additive certificate rows remain as audit metadata.
- Certificate revocation plus node quarantine stops the channel immediately.

## Deliverable 2 — BI-A8399604: organization join host actions

**Independently shippable:** yes. Exposes governed API/action behavior without
the operator-facing file workflow.

### Source changes

1. Add a closed RemoteAction type/parameter registry. Enable exactly
   `organization.join.issue` and `organization.join.import` after P2a proof;
   reject unknown fields and never interpolate a shell command.
2. Add action creation services that require the correct host role, explicit
   per-node allow-list, current local approval, and an approved `ChangeRequest`
   carrying impact, recovery, and post-change verification requirements.
3. Reuse the credential-encryption boundary for package material in
   `RemoteAction.parameters/result`. Decrypt only at dispatch/download, redact
   all evidence, and clear on first download, terminal import, failure cleanup,
   cancellation, or expiry.
4. Implement native Go parameterized handlers that invoke the existing Bash or
   PowerShell bootstrap owner through argument arrays, fixed executable paths,
   bounded temporary files, permissions checks, timeouts, and captured exit
   codes. No arbitrary executable/path/value is accepted.
5. After import, restart the persisted member overlays and record host-local
   evidence. Independently verify portal health, certificate trust, overlay
   persistence, and Edge heartbeat before terminal success.

### TDD and verification

- Red tests cover wrong role, missing approval/ChangeRequest, missing allowlist,
  schema/path/metacharacter abuse, expiry/replay, secret redaction/clearing,
  partial failure, rollback, and independent-health disagreement.
- Execute real issue/import against disposable authority/member directories on
  macOS and a Windows PowerShell contract harness.
- Run full package/web/Go tests, typechecks, production build, migration if
  required, security scan, and exact-SHA merged-code gate.

### Risk and rollback

- The actions remain disabled until explicitly allow-listed on a named node.
- Import snapshots the prior overlay/install state and restores it if the new
  trust path fails health verification.
- Package expiry and first-use clearing bound credential exposure.

## Deliverable 3 — BI-87B0DBD7: Connections no-shell workflow

**Independently shippable:** yes, after the host actions exist.

### Source changes

1. Add contextual **Create join file** and **Join an organization** actions to
   the existing Connections page. Do not add a global route or technical admin
   form.
2. Authority flow: intended installation, short expiry, plain-language scope
   preview, confirmation, truthful action progress, one-time download.
3. Member flow: file picker/drag-and-drop, local schema/fingerprint/peer/expiry
   preview, confirmation, upload, truthful import/restart/health progress.
4. Persist action identity so page refresh resumes status. Explain expired,
   wrong-peer, consumed, signature, permission, and health failures with one
   recommended recovery action.
5. Keep certificates, tokens, package content, CA passwords, and private keys
   out of HTML, logs, analytics, and error copy.

### UX verification

- Use existing report-kit primitives and platform theme tokens.
- Verify keyboard and screen-reader operation, error focus, desktop/narrow
  widths, light/dark themes, progress refresh, and empty/disabled states.
- A non-technical walkthrough must complete without terminal or installer
  instructions.

### Risk and rollback

- Hide/disable the controls when the secure action capability is absent; the
  already shipped installer argument remains a recovery path for one release.
- UI cancellation cancels only a not-yet-dispatched action; it never claims a
  running host mutation was undone.

## Deliverable 4 — BI-05EB708F: physical Founder Hub acceptance

**Independently shippable:** yes. Evidence-only closure after merged code is
deployed through the governed install/update path.

1. Advance both Founder Hub development/test installations to the merged release.
2. Use only Connections to issue/import organization trust.
3. Verify certificate-valid HTTPS from Mac to Windows and Windows to Mac.
4. Verify discovery add/expiry, automatic invitation exchange, matching code,
   dual approval, and service restart persistence.
5. Approve one minimized same-organization projection. Verify selected demand
   reconciles automatically, unselected/excluded fields do not egress, local
   authority is preserved, offline reconnect deduplicates, and revocation stops
   exchange.
6. Capture V-01/V-03 evidence without secrets and attach it to `BI-52D34506`.

## Completion gate

The no-shell outcome is complete only when all four mapped BIs are done, their
PRs/verification evidence are attached, both real installed hosts pass V-01 and
V-03, and a final parent audit proves:

- no normal setup step requires a shell or installer argument;
- discovery never creates trust;
- the action channel rejects bearer-only, spoofed, expired, replayed, and
  unauthorized requests;
- only the two founder-approved organization-join mutation types are enabled;
- certificate-valid pairing and approved automatic demand reconciliation work
  across the actual Founder Hub Mac/Windows topology;
- local backlog state remains sovereign and unselected data never egresses.
