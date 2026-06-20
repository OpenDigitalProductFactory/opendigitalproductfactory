# Authenticated Work Attribution & Cross-Install Coordination — Design

- **Date:** 2026-06-20
- **Status:** draft (research + design; operator-driven, 5-caveat elaboration)
- **Author:** Claude Code (operator `/goal` session)
- **Epic:** EP-UNIFIED-TRACKING (extends — this is the identity + coordination spine under the unified inventory)
- **Extends:** [`2026-06-19-unified-build-studio-tracking-all-surfaces-design.md`](2026-06-19-unified-build-studio-tracking-all-surfaces-design.md) (G7 auto-claim, G8 identity), [`2026-06-19-delivery-visibility-and-pr-capture-addendum.md`](2026-06-19-delivery-visibility-and-pr-capture-addendum.md), [`2026-06-19-hive-contribution-architecture-and-egress-model.md`](2026-06-19-hive-contribution-architecture-and-egress-model.md)
- **Related:** the private/public demarcation program ([[project_local_first_demarcation_workflow]]), CADA sovereignty ([[project_cada_cloud_sovereignty]])

---

## 1. Operator intent (the problem, as elaborated)

The operator wants to **see what work is in progress, where it resides, and attribute it to who is doing it with which tool** — and to **stop the systemic orphaned-directory/branch problem**. Across five elaboration turns, the attribution key grew:

1. **AI client matters** — Claude / Codex / Grok give different results; you must know which one did a piece of work.
2. **Multiple humans** on multiple clients — need authenticated, authorized human identity, not a shared actor. Operator asks: *can we use our LDAP capability and trust a domain authority?*
3. **Multi-device, parallel** — the same human runs Claude + Grok + Codex **in parallel on a Mac and on a Windows box**; "where" becomes *which host's filesystem*.
4. **Multiple installations** — separate sovereign installs may unknowingly work the same thing; today the collision surfaces **only at submit to the central git repo** (operator: "the gitlab repository").
5. **Local-first + selective publish** — keep work local, test builds locally before upload; sync only the *decided-shareable* units to the public server — batch, or one PR at a time?

**The unifying problem:** a *trustworthy, authenticated* inventory keyed on `(install × human × host × client × session)` that prevents collisions early — within an install **and across sovereign installs** — and leaves no orphan unowned.

## 2. Substrate map (what already exists — verify-substrate-first)

This is overwhelmingly a **binding + enforcement** problem, not a new-substrate problem.

| Capability | Substrate | State |
| --- | --- | --- |
| Central WIP inventory | `contributor-change-lanes` read-model joins 7 sources (WorkCapsule, RuntimeTarget, leases, git worktree/branch/PR snapshots); dashboard has **"Orphan worktrees"** + **"Stale leases"** tabs | exists; identity thin |
| Within-install work mutex | `claimWorkCapsuleScope` ([work-capsule-store.ts:541](../../apps/web/lib/work-capsules/work-capsule-store.ts)) **throws on overlapping active claim** (`scopeClaims`) | exists; **per-install-DB only** |
| Human identity | `Principal` + `PrincipalAlias{aliasType, aliasValue, issuer}` — `issuer` = the vouching authority | exists; not wired to login |
| Human login | NextAuth (credentials + Google/Apple OAuth) | no LDAP/OIDC-federation/domain-authority binding |
| Host/device identity | `EdgeNode` = `Principal` + `PrincipalAlias(aliasType="edge-node")`, host-attributes side table (`nodeId`, `platform`, `installMode`) | exists; only used for edge deployments, not dev workstations |
| Authorization | `AuthorityBinding` / `AuthorityBindingSubject` / `AuthorityBindingGrant` + `AuthorizationDecisionLog` ([lib/authority/](../../apps/web/lib/authority/bindings.ts)) — subjects→grants over a resource, audited | exists; agent/coworker-scoped |
| MCP actor resolution | bearer token → `(userId, agentId)`; **one shared `DPF_MCP_BEARER_TOKEN`**, `agentId` usually null; **never resolves a Principal** | the core attribution gap |
| Private/public egress | `classifyEgress` → `own-repo` (full diff) vs `public-hive` (redacted via `stripPrivatePathsFromDiff`) | exists; **GitHub-centric** (`parseRepoCoords` matches only `github.com`; assumes configured upstream **is** the public hive) |
| Cross-install signal | `ContributorInventorySnapshot` syncs git-branch/PR from the upstream (~10 min); hive federation = the "cross-install transport" (contributions/fingerprints only) | exists; read-only reconciliation, no WIP claims |
| Orphan prevention | `lease-guard` PreToolUse hook blocks ungoverned servers | **Claude-Code-only** (Codex/Grok bypass); lease expiry is passive TTL, **no active reaper** |

**Net:** every dimension of the five-part key already has a home; the inventory exists; the within-install mutex exists; the private/public boundary exists. What's missing is (a) authenticating the human to a domain authority and resolving a Principal, (b) per-actor identity at the MCP boundary, (c) a **shared** (cross-install) claim plane, (d) remote-role-aware egress, and (e) active orphan reaping.

## 3. The five-dimension key → substrate

`(install × human × host × client × session) → claim on a BI/scope → owns → capsule → lease → worktreePath@host → branch → PR`

| Dimension | Field | Gap |
| --- | --- | --- |
| Human | `Principal` (via domain authority) | authn wiring |
| Host (Mac/Windows) | `EdgeNode` = host-`Principal` | enroll dev workstations |
| Client (Claude/Grok/Codex) | `WorkCapsule.executorKind` / `lease.ownerProvider` | populated, but under one shared token |
| Session (each parallel run) | `lease.ownerSessionId` + `worktreePath` | exists |
| Install (separate sovereign nodes) | — | **the new layer: a shared claim plane** |

## 4. Design

### 4.1 Authenticate the human at a trusted domain authority → Principal (caveat 2)
Wire OIDC / LDAP into the existing Federation/Directory surface → NextAuth → resolve a `Principal` via `PrincipalAlias{issuer=<authority>}`. Keep it **pluggable**: `issuer` already abstracts the authority, so support OIDC *and* LDAP/AD via one Directory-Authority abstraction; each install points at its own. Recommendation: OIDC-first (extends existing OAuth providers, least new code), LDAP/AD for on-prem enterprises.

### 4.2 Per-actor identity at the MCP boundary (caveat 1, 2, 3 — closes G8)
Retire the single shared `DPF_MCP_BEARER_TOKEN`. Mint a **per-`(human × host × client × session)`** credential after the human authenticates; the MCP resolver yields `(humanPrincipal, hostPrincipal, executorKind, session)` instead of `(sharedUserId, null)`. Enroll each dev machine as a host-`Principal` via the `EdgeNode` pattern (the host half then comes "free").

### 4.3 Bind + require at work-start (caveat 1, 3 — closes G7)
Every capsule / lease / branch / worktree is owned by an authenticated actor tuple, **auto-claimed, not voluntary** — "no capsule = no write." `createdByPrincipalId` / `leaseHolderPrincipalId` get populated for real.

### 4.4 Authorization via AuthorityBinding (caveat 2)
Extend `AuthorityBindingSubject` to include the human-Principal (and client), so "may this human, on this client, act on this resource" is an `AuthorizationDecisionLog`'d decision. Result: authn (authority→Principal) + authz (AuthorityBinding→grants) + audit, feeding the inventory.

### 4.5 Cross-install claim plane (caveat 4 — the one genuinely new piece)
Separate installs don't share a DB; the only shared state is the central git repo — which is why collisions surface at submit. **Make the claim earlier and shared, using a sovereign remote as the authority:**
- **Mechanism:** an **atomic, create-only git ref** (`refs/claims/<BI-id>`) on the shared sovereign remote. Git ref-creation is atomic + server-side first-writer-wins; the second install's push is rejected immediately ("already exists") → **collision caught at claim time, not submit.** The ref carries the actor tuple.
- **Wiring:** extend the existing `claimWorkCapsuleScope` to also write/check the shared ref (same claim path, now cross-install-aware); surface peer claims through the existing `ContributorInventorySnapshot` sync. Optional: broadcast claims over the hive federation transport for real-time peer visibility.
- **Sovereignty:** the claim plane lives in the **private-shared** tier (§4.6), never the public server — WIP intentions are not leaked publicly.

### 4.6 Three-tier git topology + remote-role-aware egress (caveat 5)
| Tier | Remote | Fidelity | Sync | Holds |
| --- | --- | --- | --- | --- |
| Local (per machine) | per-install local git | full | — | all work + local build/test (the sovereign default; "test before publish") |
| Private-shared | the fleet's sovereign remote (self-hosted GitLab if present) | full | **batch / continuous** | cross-install coordination, the claim-lock, integration |
| Public | GitHub | **redacted** | **one curated PR at a time** | only decided-shareable units |

Make egress **remote-role-aware**: tag each configured remote `local | private-shared | public` and key redaction off the *role*, not a `github.com` match. This fixes the GitHub-centric `classifyEgress`/`parseRepoCoords` so a sovereign GitLab is treated as full-fidelity private (today it is, but only by accident of the parser not recognising GitLab).

**Sync semantics:** batch/continuous within the sovereign tiers (no redaction — it's all yours); **one curated PR at a time** at the public boundary, because that is where redaction + the shareable decision (2-state contribution model) + provenance live. Batch publishing would undermine the shareable gate and risk leaking private content.

### 4.7 Orphan elimination (caveats 1–4 converge here)
- Extend the `lease-guard` to Codex/Grok (Claude-only today — `BI-6B02FEE5`).
- Add an **active reaper** for expired leases + stale worktrees/branches (today: passive TTL + detection-only tabs).
- With every branch/dir owned by an authenticated tuple, an orphan reads as *"Mark's abandoned Grok session on Mac, worktree X"* — owned, located, auto-reclaimable, and (cross-install) released back into the claim plane.

## 5. Risks
- **Don't leak WIP publicly:** the claim plane must live in the private-shared tier, not on the public server. If the *only* shared remote is public GitHub, a sovereign shared remote (GitLab) is required first — otherwise claims either leak or can't be shared.
- **No shared remote at all:** if installs target *different* remotes, there is no convergence authority — fix that before locking.
- **Identity spoofing pre-authn:** until per-actor authn lands, `executorKind`/`provider` are self-reported; bind to the lease-holder Principal and stop trusting free-text.
- **Graceful degradation:** authn/claim must degrade offline (work proceeds, reconciles later) — never hard-block local editing when the authority/remote is unreachable (honor "work never depends on one surface being healthy").
- **Sovereignty of the domain authority:** the authority is per-install/per-fleet; do not centralize identity outside the install's trust boundary.

## 6. Phasing
- **P1 — make the inventory trustworthy (within-install):** per-actor MCP identity (§4.2) + bind-at-work-start (§4.3) + host enrollment. Kills the shared-token blindness.
- **P2 — authn + authz:** domain-authority → Principal (§4.1) + AuthorityBinding subjects (§4.4).
- **P3 — cross-install claim plane (§4.5):** the atomic-ref lock + `claimWorkCapsuleScope` extension + inventory surfacing. (Requires a designated shared sovereign remote.)
- **P4 — git topology + egress roles (§4.6):** remote-role-aware egress; local/private-shared/public tiers; batch-vs-curated-PR semantics.
- **P5 — orphan reaper + lease-guard parity (§4.7).**

## 7. Backlog (filed into EP-UNIFIED-TRACKING)
See the BIs filed 2026-06-20 (cross-install claim plane; domain-authority authn→Principal; per-actor MCP identity + host enrollment; remote-role-aware 3-tier git egress; active orphan reaper). Cross-links: G7 `BI-636A11B3` (auto-claim), G8 `BI-6357B975` (evidence/identity binding), `BI-6B02FEE5` (lease-guard parity), `BI-5090F4AA` (reseller fleet).

## 8. Open decisions for the operator
- **O1 — the shared sovereign remote:** is there a self-hosted **GitLab** the fleet converges on (→ that's the private-shared tier + claim-plane home), or is GitHub the only shared point (→ claims would need a private channel, since GitHub is public)? The code's configured upstream is GitHub; this must be reconciled.
- **O2 — domain-authority protocol order:** OIDC-first (recommended) with LDAP/AD as the enterprise option, both via the pluggable Directory-Authority abstraction — confirm.
- **O3 — batch vs per-PR at the public boundary:** recommend **one curated PR at a time** (redaction + provenance + shareable gate); confirm acceptable vs a periodic batch.
