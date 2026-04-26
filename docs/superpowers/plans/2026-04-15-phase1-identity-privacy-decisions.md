# Phase 1: Identity Privacy + Contribution Model Decisions

Date: 2026-04-15
Status: Implemented (code) + Decided (architecture)

> **Amendment 2026-04-18:** Decision 6's "anonymous default" was reversed. The default identity track is now **pseudonymous** — every install carries a stable per-install discriminator (`dpf-agent-<shortId>`) visible in author name, DCO signoff, and issue/PR metadata. The `<shortId>` is the first 8 chars of the SHA256 hash already present in `gitAgentEmail` (`agent-<16-char-hash>@hive.dpf`), so name and email visibly share the same discriminator. Rationale and the full updated identity table live in [docs/superpowers/specs/2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md](../specs/2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md). The "attributed" opt-in track described in Decision 6 is unchanged and still planned for Phase 2. The term "anonymous" is retired across the codebase to avoid the misleading "all installs look identical" implication.

---

## What was built

### Code changes (committed)

| File | Change |
|------|--------|
| `install-dpf.ps1` | Branch name uses `dpf/<8-char-sha256-hash>` from a GUID, persisted to `.dpf-instance-id`. Replaces `install/$env:COMPUTERNAME` which leaked the machine name. |
| `.gitignore` | Added `.host-profile.json`, `.dpf-instance-id`, `.admin-credentials` |
| `apps/web/lib/integrate/identity-privacy.ts` | **New.** `getPlatformIdentity()` returns anonymous `dpf-agent <agent-xxx@hive.dpf>`. `detectHostnameLeaks()` / `redactHostnames()` for defensive scanning. `generatePrivateBranchName()` for upstream branch naming. |
| `apps/web/lib/mcp-tools.ts` | `contribute_to_hive` now uses `getPlatformIdentity()` instead of real user email/name for DCO, commit author, and PR body. |
| `apps/web/lib/integrate/contribution-pipeline.ts` | Added `redactHostnames()` as defensive safety net in `generateCommitMessage()` and `generatePRBody()`. |
| `apps/web/components/admin/PlatformDevelopmentForm.tsx` | DCO text now references Apache License 2.0 explicitly and confirms contributions are anonymous. |

### Identity leak audit results

| Source | Status |
|--------|--------|
| `install-dpf.ps1` branch naming | **Fixed** — uses instance ID hash |
| `contribute_to_hive` DCO/commit | **Fixed** — uses platform identity |
| `contribution-pipeline.ts` PR body/commit | **Fixed** — defensive redaction |
| Host discovery collector (`host.ts`) | **Safe** — data stays in local CMDB, no export path to git |
| `git-utils.ts` `formatCommitMessage` | **Safe** — `approvedBy` is a CUID, local-only |
| `build-branch.ts` | **Already correct** — uses `dpf-agent` identity |
| `promote.sh` | **Already correct** — uses build ID, no identity references |

---

## Architecture decisions

### Decision 1: Direct branch push to upstream (Option B)

**Context:** Three options for how hive mind contributions reach the upstream repo:
- Option A: Shared community fork (`dpf-hive/opendigitalproductfactory`)
- Option B: Direct branch push to upstream (`OpenDigitalProductFactory/opendigitalproductfactory`)
- Option C: Cross-fork from customer's own fork (current)

**Decision:** Option B as the primary path. Option A as a future evolution.

**Rationale:**
- Cross-fork (Option C) leaks the customer's GitHub org name in the PR (`acme-corp:branch → main`)
- Direct push with anonymous branch names (`dpf/<hash>/<slug>`) reveals nothing about the customer
- Mark controls the upstream repo, so issuing a write token is straightforward
- Branch namespace collision is prevented by the `clientId` hash (UUID → SHA256 → 8 chars = ~4B namespace)
- `fork_only` mode is unaffected — those customers push to their own repo with their own identity

**What this means for the code:**
- `selective`/`contribute_all` modes use `createBranchAndPR()` on the upstream repo (not `createCrossForkPR()`)
- `gitRemoteUrl` is used ONLY for `fork_only` backup
- `upstreamRemoteUrl` is the target for all hive contributions
- `createCrossForkPR()` stays in the codebase for Option A (shared org fork) if needed later

### Decision 2: Hive token provisioned by platform owner, not by each customer

**Context:** The current wizard asks every contributing customer to create their own GitHub PAT. This is a 5-step process involving GitHub settings, scope selection, and token creation. Most DPF customers are NOT developers.

**Decision:** The hive contribution token is provisioned by Mark (the platform owner) and distributed to installs automatically. Customers never touch GitHub.

**How it works:**

1. Maintainer creates a fine-grained PAT on their account scoped to `OpenDigitalProductFactory/opendigitalproductfactory` with `Contents: Read and write` + `Pull requests: Read and write`
2. This token is set as `HIVE_CONTRIBUTION_TOKEN` in the environment (docker-compose.yml or a registration endpoint)
3. The seed stores it in `CredentialEntry` with `providerId: "hive-contribution"`
4. When a customer selects `selective` or `contribute_all` and accepts the DCO, the platform uses this pre-provisioned token
5. The customer never creates a GitHub account, never creates a token, never sees GitHub

**Wizard simplification (Phase 2 work):**

Current (4 steps):
1. Explain what sharing is
2. "Do you have a GitHub account?"
3. "Create a personal access token with repo scope"
4. Accept DCO

New (2 steps):
1. Explain what sharing is
2. Accept DCO → Done

**Fork-only mode is unchanged:** Customers who choose "Keep everything here" can optionally configure their own backup repo + token. This IS their responsibility since it's their private repo.

### Decision 3: License is Apache-2.0, DCO is sufficient

**Context:** The repo already has Apache-2.0 at `LICENSE`. Apache-2.0 Section 5 states that any Contribution submitted for inclusion is automatically under the same license.

**Decision:** No additional CLA needed. DCO + Apache-2.0 is the legal framework.

**Implications:**
- Hive mind contributions are Apache-2.0 inbound = outbound
- Customers can keep `fork_only` customizations proprietary (Apache-2.0 Section 4 allows this)
- Mark's US patent (progressive disclosure) is protected by Section 3 (patent license applies only to contributors' own claims)
- The DCO text in the wizard now explicitly references Apache License 2.0

### Decision 4: Install time does NOT determine contribution mode

**Context:** Should the install script ask about contribution preference?

**Decision:** No. Contribution mode is configured post-install in Admin > Platform Development.

**Rationale:**
- At install time, the database doesn't exist — `PlatformDevConfig` can't be written
- The user hasn't used the platform yet — they can't make an informed choice
- The mode can change later — a customer might start private and switch to contributing
- The install script correctly determines only infrastructure (customizer vs. consumer)
- The `install-dpf.ps1` script already says: "That choice will be configured in the portal during setup"

### Decision 5: Public repo doesn't change the architecture

**Context:** The repo is currently private. When it goes public, does the PAT/contribution model need to change?

**Decision:** No architectural change needed.

**Rationale:**
- Public repos still require write access for branch creation — the hive token is needed regardless
- The anonymous identity model works identically on public and private repos
- Going public enables the attributed contributor track (see Decision 6) — but this is additive, not a replacement
- The Apache-2.0 license is already public-ready

### Decision 6: Anonymous is the default, but attribution is an opt-in choice

**Context:** Anonymity protects customers who don't know or don't care about identity. But partners, consulting firms, and enterprises who deploy DPF for many customers may actively WANT their name on contributions — it's a marketing asset and a signal of ecosystem investment.

**Decision:** Two identity modes for contributing installs. Anonymous is the default.

**anonymous (default):**

- Identity: `dpf-agent <agent-xxx@hive.dpf>`
- Branch: `dpf/<hash>/<slug>` on upstream
- Token: pre-provisioned hive token
- Wizard: 2 steps (explain, DCO)
- Customer never touches GitHub

**attributed (opt-in):**

- Identity: `"Acme Corp" <contributions@acmecorp.com>` (customer-provided)
- Branch: `partner/<org-slug>/<slug>` on their own fork
- Token: customer's own PAT (current wizard flow)
- Wizard: 4 steps (explain, GitHub account, token, DCO)
- Customer forks the repo openly, PRs show their org name

**Data model addition (Phase 2):**

```
PlatformDevConfig:
  identityMode          String    @default("anonymous")  // "anonymous" | "attributed"
  contributorOrgName    String?   // Display name for attributed mode
  contributorEmail      String?   // Contact email for attributed mode
```

**UI addition (Phase 2):**

After selecting `selective` or `contribute_all`, a sub-choice:

- "Anonymous" (default) — no further setup beyond DCO
- "Identified" — enter org name + email, then current GitHub wizard flow

**Phase 1 impact:** None. The code defaults to anonymous. Attributed is additive.

---

## Contribution mode topology (reference)

```
fork_only (private mode)
  ├── Customer's own repo (gitRemoteUrl)
  ├── Customer's own PAT (git-backup credential)
  ├── Direct push: HEAD:main
  ├── No DCO, no upstream PR
  └── Customer identity: visible in their own repo (fine — it's theirs)

selective / contribute_all (hive mode)
  ├── Upstream repo (upstreamRemoteUrl = OpenDigitalProductFactory/opendigitalproductfactory)
  ├── Hive token (hive-contribution credential, provisioned by platform owner)
  ├── Branch: dpf/<clientId-hash>/<feature-slug>
  ├── PR: same-repo branch → main
  ├── DCO: Signed-off-by: dpf-agent <agent-xxx@hive.dpf>
  ├── Commit author: dpf-agent (AI Coworker)
  └── Customer identity: completely anonymous
```

---

## What's next (Phase 2+)

1. **Wizard simplification** — Remove GitHub account + token steps for anonymous contributing mode. Use pre-provisioned hive token. Two-step wizard: explain, DCO.
2. **Hive token provisioning** — Add `HIVE_CONTRIBUTION_TOKEN` env var, seed logic, and `hive-contribution` credential provider.
3. **Simplify contribution code path** — Always use `createBranchAndPR()` on upstream for anonymous hive contributions. Remove cross-fork as the default path.
4. **Attributed contributor track** — Add `identityMode` to `PlatformDevConfig`. Add identity sub-choice to contribution wizard. Keep current GitHub wizard flow for attributed mode.
5. **Pre-PR security gates** — Extend `security-scan.ts` with backdoor detection, architecture compliance, dependency audit.
6. **`mergePR()` + merge workflow** — Add GitHub API merge function, auto-merge on gate pass, lifecycle status updates.
7. **ReviewPanel UX** — Verification summaries, file list view, manual test steps.
