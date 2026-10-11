---
status: proposed
backlog: BI-550E8244
---

# Signed-in identity across the portal and AI clients

The workforce shell shows a role and Sign out without naming the person. The existing `get_my_coworker_profile` tool names the coworker but not the authenticated account. Confirmed on `bacf013ce9085633d155849067ac6e9eb7dd23be` in `apps/web/components/shell/Header.tsx` and `apps/web/lib/mcp/packs/coworker-capability-pack.ts`.

## Objectives and authority boundary

Expose the current identity where the person or assistant already works. Reuse Principal display identity and User email, the current session user ID, and server-resolved governed context. A shared read model serves the shell and existing coworker profile tool. Identity parameters never select a different account. The projection describes the account and connection; it does not grant authority. Existing grant intersection remains authoritative.

The global header shows the person's name (email fallback) in both Full and Simple mode. One accessible disclosure shows email, role, organization, and the existing sign-out action. It must work on narrow screens, with long names, and with keyboard input. The prototype is [account disclosure](../../ux-fit/2026-10-11-session-identity-prototype.html).

The existing coworker profile gains an additive `authenticatedAccount` section and `connection` section. Preserve its profile and effective-grants contract. If no coworker is bound, still identify the authenticated account while preserving the existing unbound result. Never infer a person's identity from the client name or local machine login. Connection details report authentication source and token scope only when server supplied; no token IDs, credentials, or invented values.

## Research & Benchmarking

Research inspected on 2026-10-11:

| Comparator | Identity model / pattern inspected | Adopt / reject |
| --- | --- | --- |
| [Keycloak UserRepresentation](https://www.keycloak.org/docs-api/latest/rest-api/index.html#UserRepresentation), [account console](https://www.keycloak.org/docs/26.7.5/server_admin/index.html) | Stable user ID with username, email, first/last name; account console personal information | Adopt distinct stable identity and human display name. Reuse DPF Principal rather than adding another identity provider. |
| [GitLab Users API](https://docs.gitlab.com/api/users/), [profile](https://docs.gitlab.com/user/profile/) | Current-user endpoint, ID, name, username, email; bot/internal populations distinguished | Adopt authenticated self projection and distinguish coworker from person. Reject public profile data as an account authority source. |
| [GitHub account menu](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/switching-between-accounts) | Profile menu identifies/selects the account | Adopt predictable global account placement. Account switching is out of this request's scope. |
| [Microsoft signed-in identity](https://learn.microsoft.com/en-us/entra/identity/users/how-to-get-signed-in-identity) | Human and workload identities, portal and CLI account details | Adopt explicit person/acting-client distinction and structured machine-readable self identity. |

Follow native HTML disclosure keyboard semantics and DPF's shell action contract (44px target, visible sign-out progress), theme tokens, and Principal identity spine. Reject role-only identification and initials-only mobile presentation: neither uniquely identifies a person. A persistent full email/role/org block adds header crowding; use progressive disclosure while leaving the account name visible.

## Acceptance

- AC-ACCOUNT: The workforce shell displays the authenticated person's name with email fallback; an accessible disclosure shows account email, role, and organization, including on mobile and in Simple mode.
- AC-CLIENT: The existing get_my_coworker_profile read tool exposes the authenticated human account separately from the acting coworker and server-resolved connection authentication/scope.
- AC-TRUST: Identity comes from the session and Principal/User records, never client-supplied identity parameters; no credentials or token IDs are returned.
- AC-COMPAT: Existing profile and grants fields remain compatible; sign-out behavior remains functional; missing display names fall back honestly to email.

## Compatibility and validation

No schema, dependency, install or seed change. No new MCP tool or authentication flow. Existing callers retain profile/grant fields. Installation identity already exists in MCP context and the shell's nonproduction badge; retain that canonical policy. This feature's organization label uses Organization, never branding as an identity authority.

Verify the shared read model's query binding and email fallback, header disclosure visibility and keyboard interaction, and profile handler bound/unbound compatibility. Run affected tests and web typecheck, then the governed build/UI checks required by gate context. Rollback reverts the additive projection and header control together.

Adjacent live items BI-E22C3D75, BI-EDB67A2B and BI-05E0EA33 govern authentication issuance/provisioning; this item displays the already authenticated identity and does not change those paths.
