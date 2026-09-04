---
status: draft
---

# Security and authentication hardening successor design

**Status:** proposed for independent review  
**Backlog:** BI-32935E47, BI-80E4A139, BI-C9656270, BI-E22C3D75, BI-DD3BBD02, BI-FE678DA3, BI-8B7B2FE9
**Epic:** EP-413F2602  
**Source assessment:** `docs/security/2026-08-30-security-authentication-stack-assessment.md`

## 1. Purpose

The security/authentication assessment and authority follow-up found seven independently shippable gaps around an architecture that is otherwise converging correctly. This document is their shared canonical design baseline. It keeps the gaps coordinated without turning them into one unsafe implementation batch.

The governing boundary is unchanged: DPF owns Principal identity, authentication policy, authorization, LDAP, PKI, credential lifecycle, and audit. External identity providers and secret managers may supply assertions or custody, but they do not become DPF's authorization system, directory authority, certificate authority, or canonical credential store.

Each backlog item below has its own objectives, acceptance contract, migration and failure boundary. Each implementation therefore requires its own plan, workroom, review, PR, verification, and completion evidence.

## 2. Shared architectural constraints

1. **One Principal spine.** Every human or machine session resolves to an active canonical Principal before authority is granted. Credential-holder records remain aliases or authentication sources, not parallel authorization roots.
2. **One credential kernel.** Secret-bearing integration and social-provider configuration uses the canonical encrypted credential store, safe projection, health, reconnect, redaction, and audit semantics.
3. **Provider-neutral custody.** Environment, 1Password, cloud managers, Kubernetes, and future vault adapters provide logical values through stable contracts. Vendor-specific concepts stop at adapter edges.
4. **Version before rotation.** No operator workflow encourages changing `CREDENTIAL_ENCRYPTION_KEY` until ciphertext identifies its key version and read-old/write-new plus recovery are proven.
5. **Enforcement at the boundary.** Production's operator-only stance is enforced by grants, tools, process boundaries, and deployment controls. Prompts and UI warnings are explanatory, never the control.
6. **Assurance is session state.** Authentication methods, freshness, and assurance travel in the effective authentication context and are checked for consequential actions.
7. **Forward-only migration.** Existing installs retain access through inline backfills, compatibility reads, verification, and explicit retirement gates. No clean-schema-only migration is acceptable.
8. **Value-free evidence.** Logs, diagnostics, tests, and receipts may identify secret classes and failure categories but never secret values, bearer material, private keys, or recoverable ciphertext/plaintext pairs.
9. **Unknown tools have no authority.** Dynamic discovery may inventory a tool, but only a DPF-owned policy may authorize it. Missing, stale, or incomplete policy is a deny state, never compatibility permission.

## 3. Research and benchmarking

The design adopts established patterns without importing a replacement identity platform:

- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/) treats manually entered OTPs as non-phishing-resistant and recognizes cryptographic verifier/channel binding. DPF therefore prefers WebAuthn/passkeys for workforce assurance and treats fallback methods as recovery paths with explicitly lower assurance.
- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/) defines scoped public-key credentials and lifecycle operations. DPF adopts the browser/RP ceremony and authenticator model rather than designing a proprietary factor protocol.
- [Keycloak's administration model](https://www.keycloak.org/docs/latest/server_admin/) demonstrates passkeys, configurable authentication flows, identity brokering, and LDAP federation. DPF adopts the separable flow and lifecycle concepts but rejects replacing its Principal, authorization, LDAP, and customer/workforce domain model with a second identity server.
- [HashiCorp Vault Transit](https://developer.hashicorp.com/vault/docs/secrets/transit) demonstrates versioned ciphertext, read-old/write-new keyrings, minimum decrypt versions, and rewrap. DPF adopts those lifecycle invariants in its provider-neutral envelope; it does not require Vault or move application authorization into a vault.
- The [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) requires clients to treat tool annotations as untrusted unless the server is trusted. DPF adopts annotations as discovery hints only; grant, side-effect, and execution policy remain deterministic DPF-owned controls.
- The [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) separates transport authorization from application policy. DPF preserves that split: a valid server token establishes connectivity, not permission for a coworker to see or invoke every tool the server advertises.

The design also carries forward the 1Password/OpenBao/Infisical comparison and NIST SP 800-57/OWASP controls recorded in `docs/security/tool-evaluations/2026-08-30-1password.md`.

## 4. Target architecture

```text
authentication sources                    secret custody sources
  password / passkey                       env / 1Password / future adapter
  Google / Apple / upstream IdP                       |
  LDAP bind / machine token                           v
            |                                logical root-secret boundary
            v                                           |
 credential verification / assertion validation        v
            |                                canonical credential kernel
            v                                  + versioned crypto envelope
 canonical Principal resolution                          |
            |                                            v
 active-state + assurance decision              safe projection / health
            |                                  reconnect / audit / rotation
            v
 effective auth context
            |
            v
 role + capability + grant + room/channel policy
```

The seven slices strengthen this architecture at distinct seams. None introduces a second identity store, authorization cache, certificate authority, or vendor-owned source of truth.

## 5. BI-32935E47 — versioned credential-encryption key lifecycle

### Objectives

**OBJ-KEY-001:** Replace unversioned AES-256-GCM payloads with a self-describing, validated envelope containing format version, algorithm, key id/version, IV, authentication tag, and ciphertext.

**OBJ-KEY-002:** Resolve keys through one provider-neutral keyring contract with exactly one active write key and a bounded set of readable historical keys.

**OBJ-KEY-003:** Support read-old/write-new, inventory, resumable re-encryption, verification, rollback, compromise response, and evidence-backed retirement across every encrypted field family.

### Design

- Introduce a canonical envelope codec in the shared credential crypto primitive; delete or delegate duplicate crypto implementations.
- Compatibility reads recognize the legacy envelope only during a measured migration window and report legacy/version coverage without values.
- Writes always emit the newest format with the active key id. Reads select a key only by validated envelope metadata; blind try-every-key decryption is prohibited.
- Re-encryption is idempotent, bounded, resumable, and compares authenticated plaintext inside the protected operation before replacing a row.
- Retirement is refused until inventory reports zero unread, legacy, failed, or old-version rows in all registered field families and backup/restore rehearsal evidence exists.
- External custody may supply key versions, but the keyring interface and envelope remain DPF-owned.

### Acceptance contract

| Acceptance | Objective | Statement |
|---|---|---|
| AC-KEY-001 | OBJ-KEY-001 | Legacy ciphertext remains readable while all new writes use the active versioned envelope. |
| AC-KEY-002 | OBJ-KEY-003 | The inventory covers `IntegrationCredential`, `CredentialEntry`, MCP encrypted token copies, and every registered encrypted field family. |
| AC-KEY-003 | OBJ-KEY-003 | Rotation can pause, resume, verify, and roll back without losing readable credentials. |
| AC-KEY-004 | OBJ-KEY-001 | Unknown format, algorithm, or key id fails closed with value-free diagnostics. |
| AC-KEY-005 | OBJ-KEY-003 | Key retirement is mechanically refused until coverage, recovery, and destruction prerequisites pass. |

## 6. BI-80E4A139 — production operator-only credential enforcement

### Objectives

**OBJ-OPS-001:** Convert the production installation credential stance from advisory metadata into deny-by-default authorization at every credential-capable boundary.

**OBJ-OPS-002:** Preserve deliberate local-permitted development/test workflows without allowing environment labels or prompts to weaken production controls.

**OBJ-OPS-003:** Make host/container privilege assumptions explicit and test refusals, redaction, approvals, and audit evidence.

### Design

- Build a closed inventory of actions that can read, mint, rotate, export, mount, diagnose, or derive credential material.
- Centralize a production credential-action policy consumed by MCP tool visibility/execution, agent grants, admin routes, support bundles, runtime diagnostics, and host operations.
- Hide non-advise-safe credential tools from production agents. Operator-approved workflows accept only references or redacted metadata from agents; operators supply secret values through operator-controlled surfaces.
- Separate installation purpose/posture from deployment substrate. Production is never inferred from a user-editable request parameter.
- Treat Docker socket, container exec, mounted `.env`, host process inspection, and backup access as deployment-level privileged boundaries. Document and reduce them; do not claim application policy can constrain a host administrator.
- Record refusal and approval events without material values.

### Acceptance contract

| Acceptance | Objective | Statement |
|---|---|---|
| AC-OPS-001 | OBJ-OPS-001 | Every inventoried production credential action is denied to an unapproved agent at the earliest enforceable boundary. |
| AC-OPS-002 | OBJ-OPS-001 | Credential-capable tools are absent or refused under intersected grants; a prompt instruction alone cannot authorize them. |
| AC-OPS-003 | OBJ-OPS-002 | Development/test local-permitted behavior remains explicit and covered by tests. |
| AC-OPS-004 | OBJ-OPS-003 | Diagnostics, logs, support artifacts, and receipts remain value-redacted. |
| AC-OPS-005 | OBJ-OPS-003 | Deployment documentation states residual host-administrator and compromised-process risk accurately. |

## 7. BI-C9656270 — workforce passkeys and assurance-aware reauthentication

### Objectives

**OBJ-MFA-001:** Add phishing-resistant workforce WebAuthn/passkey enrollment and authentication with multiple authenticators per Principal.

**OBJ-MFA-002:** Carry authentication method, assurance, and freshness in the effective auth context and require current assurance for consequential actions.

**OBJ-MFA-003:** Govern recovery, replacement, revocation, loss, and break-glass so they cannot silently bypass the intended assurance level.

### Design

- Store public credential id, public key, sign counter/backup state where applicable, transports, friendly label, creation/use/revocation timestamps, and Principal ownership. Never store authenticator private keys.
- Bind registration and authentication challenges to the relying party, origin, Principal/session, ceremony purpose, expiry, and single use.
- Prefer user-verifying, discoverable credentials for passwordless use. Permit password plus WebAuthn as a staged migration path; classify OTP/recovery alternatives below phishing-resistant assurance.
- Add `methods`, `assurance`, and `authenticatedAt`/`reauthenticatedAt` to the authoritative auth context rather than a page-local session flag.
- Define a shared consequential-action policy for credential administration, access exports, deployment, privilege/grant changes, break-glass, and other high-impact actions.
- Recovery uses independent evidence and approval appropriate to the installation, revokes compromised authenticators, and forces fresh sessions.

### Acceptance contract

| Acceptance | Objective | Statement |
|---|---|---|
| AC-MFA-001 | OBJ-MFA-001 | A workforce Principal can enroll, name, use, and revoke more than one WebAuthn authenticator. |
| AC-MFA-002 | OBJ-MFA-001 | Challenges are scoped, expiring, single-use, origin/RP validated, and replay-resistant. |
| AC-MFA-003 | OBJ-MFA-002 | Consequential actions check current assurance and freshness server-side. |
| AC-MFA-004 | OBJ-MFA-003 | Recovery and break-glass are independently auditable and cannot produce an unmarked high-assurance session. |
| AC-MFA-005 | OBJ-MFA-002 | LDAP, PKI, Principal, role, capability, and optional upstream federation ownership remains unchanged. |

## 8. BI-E22C3D75 — Principal-gated customer and social sign-in

**Section status:** reconciled for independent design review on 2026-09-04.

### Objectives

**OBJ-PRI-001:** Resolve or materialize the canonical Principal and alias before customer password or social session issuance.

**OBJ-PRI-002:** Apply active, conflict, tenant/account, and authentication-authority checks consistently across password, social, linking, onboarding, and deactivation flows.

**OBJ-PRI-003:** Preserve customer/contact domain semantics while eliminating authorization-before-identity asymmetry.

### Design

- Introduce one sign-in authorization seam that accepts a verified credential/assertion and returns an authorized Principal-rooted session subject or a stable refusal.
- CustomerContact remains the customer-domain credential/profile holder and account-scoping record; `PrincipalAlias` binds it to authority.
- Social identities are keyed by the provider plus its immutable subject identifier. Email is an asserted attribute used only by the guarded linking flow; it is never the canonical external identity key.
- Auto-linking requires a provider assertion that explicitly marks the email verified and the existing guarded linking rules. Ambiguous or conflicting aliases refuse rather than choose.
- Onboarding creates the contact, Principal, and alias transactionally before session issuance.
- Deactivation makes the credential holder and Principal authorization outcome consistent in the same transaction/invariant.
- Effective auth loads by canonical principal identity and derives customer/account scope; it does not materialize another identity cache.
- The shared seam is population-aware but credential-neutral: password comparison and provider assertion validation remain at their existing boundaries, then the seam resolves or materializes exactly one Principal, checks active/contact/account/conflict state, and returns the canonical Principal id plus the existing customer scope projection.
- Population repair is bounded and idempotent. The migration converges contacts set-wise, while the repeatable runtime invariant query pages or aggregates instead of loading an unbounded contact inventory.

### BI-specific research and architecture fit

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability) makes the issuer plus `sub` the stable end-user identifier and explicitly warns that claims such as email must not be used as unique identifiers. DPF adopts provider plus provider-account id as the social alias key and rejects email-only identity selection.
- [Keycloak identity brokering](https://www.keycloak.org/docs/latest/server_admin/#_identity_broker) links an external provider identity to a local realm identity before issuing the application-facing token and supports explicit first-login/linking flows. DPF adopts that local-identity-before-session ordering, while rejecting Keycloak as a second identity/authorization system because Principal already owns that role.
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) requires session management to bind authentication to access control. DPF applies the binding at the Auth.js issuance boundary: a verified credential or assertion is insufficient until the Principal authority decision passes.

The existing `Principal`, `PrincipalAlias`, `CustomerContact`, `SocialIdentity`, and effective-auth context remain the normalized homes for authority, aliases, customer scope, provider assertions, and request authorization respectively. No schema model or session identity cache is added. The design scales with indexed point lookups per sign-in; the only whole-population operation is the one-time, set-based migration plus a bounded invariant check. Higher-volume identity reconciliation remains owned by EP-24741BBF rather than being duplicated here.

### Acceptance contract

| Acceptance | Objective | Statement |
|---|---|---|
| AC-PRI-001 | OBJ-PRI-001 | No customer password or social session is issued before an active canonical Principal authorizes it. |
| AC-PRI-002 | OBJ-PRI-002 | Inactive, unresolved, and conflicted principals fail consistently across all sign-in/link paths. |
| AC-PRI-003 | OBJ-PRI-002 | Onboarding and deactivation cannot leave a session-capable split state. |
| AC-PRI-004 | OBJ-PRI-003 | Existing customer account/contact scoping is preserved and derived from the Principal-rooted context. |

## 9. BI-DD3BBD02 — social-provider secrets in the credential kernel

### Objectives

**OBJ-SOC-001:** Make the canonical encrypted credential store the only writer and reader for Google and Apple client secrets.

**OBJ-SOC-002:** Migrate existing installs forward without login loss and remove secret-bearing `PlatformConfig` projections.

**OBJ-SOC-003:** Reuse provider-neutral schema, redaction, health, reconnect, and audit behavior while preserving the Auth.js initialization seam.

### Design

- Define Google and Apple connector credential schemas using the existing registry; safe fields and secret fields remain explicitly separated.
- Add a forward-only migration/backfill that encrypts legacy secret values, verifies the destination, then removes or nulls the legacy source in the same governed transition.
- During a bounded compatibility release, reads prefer the canonical store and may import a legacy value exactly once; no new write may target `PlatformConfig`.
- Auth.js provider construction reads a safe provider-configuration adapter that resolves credential references at server initialization without copying secrets into diagnostics or safe projections.
- Reconnect/rotation follows the credential kernel and invalidates only the affected provider configuration.

### Acceptance contract

| Acceptance | Objective | Statement |
|---|---|---|
| AC-SOC-001 | OBJ-SOC-002 | No Google or Apple client secret remains readable from `PlatformConfig` after migration. |
| AC-SOC-002 | OBJ-SOC-002 | Existing configured installations retain sign-in capability through a clean forward migration and rollback plan. |
| AC-SOC-003 | OBJ-SOC-003 | Safe projections, logs, diagnostics, errors, and audit receipts never expose the client secret. |
| AC-SOC-004 | OBJ-SOC-001 | The credential kernel is the single writer/reader and Auth.js uses one supported adapter seam. |

## 10. BI-FE678DA3 — security/identity backlog reconciliation

### Objectives

**OBJ-REC-001:** Reconcile live security/identity backlog state with merged source, canonical-runtime evidence, and acceptance criteria.

**OBJ-REC-002:** Replace stale spec identifiers with live pointers or explicit historical/superseded annotations.

**OBJ-REC-003:** Add a repeatable drift detector or governed cadence so source, docs, and PostgreSQL do not silently diverge again.

**OBJ-REC-004:** Close the capture-process defect that allowed build-bound BIs to be filed or triaged without proportional canonical design coverage.

### Design

- Enumerate the active identity/security epics and children from live PostgreSQL, then map each to current specs, PRs, merged source, runtime verification, and unresolved acceptance.
- Never infer `done` from a merged PR alone. Mark implementation present but runtime/acceptance evidence missing as open or in progress with the missing evidence named.
- Preserve historical identifiers only when clearly labeled historical/superseded and linked to the live successor.
- Add a deterministic check that extracts active BI/epic references from canonical specs and reports unresolved or mismatched live records. The check must tolerate intentionally historical references through an explicit annotation, not a broad ignore list.
- Route every correction through MCP activity and PR evidence so both stores retain provenance.
- Change the backlog-filing procedure so a build-bound BI and design are one capture outcome: reuse, extend, or create the design, then cross-link the generated BI id in the same branch/PR. A surface that cannot write source leaves the BI in triage with a visible design handoff rather than silently advancing designless work.

### Acceptance contract

| Acceptance | Objective | Statement |
|---|---|---|
| AC-REC-001 | OBJ-REC-001 | Every active identity/security deliverable resolves to one live BI and current epic. |
| AC-REC-002 | OBJ-REC-001 | Merged, runtime-verified, acceptance-verified, and done are distinguishable states. |
| AC-REC-003 | OBJ-REC-002 | Canonical specs do not present absent identifiers as current delivery coverage. |
| AC-REC-004 | OBJ-REC-003 | A repeatable check or governed cadence detects future spec/backlog reference drift. |
| AC-REC-005 | OBJ-REC-004 | The canonical backlog-filing skill refuses to report a build-bound BI as fully filed or build-ready without an exact design path/section, and defines the source-incapable handoff. |

## 11. BI-8B7B2FE9 — default-deny dynamically discovered external MCP tools

### Objectives

**OBJ-MCP-AUTH-001:** Make every dynamically discovered external MCP tool resolve to an explicit DPF-owned authorization policy before it can appear in an AI coworker's tool surface.

**OBJ-MCP-AUTH-002:** Recheck the same human-capability, agent-grant, external-access, execution-mode, and side-effect policy at invocation so stale discovery cannot bypass listing-time authorization.

**OBJ-MCP-AUTH-003:** Preserve operability for deliberately approved external tools through an auditable quarantine, classification, approval, rename, and revocation lifecycle.

### Design

- Keep `TOOL_TO_GRANTS` as the canonical bundled-tool mapping. Do not create a browser-specific or external-server-specific grant system.
- Extend the existing `McpServerTool` record with typed closed policy status (`quarantined`, `approved`, `denied`), effect posture, and allowed execution modes, plus the approved grant key, policy version, `approvedByPrincipalId`, and approval timestamp. This is policy projection on the existing discovery record, not a new identity or permission table; approval provenance points to the canonical `Principal`, never a parallel user identity.
- Discovery writes remote annotations into an explicitly untrusted evidence field, never into effective policy. Newly discovered and materially changed tools enter `quarantined` unless a versioned bundled policy deterministically covers the namespaced tool.
- A shared resolver combines bundled mappings and approved persisted policy into the existing `isToolAllowedByGrants` path. Unknown status, unknown grant key, incomplete effect metadata, stale policy version, or server/tool identity mismatch denies.
- `getAvailableTools` uses the resolver for listing. `executeMcpServerTool` re-resolves immediately before the remote call and records allow/deny in `AuthorizationDecisionLog`; a stale model-visible tool list cannot authorize execution.
- The migration classifies currently mapped bundled tools from their canonical map and quarantines every other discovered tool. It never infers approval from `isEnabled`, server health, descriptions, or remote annotations.
- Inventory and operator diagnostics report mapped, denied, and quarantined tools without exposing raw credentials or suggesting that connectivity equals authority.
- Server/tool renames follow the existing tool-name compatibility principle: an alias is callable only when it carries equivalent explicit policy during its bounded compatibility window.

The chosen hybrid approach was kernel-ratified in `DI-F6D4C0132024`. It beat static-map-only and persisted-policy-only alternatives with high confidence because it extends the existing registry and evaluator while keeping dynamic integrations operable.

### Acceptance contract

| Acceptance | Objective | Statement |
|---|---|---|
| AC-MCP-AUTH-001 | OBJ-MCP-AUTH-001 | An unmapped, quarantined, stale, or incomplete dynamically discovered tool is absent from every coworker tool surface, including with External Access enabled. |
| AC-MCP-AUTH-002 | OBJ-MCP-AUTH-001 | A mapped tool is visible only when the acting human capability, agent grant, execution mode, and external-access requirements all pass. |
| AC-MCP-AUTH-003 | OBJ-MCP-AUTH-002 | Invocation rechecks the current policy and refuses stale-list, revoked, renamed-without-policy, and now-quarantined tools before any remote call. |
| AC-MCP-AUTH-004 | OBJ-MCP-AUTH-003 | Inventory classifies every active discovered tool as bundled-approved, explicitly approved, denied, or quarantined; no active tool is authorized by omission. |
| AC-MCP-AUTH-005 | OBJ-MCP-AUTH-003 | Remote annotations remain untrusted evidence and cannot widen grants, lower side-effect posture, or authorize an execution mode. |
| AC-MCP-AUTH-006 | OBJ-MCP-AUTH-002 | Canonical-runtime evidence proves an unknown tool is refused and an explicitly mapped tool succeeds with an authorization decision record. |

## 12. Delivery order and dependency rules

1. **BI-FE678DA3 first or in parallel with design work:** restore roadmap truth before completion claims.
2. **BI-32935E47 before routine root-key rotation:** the optional 1Password adapter may land first, but operators must keep the same key value until versioned rotation is delivered.
3. **BI-80E4A139 independently high priority:** external custody does not protect a secret from a process or host authorized to consume it.
4. **BI-E22C3D75 before assurance-dependent customer actions:** canonical session identity precedes new customer assurance policy.
5. **BI-DD3BBD02 independently migratable:** coordinate with credential-envelope work so it does not create a second crypto format.
6. **BI-C9656270 after an implementation plan defines rollout/recovery:** passkey enrollment and recovery require explicit UX and operational verification.
7. **BI-8B7B2FE9 before enabling more dynamic MCP servers for coworkers:** connectivity and discovery may continue, but unknown tools remain quarantined until this boundary is implemented.

No slice waits for all others unless its implementation plan names a concrete dependency. This design coordinates invariants; it is not authorization for a six-item batch.

## 13. Cross-cutting verification

Every implementation plan must classify and exercise:

- authorization and inactive/conflict refusal paths;
- secret/value redaction and gitleaks coverage;
- migration against populated legacy data when schema/storage changes;
- backup, rollback, recovery, and partial-failure behavior;
- production versus development/test posture;
- session invalidation and reauthentication effects;
- documentation impact for operators, users, coworkers, architecture, and external agents;
- focused tests, production build, semantic review, exact-tree gate, and canonical-runtime UX/operational verification where applicable.
- dynamic-tool policy inventory and a negative invocation proving an unclassified external tool cannot reach its server.

## 14. Non-goals

- replacing DPF LDAP with Microsoft Entra ID, Active Directory, Keycloak, or 1Password;
- replacing Step CA or DPF organization PKI;
- delegating DPF authorization, roles, capabilities, TAK grants, or workroom policy to an IdP or vault;
- storing all connector credentials directly in 1Password;
- treating vendor compliance certifications as DPF compliance;
- merging the seven backlog items into one implementation PR.
