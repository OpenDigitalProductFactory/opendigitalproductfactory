# Plan: end one person's access under a shared AI-client registration

- Backlog item: BI-0A724798 (epic EP-31815F97)
- Spec: [2026-10-01-oauth-per-person-revoke-design.md](../specs/2026-10-01-oauth-per-person-revoke-design.md)
- Workroom: WC-9304762D, branch `feat/oauth-per-person-revoke`
- Date: 2026-10-01

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Definition of done

The spec's AC-1 to AC-4, proven on the live install: admin@dpf.local's grants under Claude Code registration `dpfoc_ee5e9c49750e4d3f9c5141caca25e1cb` are revoked with a recorded reason, and the operator's grants under the same registration stay live.

## Phase 1: domain function and tests

- **Deliverable:** `apps/web/lib/auth/oauth-client-people.ts` with `revokeClientPersonGrants` and `listClientPeople`, taking an injected Prisma subset.
- **Behaviour:** revoke every unrevoked `McpApiToken` and `OAuthRefreshToken` for (client row, user) in one `$transaction`, stamping `revokedAt` and `revokedReason = "operator_revoked_person: <reason> (by <operator email>)"`. Refuse the caller's own user id, a blank reason, a reason over 500 characters, and an unknown client. The list groups live and recently revoked (30 days) tokens by person, bounded to 200 people, caller first.
- **Tests (red first):** `apps/web/lib/auth/oauth-client-people.test.ts`:
  - shared-client isolation: the other person's tokens and the same person's tokens under another client stay live;
  - attribution: the reason and operator are recorded;
  - self-protection;
  - the blank-reason and unknown-client refusals;
  - the listing.
- **Verification:** `pnpm --filter web exec vitest run lib/auth/oauth-client-people.test.ts`, with a mutation check (drop the `userId` filter and confirm the isolation test fails).

## Phase 2: server actions

- **Deliverable:** `listOAuthClientPeople` and `revokeOAuthClientPersonGrants` in `apps/web/lib/actions/oauth-clients.ts`, both behind the existing `requireOperator()` (`manage_provider_connections`). That gate is the non-operator refusal for AC-3. The actor carries the operator's email for attribution. `revalidatePath` runs on success.
- **Verification:** `pnpm --filter web typecheck`. The gate is the same function the whole-client revoke already uses, so this phase adds no new auth path.

## Phase 3: screen

- **Deliverable:** `apps/web/components/admin/OAuthClientPeople.tsx`, opened by a "People" button on each active, non-credentials client row in `McpOAuthClientManager.tsx`. Credentials (headless) clients belong to no person, so they get no People control.
- **Behaviour:** a `DataTable` of people with live-grant count, last use and status (Connected / Expired / "Revoked <time>: <reason>"). The caller's row reads "You". Every other person with live grants gets a danger button. It opens `promptDialog` (the reason-taking sibling of `confirmDialog` in `components/ui/Dialog`), which requires a reason. The result shows in a `Notice`.
- **Verification:** typecheck, lint, and the UX check in phase 5.

## Phase 4: docs and UX fit

- `docs/user-guide/contributing/agent-dev-environments.md`, "Revoke any time" bullet: add that an administrator can end one person's access under a shared client from People without disconnecting anyone else.
- `docs/architecture/mcp-tool-authorization-runbook.md`, the wrong-account paragraph: name the per-person revoke as the administrator's control.
- `docs/ux-fit/2026-10-01-oauth-per-person-revoke.ux-fit.json`: extends the existing surface decision DI-03DA64D1850B. No new route or navigation.

## Phase 5: gate, PR, release, live acceptance

1. Fast local gate: affected vitest, `pnpm --filter web typecheck`, lint. The full build runs in the merge queue.
2. DCO-signed commit, push, and a PR that is ready to merge; merge via `gh pr merge <n> --squash --auto`; `pnpm pr:health <n>`.
3. Advance the live install through `/ops/self-upgrade` only.
4. Live acceptance on the portal: open People on the Claude Code registration and revoke admin@dpf.local with a reason. Confirm the 4 refresh grants are revoked, the operator's grants under the same registration are live, and this session's MCP calls still succeed. Record execution evidence and close BI-0A724798.

## Risks and rollback

- **Blast radius:** the change adds rows to two token tables' existing revocation columns. It has no schema change and no new auth path, and leaves the whole-client revoke untouched. The worst failure is revoking the wrong person's grants. The (client row, user) filter prevents that, and the isolation test pins it.
- **Wrong revocation:** the person reconnects by signing in again. A revoked token is never un-revoked, which follows RFC 7009.
- **Rollback:** revert the squash commit. The data written is ordinary `revokedAt` / `revokedReason` and needs no cleanup.

## Backlog coverage

Pending `record_plan_backlog_coverage`. The decision is atomic: no phase ships on its own. The screen needs the actions, and the actions are the domain function behind a gate.
