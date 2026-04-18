# Pseudonymous Contribution Identity & Backlog → Issue Bridge Design

| Field | Value |
|-------|-------|
| **Epic** | EP-HIVE-GOVERNANCE-001 (new) |
| **IT4IT Alignment** | §5.4 Deploy (contribution identity), §5.2 Request (backlog → issue routing for non-Build-Studio users) |
| **Depends On** | Phase 1 identity-privacy decisions (2026-04-15), Contribution Mode & Git Integration spec (2026-04-01), `PlatformDevConfig` singleton, `PlatformIssueReport` / `BacklogItem` / `Epic` models |
| **Supersedes** | Decision 6 default in `docs/superpowers/plans/2026-04-15-phase1-identity-privacy-decisions.md` — the anonymous default becomes pseudonymous |
| **Status** | Draft |
| **Created** | 2026-04-18 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

## Problem Statement

Two gaps in the current hive contribution model:

1. **Default identity collapses all contributors into one indistinguishable blob.** Phase 1 sets the public author name to the literal string `dpf-agent` across every install ([identity-privacy.ts:48](apps/web/lib/integrate/identity-privacy.ts#L48)), so GitHub's PR/commit UI groups every install's contributions under a single name. The per-install discriminator exists only in the email (`agent-<hash>@hive.dpf`), which GitHub does not display in contributor lists. Consequence: the community and project team cannot recognize repeat contributors, thread replies to "the same person," or build reputation over time — all core requirements for a healthy open contribution ecosystem.

2. **Users who don't run Build Studio have no path to the project team.** Today a backlog item (`BacklogItem`, `Epic`) or a captured platform issue (`PlatformIssueReport`) lives only in the local DB. If a user identifies a bug or feature request but doesn't want the AI Coworker to build it themselves — or can't, because it requires upstream attention — there is no mechanism to escalate the item as a GitHub Issue on the community repo. The contribution pipeline covers *code* (PRs via `contribute_to_hive`) but not *intent* (issues/requests).

## Design

### Part A: Pseudonymous default identity

The platform uses **pseudonymous** identity for public git operations by default. Every install carries a stable per-install discriminator that is visible in all public-facing metadata — author name, commit messages, PR bodies, and (see Part B) issue titles. The discriminator reveals nothing about the real user, hostname, or organization, but is consistent across all contributions from one install.

#### Identity format

| Surface | Before (Phase 1 default) | After (this spec) |
|---------|--------------------------|-------------------|
| Author name | `dpf-agent` | `dpf-agent-<shortId>` |
| Author email | `agent-<shortId>@hive.dpf` | `agent-<shortId>@hive.dpf` (unchanged) |
| DCO signoff | `Signed-off-by: dpf-agent <agent-xxx@hive.dpf>` | `Signed-off-by: dpf-agent-<shortId> <agent-<shortId>@hive.dpf>` |
| Branch name | `dpf/<shortId>/<slug>` | `dpf/<shortId>/<slug>` (unchanged) |

`<shortId>` is the first 8 characters of the 16-char SHA256 hash already stored in `PlatformDevConfig.gitAgentEmail` (`agent-<hash>@hive.dpf`). The author name becomes `dpf-agent-<first 8 of hash>` so name and email visibly share the same discriminator. Extraction is done in [identity-privacy.ts](apps/web/lib/integrate/identity-privacy.ts) via a local helper that splits the email local-part; we deliberately do *not* re-hash the `clientId` here to keep the email as the single source of truth for the pseudonym.

Branch names (`generatePrivateBranchName`) continue to use the first 8 chars of the raw `clientId` UUID for backwards-compat with existing branches. That is a routing-layer artifact, not the public pseudonym.

#### Three identity modes (replaces Phase 1 Decision 6)

| Mode | Default? | Author name | Token source | Wizard steps | Who sees what |
|------|----------|-------------|--------------|--------------|---------------|
| `pseudonymous` | yes (was "anonymous") | `dpf-agent-<shortId>` | Hive token (provisioned by platform owner) | 2 (explain, DCO) | Community sees stable pseudonym; real identity never leaves local DB |
| `attributed` | opt-in | Customer-supplied org name | Customer's own GitHub PAT | 4 (explain, account, token, DCO) | Community sees real org; full attribution |
| `private` (existing `fork_only`) | opt-in | Customer's own git identity in their own repo | Customer's own PAT (if any) | 0 (optional backup URL) | Nothing reaches upstream |

The deprecated term "anonymous" is retired because it was misleading — the system was already pseudonymous at the email layer and this spec just completes the consistency.

#### Required code changes

**`apps/web/lib/integrate/identity-privacy.ts`**

- `getPlatformIdentity()` now derives `authorName` from the stored `gitAgentEmail`:

  ```ts
  const shortId = deriveShortIdFromEmail(config.gitAgentEmail); // 8-char hash prefix
  const authorName = `dpf-agent-${shortId}`;
  _cached = {
    authorName,
    authorEmail: config.gitAgentEmail,
    clientId: config.clientId,
    shortId,
    dcoSignoff: `Signed-off-by: ${authorName} <${config.gitAgentEmail}>`,
  };
  ```

- Module-level comment rewritten: "pseudonymous identity — stable per-install discriminator, no personal information."
- New helper: `getDisplayPseudonym(): Promise<string>` returning `dpf-agent-<shortId>` — used by Part B and any UI that renders the install's public handle.
- New `PlatformIdentity.shortId` field exposes the derived 8-char hash prefix for callers that want it without re-parsing the email.

**`apps/web/components/admin/PlatformDevelopmentForm.tsx`**

- DCO step shows the pseudonym that will be used: *"Your contributions will appear on the community repository as `dpf-agent-a1b2c3d4`. This pseudonym is stable across all your contributions so the community can recognize repeat contributors, but reveals nothing about you."*
- "Anonymous" wording in copy (line 319, line 42) replaced with "pseudonymous" + the one-line explanation above.
- Dead wizard steps (`github-account`, `create-token`, `paste-token`) stay dormant; they will be re-wired as the `attributed` opt-in path in the Phase 2 attributed-identity work tracked in the Phase 1 plan — this spec does not implement that toggle, only leaves the space for it.

**`apps/web/lib/mcp-tools.ts` (`contribute_to_hive`)**

- No logic change — it already calls `getPlatformIdentity()`. The new author-name format propagates automatically.

**`packages/db/src/seed-platform-dev.ts`** (wherever `gitAgentEmail` is seeded)

- No change. `clientId` and `gitAgentEmail` are already established on first boot; the name is now a pure derivation.

#### Migration

No migration required. No schema changes. Existing installs already have `clientId` populated; on next deploy, `getPlatformIdentity()` returns the new author name and the cache self-refreshes. For installs that have already pushed contributions under `dpf-agent`, future pushes will appear under `dpf-agent-<shortId>` — the old commits stay as-is (git history is immutable and we are not rewriting). The project team will see a one-time transition where a contributor "splits" from the collective `dpf-agent` into per-install pseudonyms. This is desired.

### Part B: Backlog → GitHub Issue bridge

Non-Build-Studio users need a path to the project team. A `BacklogItem`, `Epic`, or `PlatformIssueReport` can be **escalated upstream** as a GitHub Issue on the community repo, authored under the install's pseudonym (Part A) and gated on the same contribution mode as code PRs.

#### Data model additions

```prisma
model BacklogItem {
  // ... existing fields ...
  upstreamIssueNumber Int?
  upstreamIssueUrl    String?
  upstreamSyncedAt    DateTime?
}

model Epic {
  // ... existing fields ...
  upstreamIssueNumber Int?
  upstreamIssueUrl    String?
  upstreamSyncedAt    DateTime?
}

model PlatformIssueReport {
  // ... existing fields ...
  upstreamIssueNumber Int?
  upstreamIssueUrl    String?
  upstreamSyncedAt    DateTime?
}
```

All three rows gain the same three fields. `upstreamIssueNumber` is the canonical GitHub issue number; `upstreamIssueUrl` is the cached link for UI; `upstreamSyncedAt` is last successful sync. One migration, one timestamped dir under `packages/db/prisma/migrations/`.

#### New module: `apps/web/lib/integrate/issue-bridge.ts`

```ts
export async function escalateToUpstreamIssue(input: {
  kind: "backlog" | "epic" | "issue-report";
  id: string;
  mode: "ask" | "auto";          // from caller context
}): Promise<
  | { status: "created"; issueNumber: number; url: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string }
>
```

Responsibilities:

1. Load the source row (`BacklogItem` | `Epic` | `PlatformIssueReport`) and its relevant context (route, severity, error stack for issue reports).
2. Read `PlatformDevConfig.contributionMode` — skip with `reason: "fork_only"` if set to `fork_only` and return early.
3. Read `identityMode` (default pseudonymous) and resolve pseudonym via `getDisplayPseudonym()`.
4. Render the issue body using a Markdown template (see below) and title prefixed with the pseudonym.
5. Resolve the hive token via `resolveHiveToken()` (already exists).
6. POST to `https://api.github.com/repos/{owner}/{repo}/issues` using the GitHub REST API.
7. On success, store `upstreamIssueNumber`, `upstreamIssueUrl`, `upstreamSyncedAt`.
8. On failure, log and return `failed` with a user-visible error (timeout, 401, rate limit).

#### Issue body template

````markdown
## Summary
{title}

## Reported by
Install: `dpf-agent-{shortId}` — the pseudonym above is stable across all issues and PRs from this install.

## Type
{backlog-item | epic | platform-issue-report}
Severity: {severity}
Route: {routeContext or "unknown"}

## Details
{body or description}

{if issue-report:}
## Error context

```text
{errorStack}
```

User agent: {userAgent}
{/if}

---
*Filed via Digital Product Factory. Contributor privacy: real identity stays on the local install; the pseudonym above is the public contact handle.*
````

#### Routing: when is an item escalated?

| Source | `fork_only` | `selective` | `contribute_all` |
|--------|-------------|-------------|------------------|
| `BacklogItem` (user-created) | never | user-prompted in UI | auto-escalate if severity ≥ medium |
| `Epic` (user-created) | never | user-prompted in UI | user-prompted (epics always get confirmation — higher blast radius) |
| `PlatformIssueReport` (error/crash report) | never | auto-escalate for severity `high`/`critical`; prompt for `low`/`medium` | auto-escalate for all severities |

"User-prompted" means a button appears in the UI reading *"Report this to the project team."* Clicking it calls `escalateToUpstreamIssue({ mode: "ask" })`.

#### UI additions

- **Admin > Backlog (`/admin/backlog` or wherever the list lives)**: each row gains a "Report upstream" action for items without an `upstreamIssueNumber`; rows with one show a linked badge `#123 ↗` that opens the GitHub issue.
- **Admin > Platform Health** (where `PlatformIssueReport` is surfaced): same pattern.
- **Coworker-originated items**: when an agent files a `BacklogItem` via `backlog_file_item` MCP tool, the tool's output includes a suggestion to escalate if the item originated from a user conversation and severity is high. The decision stays with the user.

#### What this spec does NOT cover

- **Bidirectional sync** (pulling issue comments/status back into the local backlog) — deferred. One-way push covers the non-Build-Studio user's need; pulling is a separate design problem with webhook and auth implications.
- **Deduplication across installs** — two installs reporting the same bug will create two issues. Deferred. The project team can close one as a duplicate of the other; automated matching is a follow-on.
- **Issue updates after creation** — the initial POST is fire-and-forget. If the backlog item title or body changes locally, the upstream issue is not updated. Deferred; a simple "resync" button can be added later if it turns out to matter.

## Security and privacy

- Issue body is run through `redactHostnames()` (already in [identity-privacy.ts:85](apps/web/lib/integrate/identity-privacy.ts#L85)) before POST, defensively catching any hostname that leaks through the route context or error stack.
- `PlatformIssueReport.errorStack` is reviewed for secret patterns (existing `security-scan.ts` rules) before escalation. If a potential secret is detected, escalation is blocked and the user is told to sanitize the stack before retrying.
- `reportedById` on `PlatformIssueReport` is NEVER sent upstream. Only the install-level pseudonym appears.
- The hive token used for POST has only `Issues: Read and write` scope on the upstream repo — add this to the scope list in Phase 1 Decision 2's token provisioning. No read access to other repos, no user-level permissions.

## Rollout

1. Part A identity change ships independently — it is a pure derivation change with no schema impact and no user-visible wizard change beyond a copy update. Smoke test: run `contribute_to_hive` on a dev install, confirm the PR author on `markdbodman/opendigitalproductfactory` shows `dpf-agent-<shortId>` not `dpf-agent`.
2. Part B ships after: migration, `issue-bridge.ts`, UI buttons. Can be feature-flagged via a `enableUpstreamIssueBridge` column on `PlatformDevConfig` if a cautious rollout is preferred.
3. Documentation: update [docs/user-guide/development-workspace.md](docs/user-guide/development-workspace.md) and the contribution-mode spec from 2026-04-01 to reflect the pseudonymous default. Update the `contribute_to_hive` tool description in [mcp-tools.ts](apps/web/lib/mcp-tools.ts) to mention the pseudonym appears in PR metadata.

## Open questions

1. Should the displayed pseudonym be the raw `dpf-agent-<shortId>` or something more human-memorable (animal-adjective style, e.g., `dpf-clever-otter-a1b2`)? Memorable names aid recognition but add code and a tiny collision risk. Recommendation: start with the raw form; revisit if community feedback asks for it.
2. For `attributed` mode (Phase 2), should issues also use the attributed identity, or stay pseudonymous? Recommendation: match the mode — if a user chose to attribute code, they probably want attribution on issues too. Deferred to the Phase 2 attributed-track spec.
3. Should `Epic` escalation always require user confirmation even in `contribute_all`? The table above says yes because epics are large and their scope may not match upstream priorities. Mark to confirm.
