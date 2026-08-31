# Security and authentication stack assessment

**As assessed:** 2026-08-30 against `origin/main` at `9b31fa091` and the live PostgreSQL backlog
**Backlog:** BI-E7553A1C  
**Scope:** identity, authentication, sessions, authorization, LDAP, PKI/mTLS, machine tokens, connector credentials, and runtime root-secret custody

## Outcome

The architecture has converged substantially since the older enterprise-auth plans. DPF now has one Principal authorization spine, an install-owned directory projection, a real LDAPS listener, Step CA organization PKI, scoped/revocable machine tokens, OAuth 2.1 work for MCP, and a provider-neutral connector credential kernel. The correct direction is to finish and harden these systems—not replace them with 1Password or another IdP.

The largest remaining security risks are at the edges of that architecture:

1. root secrets are single environment values with no executable external-provider boundary and no key-version rotation path;
2. production's `operator-only` credential stance is advisory at several host/container access boundaries rather than universally enforced;
3. local workforce login has no native MFA/passkey assurance tier even though policy surfaces refer to step-up;
4. customer/social authentication does not consult the Principal spine at the same sign-in boundary used by workforce credentials;
5. dynamically discovered external MCP tools without a canonical grant mapping are admitted by compatibility behavior, so discovery/connectivity can become ambient coworker authority;
6. some live backlog statuses and older spec references are stale relative to merged code, weakening roadmap truth.

## Implemented stack versus design

| Capability | Canonical intent | Current evidence | Assessment | Remaining work / live coverage |
|---|---|---|---|---|
| Canonical identity | `Principal` + `PrincipalAlias` is the enduring subject; credential holders are aliases, not parallel authority roots. | `core-identity.prisma`; `principal-linking.ts`; `effective-auth-context.ts`. | Strong substrate, broadly used. | Continue eliminating legacy `userId`-only authorization and close authority-model items under EP-31815F97. |
| Workforce authentication | Verify the credential, then let the Principal spine decide whether the identity may act. | `govern/auth.ts` calls `authorizePrincipalForSession`; inactive principals are refused; deactivation is transactional. | Implemented. | Put `principalId` in the session or keep the current authoritative lookup consistently; do not add a second identity cache. |
| Customer/social authentication | Customer identities converge to Principal and inactive principals cannot authenticate. | Customer password and Google/Apple paths issue sessions from `CustomerContact`; `loadEffectiveAuthContext` resolves aliases later. | Partial: authorization eventually resolves Principal, but the sign-in boundary is asymmetric with workforce. | File a focused successor BI after confirming desired customer/partner authority semantics. |
| Password authentication | Strong hashes, rehash-on-login, reset/recovery, no plaintext. | `password.ts`, Auth.js credential providers, reset design and routes. | Implemented baseline. | Native MFA/passkeys and risk-based reauthentication remain absent for workforce portal login. |
| Session security | HttpOnly, SameSite=Lax, HTTPS-aware Secure flag, JWT strategy, bounded redirect normalization. | `govern/auth.ts`. | Sound self-hosted baseline. | Explicit session lifetime/reauthentication assurance policy and root-secret versioned rotation are not complete. |
| OAuth / MCP clients | OAuth 2.1 authorization-server metadata, scoped access, refresh rotation/revocation, step-up scope challenges. | `lib/auth/oauth-*`, `/api/mcp/v1`, MCP self-authentication design. | Substantial implementation. | Several BI ids named in the 2026-08-26 spec no longer resolve in live backlog; reconcile plan identity/status before calling it complete. |
| Authorization | Effective authority is an intersection of Principal, role/capability, grant, sensitivity, room/case, and channel policy. | TAK grants, effective auth context, governed execute, workroom policy. | Strong and intentionally DPF-owned. | Finish the open Coworker Authority Model epic and enforce installation stance at the actual capability boundary. |
| Dynamic external tools | Discovery inventories capabilities; DPF policy must separately authorize their visibility and execution. | `getAvailableTools` filters mapped namespaced tools, but preserves permissive compatibility for tools missing from `TOOL_TO_GRANTS`; invocation does not re-evaluate a persisted DPF tool policy. | Authority gap: an unmapped discovered tool can be admitted by omission. | BI-8B7B2FE9 adds explicit quarantine/approval policy on `McpServerTool`, one shared evaluator, and execution-time recheck. |
| Directory | DPF publishes its own identity projection and remains complete without an external IdP. | Directory absorption design; projection and Principal-rooted auth merged in PR #4780. | Implemented core. | Maintain protocol and operator evidence; do not add authentik or make federation mandatory. |
| LDAP | Bind/search/group membership over TLS from DPF's directory. | `lib/directory/ldap/*`; `instrumentation.ts`; compose port/config; PR #4825. | Implemented and runtime-wired, off by default. | Live BI-A91004A7 still reads `triaging` although its titled fix merged as PR #4825—status reconciliation required. |
| PKI / mTLS | One organization CA issues portal/edge/directory material; no self-signed downgrade. | pinned Step CA image, bootstrap scripts, TLS overlays, PKI contract tests, LDAP TLS loader. | Implemented foundation. | Continue certificate-expiry, renewal, revocation, recovery, and canonical-runtime evidence; 1Password may hold keys but never becomes issuer/trust authority. |
| Connector credentials | One provider-neutral store owns schemas, encrypted fields/token cache, redaction, health, reconnect, and audit. | `IntegrationCredential`; connector kernel credential store; AES-256-GCM guard. | Strong lifecycle boundary. | Ciphertext format has no key id/version; changing `CREDENTIAL_ENCRYPTION_KEY` makes old ciphertext unreadable. File separate rotation work. |
| Social-provider secrets | Secret values should use the same protected credential boundary. | Auth sync reads `google_client_secret` and `apple_client_secret` from `PlatformConfig` into env. | Gap: this is outside the connector credential kernel and its encrypted envelope. | Migrate to the canonical credential store in a focused BI; do not route it through the 1Password bootstrap item. |
| Runtime root secrets | Logical secrets are portable across `.env`, cloud managers, Kubernetes, and external vaults. | Deployment contract §8 says this; compose currently injects `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` from `.env`. | Design exists, adapter substrate absent. | BI-E7553A1C implements the provider boundary and first 1Password Connect adapter. |
| Production agent access | Production credentials are operator-only and an agent cannot mint/read them merely because it can exec a container. | Installation stance reports `operator-only`; recovery backlog captured the missing enforcement problem. | Critical policy/enforcement gap; not live backlog-covered after installation replacement. | Re-file as live governed work; external custody reduces persistence but cannot protect a secret from a fully privileged process that legitimately consumes it. |
| Assurance / MFA | Sensitive actions require real step-up, not merely an approval label. | OAuth scope challenges and channel policies model `auth-required`; GitHub upstream auth delegates 2FA to GitHub. | Partial. | DPF portal workforce MFA/passkeys and consistent AAL/session policy need design and live BI coverage. |

## Backlog and plan conformance findings

- EP-24741BBF is the correct live directory/identity program. Its core implementation has advanced farther than several child statuses imply.
- BI-A91004A7 is a concrete status-drift example: the live item says `triaging`, while PR #4825 with the same title is merged and the runtime entrypoint is present on `origin/main`.
- The 2026-08-26 MCP self-authentication spec names five BI references that no longer resolve in the current live backlog. The reconciliation item must preserve the original text as historical evidence while replacing its current delivery pointers with live items.
- Older documents also name several epic references that no longer resolve live. They must be treated as historical/superseded identifiers, not current delivery coverage, and replaced by live pointers where the work remains active.
- The browser-driving design's historical `EP-BROWSER-DRIVE` roster no longer resolves live. Its browser mappings remain useful implementation evidence, but the platform-wide unmapped-tool authority gap now has one live home: BI-8B7B2FE9 under EP-413F2602.
- The recovery bundle contains a detailed production credential-enforcement item, but the corresponding live item is absent. Recovery JSON is not live backlog and cannot satisfy the gap.

## Priority order

1. **Now—BI-E7553A1C:** externalize startup root-secret custody behind a provider-neutral, fail-closed boundary; keep environment as default and 1Password optional.
2. **Next—BI-32935E47:** version the encrypted credential envelope, support read-old/write-new, controlled re-encryption, recovery, and compromise rotation before encouraging routine key rotation.
3. **Next—BI-80E4A139:** enforce `operator-only` at grants, host/runtime actions, diagnostics, and container-exec exposure boundaries; external vault use is defense in depth, not the enforcement mechanism.
4. **Next—BI-C9656270:** choose and implement workforce passkeys/MFA plus session/reauthentication tiers against NIST SP 800-63B-4.
5. **Next—BI-E22C3D75 and BI-DD3BBD02:** make customer/social sign-in consult the Principal spine before session issuance and migrate social-provider secrets into the canonical credential store.
6. **Next—BI-8B7B2FE9:** default-deny dynamically discovered external MCP tools until a DPF-owned policy explicitly authorizes listing and invocation.
7. **Hygiene—BI-FE678DA3:** reconcile merged PR evidence to live BI states and replace stale spec/backlog identifiers with live pointers.

## Security boundary for 1Password

1Password reduces secret persistence and centralizes custody/rotation evidence. It cannot prevent a compromised portal process or host administrator from reading secrets the process must use. The threat-model improvement is therefore:

- secrets no longer need to be durable in the DPF install's `.env`;
- vault access can be isolated and revoked independently;
- startup access appears in vendor audit events;
- provider outage fails startup rather than silently downgrading;
- application semantics remain portable.

It is not a sandbox, HSM, process-isolation boundary, IdP, CA, or authorization engine.
