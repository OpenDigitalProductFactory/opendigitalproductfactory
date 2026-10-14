---
status: active
---

# Provider account capacity refactoring

Implementation detail for BI-385C0357 / WC-4B3D81BC under the approved
[multi-account design](../specs/2026-10-04-provider-multi-account-design.md)
and [delivery plan](2026-10-04-provider-multi-account.md). The original independent
plan review recovered on Task606 with receipt
initiative-96b2ff91-c99b-4f4b-aec8-a6c94ab07cd9. This document does not assert that
routing, migrations, or served acceptance are complete.

## Existing owners and required changes

ProviderCapacityStatus.providerId and CliPoolStatus.adapterType are unique
legacy aliases. AiProviderConnection already owns credentials and a capacity
relationship. These existing projection tables remain the capacity owners;
there is no second account registry or gateway.

- Retain nullable unique legacy aliases so existing provider-only callers keep
  their behavior. Add nullable unique scopeKey identities for account and
  upstream-pool observations, with a safe legacy-row backfill.
- The existing account capacity relationship carries account-local restrictions.
  Add an optional quota relationship to the same capacity table. Multiple
  connections can share the same proven upstream pool; neither credentials nor
  commercial/trust evidence moves with that relationship. Index both account
  references. Preserve existing rows and relations during migration.
- Account authentication and model-access failures cannot disable the provider
  or retire a shared catalog profile. Provider outages remain provider scoped.
- A verified upstream account identity yields a namespaced hashed pool identity.
  Unsupported or unknown upstream ownership shares a conservative provider pool.
  Separate credential rows alone do not prove separate quota. Pool identifiers
  never contain tokens or external account identifiers.
- CliPoolStatus retains weekly/reset/source timestamps. Additional pool rows
  use a typed adapter kind and scope identity; their legacy alias is null.
  Capacity readers and writers share one scope resolver.
- Record the actual selected connection and pool in existing route/attempt/usage
  evidence. Keep shared provider billing distinct from account attribution.

## Execution and continuity

Candidates retain the shared model-profile identity and add explicit account
identity. Verify account model access, lifecycle, data terms, sensitivity,
workload, region, context and tools before balancing capacity. Account approval
does not weaken an explicit provider denial. Legacy provider-only ambiguity
protection remains available to callers without an account selection.

API dispatch resolves only the selected owned credential and rechecks account
lifecycle and version. CLI invocations have private configuration/authentication
directories and staged secrets. Only supported channels with tested isolation
may join pooled dispatch. Cleanup must follow the owned child's settlement;
uncertain native tool side effects refuse automatic replay or account handoff.
Affinity is a preference among eligible accounts, never a permission override.

Claude's private directory follows the documented
[CLAUDE_CONFIG_DIR contract](https://code.claude.com/docs/en/env-vars).
Codex's [documented authentication storage](https://learn.chatgpt.com/docs/auth)
stores file credentials under CODEX_HOME. Inference explicitly selects file
storage in its private home, so a shared operating-system keyring cannot supply
another account. API keys and subscription grants retain their own billing and
data-handling basis. Catalog transport already uses isolated CODEX_HOME.

## Verification and rollout

Run account-policy, credential/dispatch, shared-pool, concurrent private-home,
expired-evidence, disabled-account and ambiguous-replay fixtures. Schema and
usage relationships require independent review before migration application.
Run affected package typechecks and the governed integration gate; migration
fixtures use a leased database. Record skipped or inconclusive checks accurately.
The user's Local-provider pause remains untouched.

Installed sandbox capability checks on 2026-10-14 observed Codex CLI 0.157.0
and Claude Code 2.1.282. Two concurrent offline Codex login-status invocations
read their distinct fake API keys from private CODEX_HOME file stores; neither
reported the other's key. Two concurrent Claude auth-status invocations used
private CLAUDE_CONFIG_DIR directories and reported the isolated OAuth-token
environment mode. Every fixture directory was removed after child settlement.
These governed command observations establish installed authentication-channel
support, not upstream authentication, independent quota or paid inference.
The source supervisor fixtures separately exercise concurrent child lifetime,
timeout settlement and cleanup. Known Codex and Anthropic subscription channels
may enter routing only with the selected account's verified model access.

Credential decryption now lives in the existing account boundary, retaining the
legacy export. Its single row read checks the routed metadata revision before
decryption; renewal rebuilds stale selection instead of silently substituting
replacement credentials. Capacity links also compare credential revisions.
Provider-managed response IDs require their originating account; otherwise the
saved messages supply task continuity. Uncertain native results stop fallback
and task redispatch, including serialized errors, until existing effects are
inspected. Consumer-channel quota aliases share a conservative budget without
claiming shared authentication lineage.

Rollback excludes additional execution candidates while retaining account,
credential, pool and usage history. It does not restore singleton constraints
over additional rows or erase recorded observations.

## Stable capacity projection correction
The live catalog had no lifecycle declaration for ProviderCapacityStatus or CliPoolStatus. The earlier inherited-retention assumption is superseded. New health rows are stable per immutable account row, unique by ownedAccountId, and removed with that account; credential refresh updates the same current-state row. Legacy provider observations remain unchanged, and immutable TokenUsage/RouteOutcome attribution survives account deletion. CLI quota scopes are bounded by configured provider/adapter pairs and remain conservative where upstream quota ownership is unknown.

Before any account-origin health or shared-quota write, a short database transaction locks the exact active account and its credential, checks the captured encrypted-storage revision, then upserts and attaches the observation. Same-timestamp credential replacement is fenced by a one-way fingerprint of encrypted storage. No network work runs while these locks are held. The projection ignores observations whose credential revision is obsolete. This follows the coordinator's independent platform/data architecture recommendation; advisory kernel insufficient-signal interactions are not claimed as approval or autonomous proceed verdicts.

Immutable account attribution uses `recordedProviderConnectionRef` in TokenUsage
and RouteOutcome. It records the selected connection at execution and intentionally
has no live foreign key. The safe rename migration retains all values, historical
NULLs and indexes; old migration checksums stay unchanged. The execution selection
contract still calls its selected account `providerConnectionId`.

The compact account overview must consume the same revision-valid capacity
projection as routing. Retain its safe recovery summary, action and human-action
flag while excluding raw upstream snippets and credential storage. Additional
accounts show their own current sign-in, billing or model-access restriction;
shared provider quotas and reset times remain explicitly shared. Unknown
independent allowance stays unknown. Integrate the overview consumer after the
qualified compact UI is merged, rather than maintaining a second health registry.
