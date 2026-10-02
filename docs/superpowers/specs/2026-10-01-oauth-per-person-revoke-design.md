# End one person's access under a shared AI-client registration

- Backlog item: BI-0A724798
- Epic: EP-31815F97
- Status: proposed
- Date: 2026-10-01

## Problem

Admin > Platform Development > Keys for automated tools has one revoke control per client registration (`revokeOAuthClient`, `apps/web/lib/actions/oauth-clients.ts`). It revokes the client and every token under it. A browser-registered client such as Claude Code is shared: everyone who connects Claude Code to this install holds grants under the same registration. The only way to end one person's access is to end everyone's.

Live case, 2026-10-01: registration `dpfoc_ee5e…` holds 4 live refresh grants for `admin@dpf.local`. They were issued 2026-09-23 to 09-26, before consent required an explicit account choice (BI-07D21B4A), and are valid until 2026-10-23 to 10-26. The same registration holds the operator's own live grants, including the session doing this work. Nobody has used admin's grants since 2026-09-26, but any Claude Code client that still holds one can act as admin. Its approvals would then go to an account nobody reads, which is the failure the BI-F25A5FC7 handover just repaired.

## Objectives

- **OBJ-PERSON-REVOKE:** An operator can end one person's access under a shared AI-client registration while every other person's access under that registration stays live.
- **OBJ-ATTRIBUTION:** Each per-person revocation records who ended the access, why, and when, and the client's People list shows it afterwards.
- **OBJ-GUARDS:** The control refuses the caller's own grants, a missing reason, an unknown client and a non-operator caller.

## Research & Benchmarking

| System | How one person's access to one app ends | What DPF takes |
|---|---|---|
| Okta | `DELETE /api/v1/users/{userId}/clients/{clientId}/grants` and `.../tokens` revoke every grant and refresh token one user holds for one client; other users' grants are untouched. The admin console exposes it per user. | The exact unit: (client, person). Both refresh and access tokens. |
| Google Workspace | Admin console > user > Security > Connected applications: remove one user's access to one app. Domain-wide "block app" is a separate, larger control. | Keep the whole-client revoke as the larger control; add the per-person one beside it. |
| Keycloak | Users > Consents: revoke a client's consent for one user, which invalidates that user's tokens for it. | Revocation is attributable and visible after the fact. |
| GitHub | A user revokes their own authorization of an OAuth app; an org owner can restrict the app. | Rejected: self-service alone does not help when the holder is an account nobody signs in to. |

Standard: RFC 7009 (OAuth 2.0 Token Revocation). Revoking a refresh token should also invalidate the access tokens issued from the same grant. DPF already does this for the whole-client revoke; the per-person control keeps that rule.

## Design

### Server action: `revokeOAuthClientPersonGrants`

`revokeOAuthClientPersonGrants({ clientId, userId, reason })` lives in `apps/web/lib/actions/oauth-clients.ts` beside `revokeOAuthClient`.

- **Who may call it:** the same gate as the whole-client revoke, `requireOperator()` (`manage_provider_connections`).
- **Inputs:** `reason` is required, trimmed, 1 to 500 characters.
- **What it revokes:** in one transaction, every unrevoked `McpApiToken` and `OAuthRefreshToken` with this `oauthClientId` and this `userId`. Each gets `revokedAt = now` and `revokedReason = "operator_revoked_person: <reason> (by <operator email>)"`.
- **What it leaves alone:**
  - the client row;
  - every other person's tokens;
  - authorization codes, which expire in minutes and are single-use.
- **Self-protection:** it refuses when `userId` is the calling operator. Revoking your own grants from this control would cut off the session you may be working from. A person ends their own access by revoking the connection in their own client, or with the whole-client control.
- **Returns:** `{ revokedAccessTokens, revokedRefreshTokens }`.

### Listing who holds grants: `listOAuthClientPeople`

`listOAuthClientPeople(clientId)` is gated like the action and returns one row per person:

- email;
- live access tokens and live refresh grants;
- last use, from the latest `McpApiToken.lastUsedAt`;
- the latest revocation in the last 30 days, with its reason and time;
- `isYou`.

The query is bounded to 200 people and reads only existing columns. There is no schema change.

### Screen

On the "Keys for automated tools" table, each active browser-registered client row gets a "People" disclosure. Credentials (headless) clients belong to no person and get none. It lists the rows above. Each person other than the caller has a "Revoke this person's access" danger button. The button opens the existing `promptDialog`, the reason-taking sibling of `confirmDialog`, which requires a reason before calling the action. The caller's own row reads "You". Recently revoked people show "Revoked <time> — <reason>".

All of this uses existing primitives: `Button`, `promptDialog`, `DataTable`, `StatusBadge`, `Notice` and theme tokens.

### Not in scope

- Reassigning an orphaned approval (BI-D9562C1D).
- Deactivating a user account. That is a separate, larger decision; deactivation already stops the person's sign-in.

## Acceptance

| ID | Objectives | Statement |
|---|---|---|
| AC-1 | OBJ-PERSON-REVOKE | Revoking admin@dpf.local under `dpfoc_ee5e…` revokes admin's access and refresh tokens for that client only; the operator's grants under the same client stay live and keep working. |
| AC-2 | OBJ-ATTRIBUTION | The revocation records the operator and reason in `revokedReason` and the time in `revokedAt`, and the client's People list shows it. |
| AC-3 | OBJ-GUARDS | The action refuses the caller's own user id, a missing reason, an unknown client and a non-operator caller. |
| AC-4 | OBJ-PERSON-REVOKE, OBJ-ATTRIBUTION, OBJ-GUARDS | Tests cover shared-client isolation, self-protection and attribution. |
