# Private/Public Change Segregation — Phase 1 Design

**Date:** 2026-06-18
**Status:** Draft spec (implementable). Phase 1 of the program scoped in [`2026-06-18-local-git-and-private-public-segregation-analysis.md`](2026-06-18-local-git-and-private-public-segregation-analysis.md).
**Depends on:** governed-upgrade-lifecycle seed merge-base work (§2.3 of that spec) for the seed-reconciliation slice only; the rest stands alone.
**Surface:** contribution pipeline (`apps/web/lib/integrate/`), AI Coworker ship-phase UX, Admin → Platform Development.

---

## 1. Problem

A change a customer chooses *not* to contribute upstream has no structural boundary and no durable home (see analysis §2). Segregation today is a per-build human choice plus secret/hostname redaction on the outbound diff; proprietary business logic can still be selected "share" by mistake, and once a local diff lands it intermingles with merged-upstream commits on `dpf/install` with no way to answer "what have we kept private?"

The majority of users are **non-technical** (AGENTS.md §17). The fix must be **automatic, private-by-default, fail-closed, and free of git vocabulary** in the default UI, with technical controls available only on opt-in.

## 2. Goals / Non-goals

**Goals (Phase 1):**
1. Every change carries an explicit `disposition` (`private` | `shareable`) with a reason, persisted and auditable.
2. Outbound contribution is **fail-closed**: nothing is pushed upstream unless a change is explicitly `shareable` AND passes the existing secret/identity scans.
3. A **declarative proprietary boundary** (`private-paths`) structurally excludes designated paths/features from any upstream diff regardless of disposition.
4. A **local-changes ledger** lets an operator see, in plain language, what is kept private vs shared.
5. Default UX uses plain language ("Keep on my system" / "Share with the community"), never git terms; git/forge controls are admin-gated.

**Non-goals (deferred):**
- The git engine / bundled private remote (analysis Phase 2.2) — separate spec.
- Forge abstraction and GitLab (analysis Phase 2.1 / 3).
- Full seed 3-way merge (depends on `seedContentHash`); Phase 1 only *surfaces* unreconciled seed overrides in the ledger.

## 3. Design

### 3.1 Data model (audit-first — AGENTS.md §11)
Reuse existing models; add the minimum.
- **`FeatureBuild`**: add `disposition String @default("private")` (enum: `private` | `shareable`) + `dispositionReason String?` + `dispositionSetById String?` / `dispositionSetAt DateTime?`. Default-private is the fail-closed posture.
- **`PlatformDevConfig`**: no new columns; `contributionMode` still governs the *default suggestion* the coworker makes, but the per-build `disposition` is the authority and defaults private even in `contribute_all`.
- **Proprietary boundary**: a checked-in manifest `.dpf/private-paths` (gitignore-style globs) plus an optional DB override table `PrivatePathRule { id, pattern, reason, createdById, createdAt }` so an operator can extend it without a code change. The contribution pipeline treats a path matching either source as **never eligible** for an upstream diff.

### 3.2 Contribution pipeline (fail-closed gate)
In `submitBuildAsPR` (`contribution-pipeline.ts`) and the `contribute_to_hive` handler:
1. Resolve `disposition`. If unset → treat as `private` (no upstream push; local apply only).
2. If `shareable`: strip any hunk touching a `private-paths` match **before** the diff is built into a PR; if stripping empties the diff, abort with a plain-language explanation ("This change only affects parts of your system you've marked private").
3. Run existing `scanDiffForSecurityIssues` + `redactHostnames` on the *post-strip* diff.
4. Only then create the PR. A change can never reach `createBranchAndPR` while `private` or while it still contains private-path hunks.

### 3.3 UX — progressive disclosure (AGENTS.md §12 UX-Fit, §17 hide-complexity)
- **Non-technical default** (AI Coworker ship phase): a two-option plain-language control — **"Keep on my system"** (default, selected) vs **"Share with the community"** — with a one-line consequence sentence each. No "branch", "PR", "remote", "merge".
- Choosing "Share" surfaces a short, human review of *what will be shared* (file/feature summary, not a raw diff) and the secret-scan result in plain terms.
- **Technical opt-in** (Admin → Platform Development): the existing `contributionMode`, `upstreamRemoteUrl`, private-remote config, the `private-paths` editor, and the raw diff/PR controls. Surfaced only here.
- **Local-changes ledger** (Upgrade Center): a `report-kit` `DataTable` (per AGENTS.md §12) listing commits on `dpf/install` not in upstream, each tagged `private`/`shareable` with reason, plus a flag for seed overrides not yet reconciled. Plain status badges via `statusColors`, no hardcoded colors.
- UX-Fit-Decision attestation required on the PR (the two-option control is a new user-facing control on the `human_cognitive_load` axis; default view ≤ 5 choices — passes by construction).

## 4. Research & Benchmarking (AGENTS.md §10)

- **GitHub fork visibility model:** a private fork of a public repo stays private; you opt specific branches into PRs. Pattern adopted: *default-private, opt-in-to-share per change*. Anti-pattern rejected: GitHub has no path-level "never leaves" rule — we add `private-paths` to cover proprietary code that must be structurally excluded, not just unpushed.
- **GitLab project visibility (private/internal/public)** + protected paths via CODEOWNERS: confirms a declarative ownership/visibility manifest is the standard shape; we mirror it with `private-paths` rather than per-file ACLs (too heavy for non-technical installs).
- **Inner-source / "upstream-first" patterns (Bloomberg, SAP):** the durable lesson is an explicit *classification gate* deciding what is generally reusable vs org-specific — exactly the `disposition` gate, and it aligns with AGENTS.md §1 "platform improvements flow to the hive; proprietary content stays local."
- **Data-loss-prevention (DLP) default-deny:** classification-driven egress that fails closed is the security-standard posture; adopted for the outbound contribution gate. Rejected anti-pattern: trusting a post-hoc scan as the only barrier (our current state) — scans catch secrets, not proprietary intent.
- **Gitea vs GitLab CE weight** (for the deferred bundled-remote phase): Gitea single-binary ~100–300 MB vs GitLab CE ~4–8 GB informed the analysis-doc decision to default to a bare remote + optional Gitea, never bundle GitLab CE.

## 5. Acceptance criteria

1. A new `FeatureBuild` defaults to `disposition = "private"`; no upstream PR is created unless explicitly set `shareable`.
2. A `shareable` change whose diff touches a `private-paths` match has those hunks stripped before PR creation; an all-private diff is refused with a plain-language message.
3. The AI Coworker ship phase shows the two-option plain-language control with no git vocabulary; the technical controls appear only in Admin → Platform Development.
4. The Upgrade Center ledger lists not-yet-upstreamed commits tagged private/shareable, built from `report-kit` primitives with no hardcoded colors.
5. Unit tests cover: default-private, private-path stripping, all-private refusal, and that `contribute_all` mode still defaults a *new* build to private until explicitly shared.
6. UX-Fit-Decision trailer present on the PR.

## 6. Rollout

Single PR against `main` (one concern): data-model migration + pipeline gate + ledger + ship-phase control. Verify on the canonical local install / shared local-CI sandbox per AGENTS.md §5 (migration apply + `next build` + UX exercise of the two-option control). The git-engine and forge-abstraction phases follow in their own specs.
