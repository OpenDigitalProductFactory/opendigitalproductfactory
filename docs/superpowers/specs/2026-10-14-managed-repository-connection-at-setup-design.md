---
status: draft
---

# Managed repository connection at setup — Design Spec

| Field | Value |
|-------|-------|
| **Backlog** | `BI-985F4EC9`; operating outcome `BI-FD40397B` AC-1/AC-3 |
| **Status** | Draft — operator-directed 2026-10-14, awaiting independent review |
| **Created** | 2026-10-14 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Extends** | [GitHub auth / 2FA readiness](2026-04-24-github-auth-2fa-readiness-design.md) (device flow) · [Ecosystem issue intake and arbitration](2026-09-16-ecosystem-issue-intake-and-arbitration-design.md) §6.1 (controller commissioning) · [Public contribution mode](2026-04-23-public-contribution-mode-design.md) |
| **Supersedes** | Nothing. The device flow, credential encryption, setup step and attention nudge already exist; this spec gives them a managed-repository purpose. |
| **Out of scope** | GitHub App installation tokens (§7, deferred) · non-GitHub forges · changing the hive contribution login · the controller fencing predicate itself (owned by §6.1 / `BI-FD40397B`) |
| **Primary goal** | An install that manages git repositories says which ones during setup, and the operator logs in to them once, through the platform, with a status that shows per repository whether the login actually works. |

---

## 1. Problem

Operator direction, 2026-10-14: installs that manage git repositories need a way
to log in to those repositories, and initial setup should identify them. This operator install was set up before
this existed and was configured by hand; future installs need it as part of
setup.

### 1.1 Measured in code

Read from the tree at `origin/main` `a10257dbe81`, not inferred.

| # | Finding | Evidence |
|---|---|---|
| 1 | No setup step asks which repositories the install manages. The only forge touchpoint is the `platform-development` step, framed as "contribution and governance mode". | `apps/web/lib/actions/setup-constants.ts:6-33`; `apps/web/components/setup/SetupOverlay.tsx:42` |
| 2 | The managed repository is a singleton URL that no operator can set; it is only ever written as the hardcoded DPF URL, and the reader silently falls back to a hardcoded repository when it is empty. | `PlatformDevConfig.upstreamRemoteUrl` (`packages/db/prisma/schema/ops-telemetry.prisma:427`); `apps/web/lib/actions/platform-dev-config.ts:508,515`; `apps/web/lib/contributor-change-lanes/github-rest-reader.ts:217-227` |
| 3 | GitHub login exists only for hive contribution. The device flow requests `public_repo`, so it cannot reach a private repository, and stores the token in `CredentialEntry[hive-contribution]`. | `apps/web/lib/actions/github-device-flow.ts:52,107-118`; `apps/web/lib/build/github-oauth.ts` |
| 4 | Token resolution is install-global and never checked against a specific repository. `github-pr-sync` is first in the chain but nothing writes it. | `apps/web/lib/contributor-change-lanes/github-rest-reader.ts:163-214` |
| 5 | The operating intent has no repository field, and its spec forbids credentials in the intent. | `packages/db/src/installation-operating-intent.ts:66-80`; purpose-aware installation spec :582 |
| 6 | A purpose-aware nudge already prompts `evolve-dpf` installs to connect GitHub. | `apps/web/lib/attention/sources/contribution-setup.ts:34-48` |

Consequence: §6.1 of the intake design requires commissioning to use an explicit
repository and refuse the fallback, but there is no supported way for an operator
to provide one or a credential scoped to it.

## 2. Research

### 2.1 Comparable implementations

| Implementation | How it identifies repositories | How it authenticates | Adopt / reject |
|---|---|---|---|
| GitHub CLI (`gh auth login`) | Per command; the host is configured once | OAuth device authorization grant (RFC 8628); token stored per host; `gh auth status` reports scopes and validity | **Adopt** the device flow and an explicit status readback. Already the platform's primary path. |
| Renovate / Dependabot onboarding | Repository selection at install time ("all" or "only selected repositories") | GitHub App installation with fine-grained permissions; short-lived installation tokens | **Adopt** explicit repository selection at setup. **Defer** the GitHub App (§7): it needs an app registration per publisher and a private key the operator would have to supply. |
| Backstage GitHub integration | Configured integration per host plus discovered locations | GitHub App (recommended) or personal access token in config | **Reject** config-file credentials: DPF credentials are entered through the platform and encrypted at rest, never in files. |

### 2.2 Standards followed

- OAuth 2.0 Device Authorization Grant, RFC 8628 — already implemented
  (`github-oauth.ts`).
- GitHub OAuth App scopes: `public_repo` grants public repository access only;
  private repositories require `repo`. GitHub recommends least privilege, so the
  requested scope follows the managed repositories' visibility rather than
  always requesting `repo`.
- Repository access check: `GET /repos/{owner}/{repo}` returns 404 for a
  repository the token cannot see and a `permissions` object for one it can.

### 2.3 What DPF adopts and rejects

Adopt: explicit repository selection during setup; device-flow login reused with
a purpose; a dedicated encrypted credential slot; per-repository verification
with a truthful status. Reject: config-file or environment credentials as the
primary path; storing credentials or repositories in the operating intent; a new
settings page or credential store; requesting `repo` scope when every managed
repository is public.

## 3. Design

### 3.1 When it applies

A repository-managing install is one whose confirmed operating intent has
`evolve-dpf` as its primary purpose or as a declared secondary purpose. An
install that operates an organisation can also own platform repository
follow-through (kernel decision DI-A6148958CADB, 2026-10-21). Other installs see
no new step. An archetype-level declaration is
not added in this slice: the need follows the install's purpose, not its
business archetype, and the capability registry is storefront-oriented. If a
business archetype later manages customer repositories, it adds a
`source-repository` capability with a `setupPrompt` in
`packages/storefront-templates/src/capability-registry.ts` and reuses §3.2–3.4.

### 3.2 Repository selection

The existing `platform-development` setup step (`/admin/platform-development`)
gains a **Managed repository** section for repository-managing installs:

- The operator enters a GitHub repository URL or `owner/name`. It is parsed with
  the existing `parseGitHubRepositoryUrl` (`apps/web/lib/forge/github-adapter.ts:58`)
  and saved to `PlatformDevConfig.upstreamRemoteUrl` through the existing
  `savePlatformDevConfig` writer (gated by `manage_platform`).
- The field is pre-filled with the DPF upstream repository as a suggestion, never
  saved implicitly. Until the operator saves, the controller stays
  `not commissioned` (§6.1).
- Additional repositories are commissioned through their own standing Workroom
  (`Workroom.repositoryFullName`, intake design §6.1). This slice stores the
  primary repository only; the status list in §3.4 is per repository so a second
  repository adds a row, not a new screen.

The step can be skipped with an explicit **Not now**. Skipping leaves the
controller visibly uncommissioned and the existing attention nudge stays open;
setup does not block on it.

### 3.3 Login

- **Device flow with a purpose.** `initiateDeviceFlow` accepts a purpose,
  `hive-contribution` (default, unchanged) or `repository-controller`. The purpose
  is recorded server-side on the `DeviceCodeSession` row (one additive nullable
  column, `purpose`), so the token is routed to the slot chosen at initiation,
  not by whichever poll the browser calls.
- **Scope.** `repository-controller` requests `public_repo` when every managed
  repository is public and `repo` when any is private or unknown. Visibility is
  read with an unauthenticated `GET /repos/{owner}/{repo}`; a 404 is treated as
  private.
- **Slot.** The token is encrypted with the existing `encryptSecret` and stored
  in `CredentialEntry[github-repository-controller]`. It never enters the
  operating intent, logs, backlog, Workroom or attention payloads.
- **Resolution.** The issue reader and controller resolve
  `github-repository-controller` first, then fall back to the existing chain for
  installs that predate this spec. Hive contribution keeps `hive-contribution`.
- **Advanced paste** remains available behind the existing
  `AdvancedTokenPaste` disclosure for operators who cannot use the device flow;
  it writes the same slot and runs the same verification.

### 3.4 Verification and status

After login, and on each page load (cached for five minutes), the platform checks
each managed repository with `GET /repos/{owner}/{repo}` using the stored
credential and shows one status per repository:

| Status | Condition |
|---|---|
| Connected | 200 and `permissions.pull` true; for the controller, `permissions.triage` or higher so it can label and comment |
| Read only | 200 but below the controller's needed permission |
| No access | 404 or 403 with the credential |
| Login expired | 401 |
| Not connected | No credential in the slot |
| Couldn't check | Network or rate-limit failure; shows the time of the last successful check |

The status never renders the token, its prefix or its scopes beyond their names.

### 3.5 Commissioning link

The controller commissioning predicate (§6.1) uses the explicit
`upstreamRemoteUrl` and refuses the hardcoded fallback. This spec supplies the
operator path to set it and a credential that can read it. A repository whose
status is not **Connected** cannot be commissioned; the refusal names the status.

## 4. UX

- One section on the existing page, placed above the contribution settings for
  repository-managing installs and hidden for other purposes.
- First viewport: repository, status chip, one primary action (**Connect GitHub**
  or **Check again**). Scope details and the advanced paste sit behind
  progressive disclosure.
- The device code is shown large with a copy button and the GitHub URL; polling
  progress is announced with `aria-live="polite"`.
- Theme-aware tokens only; keyboard reachable; works at 375 px width; empty,
  error and expired states each say what to do next.

## 5. Data

One additive nullable column, `DeviceCodeSession.purpose`, with a migration. No
new model. `CredentialEntry` gains no columns; the new slot is a new `providerId`
value. `PlatformDevConfig.upstreamRemoteUrl` is reused.

## 6. Acceptance

- AC-1 A fresh install with confirmed `evolve-dpf` as primary or secondary purpose sees the Managed
  repository section in the platform-development setup step; saving records an
  explicit `upstreamRemoteUrl`; **Not now** leaves the controller uncommissioned
  and the nudge open.
- AC-2 Device-flow login started for `repository-controller` stores an encrypted
  credential only in `CredentialEntry[github-repository-controller]`; a
  contribution login is unchanged.
- AC-3 The status shows each managed repository's condition per §3.4 and never
  renders a credential.
- AC-4 The intake reader and commissioning use the explicit repository and the
  dedicated credential; the hardcoded fallback is refused for commissioning.
- AC-5 Existing installs complete the same section later; an already-verified
  connection is not re-asked.
- AC-6 Keyboard, 375 px, light and dark themes, and error/empty/expired states
  verified on the served portal.

## 7. Deferred: GitHub App

A GitHub App gives per-repository installation, fine-grained permissions and
short-lived tokens, and is the better long-term model for an organization
managing several repositories. It requires a published app registration and a
private key held by the install. Revisit when an install manages repositories
across more than one organization or when the operator asks for per-repository
least privilege beyond OAuth scopes.

## 8. Implementation order

1. `DeviceCodeSession.purpose` migration and purpose-aware initiate/poll with
   slot routing; unit tests for routing and that contribution is unchanged.
2. Scope selection from repository visibility; verification helper returning the
   §3.4 statuses; unit tests per status.
3. Resolver change: `github-repository-controller` first for the intake reader.
4. Managed repository section on `/admin/platform-development` with save,
   connect, status and **Not now**; presenter tests; served-portal UX check.
5. Attention nudge reads the new status so it closes when connected.
