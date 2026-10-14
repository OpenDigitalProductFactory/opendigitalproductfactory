---
status: active
---

# Provider account capacity refactoring

## Acceptance repairs after the first UI release

The served 390px provider table extended to 558px and clipped account actions.
The existing report-kit DataTable now offers an opt-in responsive mode: one
semantic table reflows into compact rows below the desktop breakpoint, retains
every field/action, and exposes native keyboard sorting controls. Its default
callers keep their existing layout. Untouched optional local engines remain in
the searchable catalogue after setup; bundled Local and configured engines stay
visible. This follows the recorded compact-disclosure choice DI-BE29BCA0E998.

Dimension history uses the persisted results.dimensions discriminator for its
0–100 score scale; legacy scenarios keep 0–5. Runs without probes omit the
misleading zero-of-zero failure indicator. Queued evaluation/test acknowledgements
direct operators to Test Runs rather than presenting a stale running state;
timer-driven route refresh is removed under the existing observation contract.
No historical records are rewritten and no paid evaluation is needed to verify
these repairs. Regression tests first reproduced both history defects, then all
six history/model-card cases passed. The three account/table suites passed 26
cases. These source results do not assert served phone, theme or role acceptance.

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

Credential decryption and bearer-token exchange now live in the existing account
boundary, retaining the legacy exports from provider internals. Its single row read checks the routed metadata revision before
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
independent allowance stays unknown. The consumer now follows the merged compact
UI, with shared-limit labels, account-specific recovery actions, and an optional
capacity-read failure notice that preserves connection management. API key
recovery points to connection settings; OAuth recovery points to sign-in.

Bearer cache reuse requires an `ok` credential; a future stored expiry does not
override an expired status. Explicit initial workload authentication retains the
captured unconfigured account state until verification activates it. Its token
write compares that account's status and revision along with the encrypted
credential snapshot, and disabled accounts cannot start the exchange. Guarded
OAuth renewal and decoded expiry still require the qualified shared service API;
these source-local corrections alone do not prove that integration or deployment.

Selected-account renewal consumes the qualified shared service's fourth guard
argument with raw encrypted storage and the captured owner, including organization.
The shared parser checks decoded JWT expiry and subscription identity. A rejected
upstream token forces renewal rather than returning a cached token. Caller
cancellation stops dispatch; ownership drift rebuilds selection; temporary renewal
failure preserves configuration, records a scoped failure and tries an eligible
sibling. The shared service's availability correction must be qualified and
merged before this consumer receives final integration evidence.

The overview may request current health for inactive accounts so a genuine
reauthentication failure remains visible after setup is required. This option
changes presentation only: routing's default projection, account eligibility,
credential revision checks and disabled-account veto remain in force.

Client-credentials exchange also checks the captured owner immediately before
HTTP, then locks and rechecks that owner before saving a finite, nonempty token.
Cancellation rolls back the write; network work stays outside the transaction.
Credential-exchange failures carry the owning connection on the existing
inference-error contract so they cannot degrade a shared model or cool down a
healthy sibling. Source race tests do not replace real database qualification.

The isolated PostgreSQL workload-token fixture exercises the production helper
through real Prisma transactions: initial verification without enabling the
account, disable during HTTP, unchanged-timestamp credential replacement, and
concurrent owner-lock contention. It accepts only an explicit test database or
the governed CI database and cleans up its generated schema. Host execution
without that database is skipped, not evidence of database qualification.

## Executed integration and host prerequisites

The shared PostgreSQL run at source `538bf29ec5f8` executed all six workload/OAuth
composition cases and all three migration cases successfully. The containing
full gate `cmv809mlw0a8a01pcivkk2sz5` failed elsewhere; those nine results are
specific database evidence, not a passing full gate or live migration apply.

The exhaustive run found stale discovery mocks after the credential-boundary
refactor and an old three-argument quota assertion. Fixtures now model absent
legacy default connections, use the decrypted credential boundary for workspace
headers, and retain the unscoped legacy pool explicitly. The affected 69 cases
and both typecheck programs passed after these alignments.

On this Windows host, literal `sh` and POSIX `mkdir` were absent from the process
PATH although the official Git for Windows binaries were installed. Use verified
Git `bin` and `usr/bin` directories in the gate's process environment; do not
change global PATH or substitute scripts. The legacy bootstrap fixture now uses
the existing shared promotion-test hang budget: its measured 38-second run
exceeded its old 30-second budget. The targeted Git-clone and legacy bootstrap
suites passed all 16 cases after the environment and budget corrections. Preserve
the earlier failures and obtain a new exact-tree full gate before publication.
