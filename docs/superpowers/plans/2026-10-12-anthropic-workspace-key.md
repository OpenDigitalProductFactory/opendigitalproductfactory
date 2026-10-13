# Anthropic organization-scoped API key repair

Backlog: BI-FFC4C94D. Workroom: WC-E0A57942. Delivery: small, atomic repair.
Canonical design: ../specs/2026-10-04-provider-multi-account-design.md, Anthropic workspace binding addendum.

## Objective and acceptance

REQ-WORKSPACE: Save an optional Anthropic workspace ID on the selected account's credential. Organization-scoped identity-linked keys require it; single-workspace keys remain valid without it.
REQ-ISOLATION: Explicit connections never inherit another account's workspace or credential. Clearing the workspace is explicit; omission preserves it.
REQ-UX: Only Anthropic API-key setup shows workspace guidance and the optional workspace field. Display the provider's actionable error without exposing credentials.

## Contract and flow

CONTRACT-HEADER: The authenticated request sends anthropic-workspace-id only for an Anthropic API-key credential with a configured workspace. Anthropic requires a wrkspc_-prefixed workspace ID; reject control characters, malformed IDs and non-Anthropic configuration. Do not overload OAuth scope or commercial contract evidence.
CONTRACT-STORAGE: Extend CredentialEntry with a nullable providerWorkspaceId, exposed as non-secret configuration through the existing client-safe projection and governed MCP configure operation. A nullable additive migration preserves all existing credentials; no credential or clearance is automatically changed.
FLOW-CONNECT: Select organization-scoped key setup, enter workspace ID from Claude Console Settings > Workspaces, save, verify and discover models for that account.
FLOW-EXECUTE: The same workspace header construction serves default and explicit-account discovery, authentication testing, synchronous inference and any applicable async requests. Reuse findProviderCredential's explicit-account boundary.

## Ordered implementation

1. Resolve the overlapping ai-provider-internals.ts scope held by WC-1F5CB5B4 before editing it. Claim exact affected paths, consume changeImpactContract, classify/bootstrap dependency readiness through the managed worktree script.
2. Add nullable credential configuration and validation, update configureProvider and configureProviderAccount, client-safe projections and MCP schema. Write regression tests first for persistence, clearing, invalid values and account isolation.
3. Refactor workspace header construction into one shared, tested provider-specific function. Apply it on all authenticated paths above. About 20% of implementation effort is reserved for consolidation and regression protection rather than unrelated refactors.
4. Add a progressively disclosed Anthropic workspace control and plain-language scope guidance to ProviderDetailForm and the account configuration renderer. Preserve labels, keyboard access, write-only key fields, existing single-workspace behavior and --dpf-* theme tokens. Add a meaningful form-save test and measured UX-fit evidence.
5. Run affected tests and web typecheck, schema/migration checks, gate:context obligations, the governed merged-code gate and served UI verification. Open a DCO-signed merge-ready PR only after required evidence passes.

## Verification

VERIFY-HEADERS: Mock fetch proves the workspace header is present on each relevant request with configured credentials and absent without one, and never crosses account/provider boundaries.
VERIFY-UI: Served Anthropic setup permits organization scope with workspace ID, preserves single-workspace setup and reports validation errors accessibly in light/dark themes.
VERIFY-MIGRATION: Migration applies with pre-existing credentials and nullable values. Configure/test/discover round-trip works on the governed shared runtime.
VERIFY-LIVE: An operator-supplied organization key and workspace produce successful discovery and a minimal real model call after deployment. No key is copied into logs or this plan. If credentials are unavailable, report this check unrun.

## Boundaries and rollback

No WIF, billing-report connector, policy relaxation, credential rotation or new provider registry. New configuration never grants data clearance. Other session's files are untouched until coordination resolves ownership. Roll back the application change while leaving the nullable column in place; clear a saved workspace through supported configuration if needed.

## Research

https://platform.claude.com/docs/en/manage-claude/authentication#select-a-workspace documents the required header and exact missing-header HTTP 400 behavior. Existing DPF account design and credential lookup are the architecture baseline. This is a bounded compatibility repair, not a new identity platform feature.

## Backlog coverage

All internal steps deliver BI-FFC4C94D together. Storage or UI alone cannot deliver a working organization-scoped connection. Governed immutable plan coverage is pending; implementation must wait for its receipt.
