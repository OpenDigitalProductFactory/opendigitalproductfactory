# Provider account identity

A provider describes a vendor and its catalog. `AiProviderConnection.connectionId`
identifies an account used to access that provider. Each connection owns one
credential through the existing unique `credentialEntryId` relation. Additional
account credentials have a null `CredentialEntry.providerId`; the legacy unique
provider alias remains available to existing callers.

An explicit account lookup checks the provider and returns only that account's
credential. A missing account or credential never falls back to the default.
Calls without an account identity retain their existing default-provider behavior.

OAuth state binds the callback to the connection. An atomic state claim prevents
two callbacks from exchanging the same authorization code. Account refresh and
disconnect update the owned credential and preserve other accounts. Disabling an
account retains its credentials and evidence. A concurrent authentication check
cannot enable a disabled account.

Replacing credentials or signing in again clears the account's model-access
verification and trust claims. Active compliance proofs for that connection are
superseded, preserving their history. A successful sign-in establishes
authentication; it does not establish data clearance. Additional accounts start
with unknown account class and unreviewed evidence.

A legacy default OAuth exchange applies the same reset. The Codex/ChatGPT
default pair validates both credential owners, supersedes their active proofs,
and replaces both tokens in one transaction before activation derives data
clearance or discovers models. A credential owned by another account refuses
the exchange. Conditional token writes also refuse an owner change after that
validation, including a previously unowned legacy credential. Expected ownership
conflicts roll back and return the existing account-change setup redirect;
unrelated database failures remain failures. Disabled defaults
remain disabled. Routine token renewal and
metadata reconciliation preserve reviewed trust; fresh sign-in requires a new
review even when it retains the same credential row.

Model discovery authenticates with the selected credential and records
`accessibleModelIds` and `modelsVerifiedAt` on its connection. Discovery can add
models to the shared catalog, but absence from one account never retires models
used by another account. A failed discovery preserves the last successful result.

ModelCard output capacity is projected into the existing model profile by one
shared writer policy used by normal profiling, credential-restricted profiling,
and metadata backfill. A provider-reported positive integer that fits the
existing storage type can update `maxOutputTokens`. Missing or invalid evidence
omits the field, preserving a previously known limit. The existing full-admin
fallback and explicit `maxOutputTokens` field locks retain ownership. Existing-row
capacity writes compare the observed source and overrides in the database UPDATE;
an intervening ownership change skips that capacity write. Upsert UPDATE branches
never carry output capacity, protecting rows inserted after the initial read. Normal
profiling also keeps the source marker creation-only so an intervening administrator
insert remains protected on later refreshes. Input and
context capacity policies remain unchanged. Catalog access evidence does not
establish capacity: a model list without numeric bounds leaves those limits
unknown, and limits from another model or execution channel are not substituted.

## Governed controls

The portal server actions and MCP handlers delegate to the same account services.
They retain the `manage_provider_connections` capability and the existing
`agent_control_read` tool grant. Secret inputs are encrypted at rest and marked
for audit redaction. Account read results mask credentials and exclude tokens.

| Tool | Behavior |
| --- | --- |
| `get_provider_accounts` | Returns a bounded account page and continuation cursor. Includes disabled and unconfigured accounts. |
| `manage_provider_account` | Adds, configures, enables, disables, signs in, disconnects, tests, or discovers models for an account. Every operation except add requires `connectionId`. |

The foundation provides account identity and controls. Routing and provider-page
integration follow the approved [multi-account delivery plan](../superpowers/plans/2026-10-04-provider-multi-account.md).
Creating an account alone does not route work to it.

The legacy default connection mirrors authentication and execution channel from
the persisted provider configuration. Registry refresh and owner reconciliation
repair stale defaults without inspecting token contents, enabling disabled
accounts, changing reviewed posture, or reassigning a credential already owned
by another account. Legacy OAuth activation reconciles this default before model
discovery. Explicit account callbacks continue to update only their own account.
Model availability proof is cleared when auth, channel, or the owned credential
changes, and after a fresh legacy OAuth exchange. An unchanged configuration
refresh preserves that proof. A concurrent configuration change refuses the
stale reconciliation rather than restoring old auth with newer model claims.

## Provider UI preservation contract

The compact provider UI must preserve these existing controls when integrating
account identity. This table records destinations for that delivery slice; it
does not assert that the new UI is deployed.

| Existing information or control | Required destination |
| --- | --- |
| Provider identity, readiness, disabled state, missing credentials, quota exhaustion and reset | Persistent provider/account row; failures remain visible. |
| Weekly subscription allocation, blocked phase resolution and model suitability | Account row summary with shared capacity identified once. |
| Account class, data sensitivity, workload, region and trust review | Prominent Allowed work summary; account disclosure opens its governing facts. |
| Training, retention, contract and supporting evidence | Account Allowed work disclosure; preserve warnings and evidence history. |
| Emergency clearance overrides | Explicit governed disclosure with its existing authority and expiry. |
| API key, subscription token and provider-specific warnings | Selected account connection disclosure. |
| OAuth sign-in, expiry, automatic refresh, reconnect and disconnect confirmation | Selected account connection disclosure; callback reopens that account. |
| Grok device sign-in and API key fallback | Preserve both available authentication paths. |
| Z.ai shared-key behavior and optional coding-key override | Preserve the shared credential relationship and its explanation. |
| Client ID, client secret, token endpoint and scope | Advanced connection settings on the selected account. |
| Custom provider endpoint and authentication method | Provider settings and account setup respectively. |
| Enabled model families, discovered models, model diagnostics and profiling | Provider Models disclosure; account access remains distinguishable. |
| Save/readiness pipeline, discovery progress, failures and warnings | Show the action result where the action was performed. |
| Local hardware, installed model management, compute wattage and electricity cost | Local provider disclosures, always discoverable from the overview. |
| Recipes and execution routing profiles | Provider Models and routing disclosures. |
| Cost source, internal usage and finance profile | Usage and cost disclosure with account and shared-pool attribution. |
| Performance and recent route decisions | Diagnostics disclosure with existing filters and detail. |
| CLI pool errors/reset times, agent budget events and recent rejections | Routing operations disclosure; active blockers stay in the overview. |
| Local-only inference guarantee | Persistent routing policy indicator and accessible policy control. |
| Monthly spend by provider/agent and scheduled maintenance | Existing overview disclosures, retaining their controls. |
| Detected services, Tools and Services destination, catalog sync status and coworker help | Preserve their navigation and help actions. |

Collapse optional detail rather than deleting it. A local-only setup completion
must persist independently of account count. Removing the final remote account
must not reopen the full catalog or hide existing disabled accounts.

### Account presentation boundaries

The account overview consumes the masked canonical account read model. Untouched
seed defaults are catalog choices after setup; Local, explicitly added accounts,
saved credentials, reviewed accounts, paused accounts and disconnected accounts
remain discoverable. Disabled configured accounts stay visible. First-run catalog
disclosure follows persisted setup progress, never the number of remote accounts.

Default provider links keep their existing credential-sharing behavior. An
explicit `account` query selects that connection only and must reject a missing
or foreign connection rather than render default credentials. Additional account
connection controls call the existing scoped server actions; account declarations
also submit the selected connection identity. Provider endpoint, model families,
catalog profiles and existing finance diagnostics keep their provider ownership.

A label-only update omits unchanged credential fields so it preserves reviewed
data terms and model access. Secrets remain write-only and clear from the form
after a successful save. Authentication and catalog inventory do not establish
Allowed work; that summary comes from the existing suitability compiler. Missing
model or capacity evidence stays unknown. The global inference policy must show
an unavailable state when its read fails, never imply cloud permission.

These are source integration requirements. Colocated tests exercise account
selection, credential-preserving rename, scoped actions, read-only controls and
disclosure retention; they are not deployed UI or full delivery acceptance proof.

## Migration and verification

The migration attaches an existing default connection only when its credential
is unowned. It preserves credential rows, missing defaults and legacy aliases;
it creates no orphan connection. Rollback must retain additional credentials and
cannot restore the provider column's non-null constraint while they exist.

Source tests cover credential ownership, callback concurrency, scoped refresh,
disconnection, trust reset, account discovery, masked reads, tool pagination and
authorization. The database migration fixtures run only in CI or a leased
nonproduction database and use a transaction with rollback. A skipped fixture is
not migration-apply evidence.
