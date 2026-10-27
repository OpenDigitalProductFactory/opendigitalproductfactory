---
title: Provision development tool access during DEV setup
status: draft
author: Mark Bodman
date: 2026-10-26
backlog:
  - BI-5ED1C819
---

# Provision development tool access during DEV setup

## Request and objectives

The owner requests a setup step that adjusts credentials for the tools needed
when an installation is identified as DEV. The current connection can repair
source but cannot hand work to the release owner: the canonical external role
omits `thread_write`, and direct release/deployment grants are also absent.

OBJ-DEV-1: A platform administrator can complete DEV access setup once, using
one visible profile choice, instead of discovering missing grants mid-delivery.
OBJ-DEV-2: The configured role, approved credential scope and effective access
are reported separately; a saved profile must not masquerade as a verified client.
OBJ-DEV-3: Production and unresolved identity retain their existing defaults;
operator revocations, human capabilities, consent and action gates remain binding.

## Research and existing substrate

Research base: f607ddab1bf on origin/main, October 26, 2026. Verify the full
immutable commit when recording the research receipt.

- `packages/db/src/coworker-grants.ts` projects canonical external profiles
  from `packages/db/data/agent_registry.json`; the profile deliberately omits
  deployment and administration authority. Changing that registry globally
  would also change production and is outside this request.
- `packages/db/src/seed-agent-tool-grants.ts` honors durable revocation rows
  and does not overwrite unresolved alias authority. Reuse those invariants.
- `apps/web/lib/actions/installation-operating-intent.ts` confirms identity
  through a capability-gated impact preview. `install/environment-class.ts`
  resolves effective identity; a form value and NODE_ENV are not authority.
- `apps/web/lib/tak/coworker-tool-grant-core.ts` owns validated grant mutation,
  durable revocation and the self-target prohibition. Its ordinary human grant
  path clears revocation intentionally; automated setup must never call it in
  a way that resurrects an explicit removal.
- `apps/web/lib/auth/oauth-scope-map.ts` already partitions scopes. Handoffs
  need dpf.work; release/deployment need dpf.operate; administration needs
  dpf.admin. Existing consent and owned-client issuance preserve exact
  human/client/assistant/resource identity and cannot silently widen a token.
- `apps/web/lib/actions/setup-constants.ts` and the existing setup projection
  own onboarding steps. The workspace identity panel is the correction surface
  for installations that have already completed onboarding.

Related delivered work BI-516F63F7 documents source-owned credential setup;
it does not provision more grants. BI-B22C8E02 classifies authorized maintenance;
it does not widen roles or OAuth consent. This feature supplies the missing
provisioning step and does not duplicate either mechanism.

## Architecture decision

Extend the existing setup, grant and consent mechanisms with an approved DEV
access profile. Do not expand the global external-agent floor and do not add a
runtime exemption that treats the DEV label as permission. The owner requested
DEV setup, which selects this bounded approach. Kernel advisory DI-EE1983F707E0
returned insufficient scoring signal; it is not claimed as a recommendation.

The profile is one versioned constant, projected into setup copy, preview,
provisioning and diagnostics. Initial eligible identities are only the existing
canonical AGT-EXT-CLAUDE, AGT-EXT-CODEX and AGT-EXT-GROK. Slug mirrors are never
additional authority owners. Existing generic grants are retained.

The candidate additional delivery/maintenance grants are:

- thread_write
- release_plan_create and release_gate_create
- deployment_plan_create and iac_execute
- admin_read and admin_write
- agent_control_read

The security review must validate this exact set against the intended DEV
workflows. No independent initiative-approval grant, business/financial write,
clearance expansion or production-peer grant is included. Self-target grant
changes and author/reviewer separation retain their existing enforcement.
No wildcard, all-tools switch or dynamically inferred grant vocabulary is used.

## Setup and operator experience

Add a development-access step to the existing setup flow, linked to the actual
workspace identity surface. Offer it only when the effective environment is
resolved development and the operating identity is confirmed. It is selected
by default for a DEV setup, but applying authority is the administrator's
explicit setup confirmation, not a passive environment read.

Lead with outcome: "Development access" and "Let your development assistants
build, coordinate releases and maintain this DEV installation." One primary
action, "Enable development access", previews and applies the versioned profile.
Keep exact grants and scope details behind disclosure. Use existing semantic
controls, theme variables, status badges and accessible result messages.

Display one of: not configured, ready for new connections, reconnect required,
restricted by saved revocations, or unavailable. Never show "ready" merely
because role rows were written. Existing DEV installs see the same step on the
workspace identity surface; no second repair command or credential editor.
Skipping setup is explicit and does not claim access was provisioned.

Changing or deconfirming identity previews the access consequence along with
existing identity effects. A shadowed DEV declaration cannot enable the profile.
Production, test and missing/invalid context do not receive this DEV profile.

## Authority, provenance and lifecycle

A server action requires manage_platform and an administrator identity context.
It binds preview to the current effective environment, confirmation, profile
version, canonical target identities and current grant/revocation snapshot.
Any change requires a fresh preview. A client cannot submit arbitrary grants,
agent IDs or credential values. The action is human setup administration and is
not exposed as a self-granting MCP tool.

Use existing AuthorityBinding records for approved installation-profile intent
and audit attribution. Add nullable provenance from AgentToolGrant to that
existing binding, if needed, so profile-owned grants can be distinguished from
manual/seed grants without a new authority table or overloaded grantedBy value.
Existing grants remain unowned by the profile and are never adopted silently.
Manual re-grant detaches profile ownership through the shared grant mutation;
manual revoke leaves its durable tombstone. Profile reconciliation skips all
revocations and unresolved alias assertions.

Provision in one serializable transaction: revalidate snapshot, persist the
approval/binding, create missing unrevoked grants and record attribution. Repeat
is a no-op. Reconciliation and identity transitions remove only profile-owned
rows when eligibility ends, retaining manually granted authority and tombstones.
On boot, reconcile this approved profile before serving tools. Incomplete or
unreadable reconciliation cannot expose stale DEV-managed grants as production
authority; shared authorization readers must honor profile eligibility and
binding status. Direct grant readers at delegation and credential issuance must
use that same effective-authority projection. A failed reconciliation is an
explicit not-ready state, never a silent successful install.

No token, refresh token or client secret is edited or printed. Existing token
scopes remain exactly what was approved. New DEV connection setup requests the
profile's public scopes visibly through existing OAuth consent. An existing
connection missing scopes returns reconnect/consent-required; refresh cannot
add them. Source-owned headless credentials stay bound to the same verified
assistant and owner and are capped by the parent approval. Disabling or changing
DEV access must not make an old token a shortcut around the current role check.

## Acceptance

AC-DEV-1 (OBJ-DEV-1): Confirmed effective DEV plus an authorized administrator
can preview and apply the approved profile to the three canonical identities.
AC-DEV-2 (OBJ-DEV-3): Production, test, unknown, unconfirmed, shadowed DEV,
unauthorized callers and stale previews cannot enable it.
AC-DEV-3 (OBJ-DEV-3): Explicit revocations, unresolved alias decisions and
manual grants survive repeated setup; automatic grants have removable provenance.
AC-DEV-4 (OBJ-DEV-2): Existing credentials are never silently widened or rotated;
missing consent scopes yield a supported reconnect result.
AC-DEV-5 (OBJ-DEV-3): Leaving DEV, disabling the profile or losing readable
eligibility removes effective profile-owned authority before tools execute.
AC-DEV-6 (OBJ-DEV-1): The first-run step and existing-install correction use the
same service and show a clear accessible outcome with exact details disclosed.
AC-DEV-7 (OBJ-DEV-2): Verification proves representative handoff, build, release
and DEV-upgrade admission with an approved new connection, and proves denied
controls for saved restrictive consent and the paired production installation.

## Delivery sequence and verification

One feature delivery owns the profile, provenance, provisioning, credential
integration, setup UI and functional verification. Those are internal phases,
not independently shippable capabilities: partial provisioning that reports
success without credential admission would repeat this incident class.

1. Obtain independent design, architecture, security, data and UX assessment
   against this immutable design before implementation; record the scope baseline.
2. Write an immutable implementation plan with four-way acceptance traceability
   and record atomic backlog coverage for BI-5ED1C819.
3. Add failing behavior tests for eligibility, snapshot races, revocations,
   provenance/downgrade and saved-consent scope limits. Implement the shared
   profile and grant projection before wiring UI or issuance.
4. Add additive nullable provenance migration with existing-data-safe semantics,
   classification/retention declarations and drift checks. Preserve old rows.
5. Wire the existing setup projection and workspace correction; test supported
   new and existing DEV paths plus production absence and accessibility.
6. Run affected tests and both web typecheck programs, migration verification,
   shared integration and served UI verification. Independent code assessment,
   DCO-signed PR, protected merge queue, canonical release and DEV verification
   remain required. Do not apply live self-grants from this source worktree.

The shared profile/projection and grant-mutator refactor is the refactoring
allocation. Preserve existing API and consent contracts rather than copying
credential-writing logic into the installer.
