# ChatGPT/Codex verification recovery

Backlog: BI-C4FCC089. Workroom: WC-4214F2E0.

## Problem and design grounding

The operator's verification fails with structured HTTP 401 `token_expired` while masked account metadata reports a future expiry and a refresh token. The cause of the metadata discrepancy is unconfirmed. The existing Responses probe trusts cached credential expiry and never refreshes after upstream rejection. PR #6243 moved ChatGPT sign-in to the shared Codex panel; the generic failure gives no sign-in guidance. The API-derived heading "Subscription responses" also confuses the operator.

Reuse the generic OAuth refresh contract in `apps/web/lib/govern/provider-oauth.ts`, default Codex/ChatGPT ownership, explicit account isolation, and Responses completion validation. Grounding: [OAuth design](../specs/2026-03-21-provider-oauth-authorization-code-design.md), [account design](../specs/2026-10-04-provider-multi-account-design.md), `provider-auth-test.ts`, `ProviderRoutingControlPanel.tsx`, and `ai-provider-data.ts`. Reject a second credential store, automatic disconnect, indiscriminate retries and using metadata as proof of upstream validity.

## Acceptance

- AC-1: When OAuth Responses verification receives structured HTTP 401 token_expired, renew through the owning credential path and retry at most once; unrelated 401s and quota/network failures do not trigger refresh.
- AC-2: Explicit accounts never fall back to or modify another account, and shared default ChatGPT recovery uses its existing Codex owner.
- AC-3: If renewal fails, show an actionable sign-in-needed state and route to the shared Codex connection from ChatGPT; saved-settings success must not imply verified authentication.
- AC-4: Regression tests cover successful renewal, failed renewal, one-retry limit, explicit account boundaries and visible keyboard-accessible shared sign-in recovery; typecheck and served-target verification are recorded honestly.

The operator additionally requests plain grouping language. Replace "Subscription responses" with "Subscriptions" while retaining backend endpoint identity. Existing provider-account UX work BI-7AA4EB6B owns form changes. The operator authorized coordination; its owner received the evidence. Do not edit its claimed form files without a supported handoff. Existing upper-panel shared-auth link is verified in source; the failing result must explicitly direct the operator to it.

## Sequence and traceability

One atomic recovery deliverable, key `connection-recovery`, mapped to BI-C4FCC089; no internal phase is independently delivered as a complete repair. References: requirement `AC-1`, contract `oauth-owner-isolation`, flow `expired-token-single-retry`, verification `expired-token-regressions`.

1. Add regression cases in `apps/web/lib/actions/ai-providers.test.ts`: successful renewal, refresh rejection, repeated 401, unrelated 401/429 and explicit account ownership. Run them against the old source and preserve the observed failure. Resolve graph-linked tests for both claimed source paths, expanding verification when advice is absent.
2. Extract a reusable local probe closure inside `provider-auth-test.ts` so both attempts share request construction and completion validation. Only a parsed 401 error.code exactly equal to token_expired starts refresh. Default ChatGPT renews Codex; explicit accounts keep their own identity. Return an actionable reconnect message on renewal failure or repeated token expiry. No refresh for quota or generic authentication errors. Keep capacity clearing and activation after proven completion only.
3. Update grouping and grouping tests to "Subscriptions". Coordinate form recovery with BI-7AA4EB6B; record its delivered source and served evidence before claiming the full acceptance criteria.
4. Run affected action/account/OAuth/grouping tests and web/test typechecks. Run style-drift guard, doc index generation/check, exact-tree pregate and semantic publication review. The Workroom impact contract requires related-test lookup, style-drift and exact-tree verification. Inspect immutable review findings and pr:health before queue merge.
5. Deploy only through governed canonical release/self-upgrade, then verify authentication and recovery on the served target. The current live connection test requires approval cmv7e9ejz02yv01qszshw5ehx. It remains unrun until approved; a denied action must not be routed through browser/shell.

## Risks and rollback

Refresh rotates secrets, so the existing account boundary must retain ownership and concurrency protections. An unrelated 401 must not consume a refresh grant. Retry count is strictly one. A successful HTTP response without a completed inference is still a failed check. Undo the PR to restore prior source behavior; never reset credentials or edit installed runtime assets. Source checks do not establish live recovery.

## Backlog coverage

Atomic rationale: renewal, bounded verification and operator recovery are one connection repair; neither a new heading nor a retry alone completes the requested outcome. The peer form deliverable is already mapped to BI-7AA4EB6B and is a coordination dependency, not duplicated scope. Record governed immutable plan coverage before implementation; receipt is pending.
