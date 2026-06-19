# Hive Contribution Architecture & the Public-Egress Boundary

**Date:** 2026-06-19
**Status:** Research synthesis + design refinement for Private/Public Change Segregation (epic EP-1A78BAE1).
**Builds on:** [`2026-06-18-local-git-and-private-public-segregation-analysis.md`](2026-06-18-local-git-and-private-public-segregation-analysis.md), [`2026-06-18-private-public-change-segregation-design.md`](2026-06-18-private-public-change-segregation-design.md).
**Goal it serves:** make segregation work with **no new container/resource overhead**, keep **Build Studio + external (Claude/Codex)** paths working, hide complexity from users, and be robust + well-architected.

---

## 1. The hive is a lightweight git+ledger mechanism — zero new infra

The "hive mind" is **not a service**. It is:
- **Destination:** the public GitHub upstream repo named by `PlatformDevConfig.upstreamRemoteUrl` (default `OpenDigitalProductFactory/opendigitalproductfactory`).
- **Auth:** a GitHub PAT resolved by `resolveHiveToken()` (`identity-privacy.ts:211`) from `HIVE_CONTRIBUTION_TOKEN` env → encrypted `CredentialEntry(providerId="hive-contribution")` → `GITHUB_TOKEN` → `git-backup` cred.
- **Identity:** a pseudonymous per-install agent `dpf-agent-<shortId>` / `agent-<shortId>@hive.dpf` derived from `clientId` (`getPlatformIdentity()`); real identity stays in local Postgres only.
- **Outbound:** `createBranchAndPR()` → `api.github.com`. **Inbound:** self-upgrade git merge (code+schema+wiki), the scheduled hive-scout DB ingest (`run_hive_scout_ingest`), and in-process MCP tools.
- **Ledger:** `FeaturePack`, `ImprovementProposal.contributionStatus` (`"local"`→`"contributed"`), `HiveContributionLedger` — all rows in the existing Postgres.

**Footprint verdict:** the entire contribution path is in-process in the `portal` container + GitHub API + existing Postgres. **No hive container, no sidecar, no new service.** The "no added overhead" constraint is satisfied by construction, and the private-home decision from the analysis doc (bare git remote, optional Gitea, never bundle GitLab CE) is consistent with this.

## 2. Build Studio vs external paths — where they converge

| | Build Studio (in-portal) | External (Claude/Codex via MCP) |
|---|---|---|
| Diff extraction | `deploy_feature` → `FeatureBuild.diffPatch` | same |
| Substrate | `FeatureBuild` | same |
| Ship/contribute tool | `create_portal_pr` | `contribute_to_hive` |
| Outbound call | `createBranchAndPR(shareableDiff)` | `createBranchAndPR(shareableDiff)` |
| Extra steps | `runPrePRGates`, auto-merge | `runContributionReview` |

**Convergence:** both populate `FeatureBuild.diffPatch` via `deploy_feature`, and both reach `createBranchAndPR`. Increment 1 already placed private-paths stripping in **both** plus `submitBuildAsPR` — so the three egress chokepoints are covered. **Governance-approves-evidence-not-provenance (AGENTS.md §17) holds:** the boundary reads the diff + target, never which surface produced it.

## 3. The real architectural fix: the boundary is the *target's publicness*, not the tool

`create_portal_pr` resolves its target from the **local git remote first, then falls back to `upstreamRemoteUrl`** (`mcp-tools.ts:10427-10448`). So its target's publicness **varies at runtime**:
- Maintainer dev box → resolves to the public upstream (intended platform-contribution path).
- Customer install with their own remote → their own repo.
- Customer install with no remote → **silently falls back to the public upstream**.

Two consequences make a tool-keyed boundary wrong:
1. **Stripping toward a customer's own repo loses proprietary code** — their repo is the rightful *home* for everything, private included.
2. **The silent public fallback is a latent leak** — a customer who never opted into public contribution could push proprietary work to the public repo.

**Principle:** *The private/public boundary applies only at PUBLIC-HIVE egress.* A diff going to the install's own repo (private home / `dpf/install` / a private remote) is unfiltered — it holds everything. A diff going to the public upstream hive is gated by disposition + private-paths stripping.

### 3.1 This mirrors the EXISTING knowledge-segregation pattern (reuse, don't invent)
DPF already segregates *knowledge* with a kernel + org-overlay model (`WikiPage`):
- **Kernel row** (`organizationId=NULL`, `isKernel=true`) = global/public. **Org overlay** (`organizationId=SET`, `kernelPageId→`) = proprietary/local, shadows the kernel.
- Retrieval is two-pass: org-scoped first, kernel fallback with masking. `principlePublic` flags a principle as shareable. `ImprovementProposal.contributionStatus` already marks `local` vs `contributed`.
- **Pure DB scoping + retrieval precedence. No new infra.**

The code segregation is the same shape:
| Knowledge | Code (this program) |
|---|---|
| Org-overlay WikiPage (proprietary) | Customer's own repo / `dpf/install` branch (proprietary home) |
| Kernel WikiPage (public) | Public upstream hive |
| `principlePublic` flag | `FeatureBuild.disposition` (`private`\|`shareable`) |
| Two-pass retrieval masking | Self-upgrade merge of upstream into `dpf/install` |
| `contributionStatus` local→contributed | `FeaturePack`/proposal contribution state |

So the well-architected answer is **not new machinery** — it is: (a) a per-change disposition equivalent to `principlePublic`, (b) a public-egress classifier that decides when the boundary applies, (c) the existing `dpf/install` branch as the proprietary home. All DB + git + in-process; zero new containers.

## 4. The public-egress classifier (increment 2, first step)

Add one helper: `classifyEgress(repoOwner, repoName)` → `"public-hive" | "own-repo"`, deciding by whether the target matches `upstreamRemoteUrl`'s owner/repo (or the canonical `OpenDigitalProductFactory` default).

- `contribute_to_hive` → always `public-hive` (by definition) → apply disposition gate + private-paths strip.
- `create_portal_pr` / `submitBuildAsPR` → classify the resolved target:
  - `own-repo` → **no strip, no disposition gate** (full diff to the customer's home).
  - `public-hive` → apply disposition gate + strip (and never silently fall back to public — require explicit shareable).

This **corrects increment 1's unconditional strip in `create_portal_pr`** (harmless today only because the manifest ships empty) and closes the silent-public-fallback leak. Build Studio shipping to its own/portal repo is unaffected; external hive contribution is gated.

## 5. Disposition gate without breaking the paths (increment 2)

- `FeatureBuild.disposition` defaults `private` (fail-closed) — but the gate **only fires at `public-hive` egress** (§4). Build Studio shipping to its own repo never hits it, so the BS path keeps working unchanged.
- A setter is needed so a change can be marked `shareable`. Cheapest robust mechanism: a `set_change_disposition(disposition, reason)` MCP tool (in-process, write-scope) callable by coworker/operator — no UI dependency. The plain-language ship UI (increment 3) becomes presentation over this, not a prerequisite.
- `PrivatePathRule` DB overrides merge with the `.dpf/private-paths` manifest (the loader already tolerates the table's absence).

## 6. Hiding complexity (AGENTS.md §17)

- Default experience: change is private; nothing reaches the public hive unless explicitly shared. No git vocabulary — "Keep on my system" / "Share with the community."
- The egress classifier, disposition, and private-paths plumbing are backstage. Operator-grade controls (private-paths editor, remote config) are admin-only.
- The local-changes ledger answers "what have we kept private?" in plain language over the `dpf/install` not-in-upstream commits.

## 7. Net

- **No new infra** — confirmed; the hive is git+API+Postgres in the existing portal container.
- **Both paths keep working** — boundary keys off target publicness; BS→own-repo is unfiltered, external→hive is gated; provenance-blind per §17.
- **Robust & reuses substrate** — code segregation mirrors the proven knowledge kernel/org-overlay pattern; disposition ≈ `principlePublic`; `dpf/install` is the proprietary home.
- **Next implementation step:** the public-egress classifier (§4) — corrects increment 1 and is the foundation for the disposition gate (§5).
