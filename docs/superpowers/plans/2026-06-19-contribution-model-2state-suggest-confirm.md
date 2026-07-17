# Plan — Contribution Model Refactor: 2 States + Suggest-Then-Confirm

**Date:** 2026-06-19
**Epic:** EP-1A78BAE1 · **BI:** BI-6BAE4748
**Decision:** WWMD-ratified via `principle_decide` (population `external_coding_agent`): `two-state-suggest-confirm` — composite **9.15**, margin **1.11**, confidence **high**, no commandment conflict. Operator-directed ("plan and deliver this").
**Specs:** [private-public-change-segregation-design](../specs/2026-06-18-private-public-change-segregation-design.md), [hive-contribution-architecture-and-egress-model](../specs/2026-06-19-hive-contribution-architecture-and-egress-model.md).
**Surface:** delivered here (Claude Code direct PRs), **not** Build Studio.

## Decision in one line
Collapse `PlatformDevConfig.contributionMode` from `fork_only|selective|contribute_all` → **`private|contributing`**. For `contributing` installs, every shipped change carries a per-change **disposition** (`private|shareable`, fail-closed to private) with an **AI suggestion + human final call**; the suggestion replaces the old static `selective`/`contribute_all` default lean and is computed from signals DPF already produces (sanitization scan, `reusabilityScope`, vertical tagging). The durable local git home makes "keep private" always safe.

## Mapping (old → new)
| Old | New |
|---|---|
| `fork_only` | `private` |
| `selective` | `contributing` (suggestion defaults conservative) |
| `contribute_all` | `contributing` (suggestion may lean share; human still confirms) |

## Data model
- `PlatformDevConfig.contributionMode` default `private`; valid `private|contributing`. (`VALID_MODES` in [platform-dev-config.ts](../../../apps/web/lib/actions/platform-dev-config.ts) + the MCP enum + any union types updated in the same commit per AGENTS.md §3.)
- `FeatureBuild.disposition` `String @default("private")` + `dispositionReason String?` + `dispositionSource String?` (`suggested|operator`) + `dispositionDecidedAt DateTime?` + `dispositionDecidedById String?`. Cached suggestion: `dispositionSuggested String?` + `dispositionSuggestionReason String?`.
- `PrivatePathRule { id, pattern, reason, createdById, createdAt }` — DB overrides merged with `.dpf/private-paths` (loader already tolerates absence).
- Migration backfills existing rows: `fork_only→private`, else `→contributing`; all in-flight `FeatureBuild`s get `disposition="private"` (safe).

## Logic / programmatic processes
1. **Disposition gate** at **public-hive egress only** (`classifyEgress` from increment 2): `contribute_to_hive` (always public) and `create_portal_pr` (when public) refuse unless `disposition==="shareable"`. Own-repo egress unaffected → **Build Studio ship-to-own-repo keeps working**.
2. **Suggestion engine** `suggestDisposition({ buildId|diff })`: maps existing signals — private-path stripping, sanitization, reusability scope, contribution readiness, DPF project viability, and archetype/market fit — into a recommendation (`share`, `keep_local`, or `generalize_first`) plus the two-state egress disposition (`shareable|private`). `private` remains the fail-closed default when analysis is missing or low-confidence; it is not treated as the coworker's recommendation by itself. Computed at `deploy_feature` time and cached on the build.
3. **`set_change_disposition` MCP tool** (write scope): the human/coworker final call; records `dispositionSource="operator"`.
4. **Readers updated** (13): `platform-dev-policy.ts` (becomes near-identity), `git-backup.ts`, `build-flow-state.ts`, `issue-bridge.ts`, `feedback-escalation.ts`, `agent-coworker.ts`, `hive-contributions.ts`, `feature-build-data.ts`, `build.ts`, `mcp-tools.ts` (3 sites), `build-agent-prompts.ts` (Build Studio prompt: 3-branch → 2-state + suggestion).
5. **Sandbox:** builds populate `diffPatch` via `deploy_feature` → suggestion computed there; sandbox adds no infra. Disposition defaults private; ship path enforces at egress.
6. **Self-upgrade:** the enum migration must apply cleanly through the governed upgrade (merge into `dpf/install`); `private` installs keep everything local — self-upgrade unchanged. Add a migration note; verify apply on canonical install.
7. **MCP:** update tool descriptions (`contribute_to_hive`, `create_portal_pr`, `deploy_feature`), add `set_change_disposition` (+ token scope), surface the suggestion in tool responses so external Claude/Codex see it. Provenance-blind (§17).

## UX pages (plain-language, §12/§17 — no git vocabulary)
- **Onboarding (SetupOverlay):** Step 7 → one binary — **"Keep everything on my system"** vs **"Contribute improvements to the community"**.
- **Admin > Platform Development:** 2-state toggle; `ContributionModelBanner`/`ForkSetupPanel` reworded; private-paths editor (writes `PrivatePathRule`).
- **AI Coworker ship phase:** per-change **Keep / Share** control prefilled with the AI suggestion + reason; human confirms; fail-closed.
- **Upgrade Center:** local-changes ledger (commits on `dpf/install` not upstream, tagged kept/shared) — `report-kit` `DataTable`, no hardcoded colors.
- UX-Fit-Decision trailer on each UI-bearing PR (new user-facing controls on `human_cognitive_load`).

## Design grounding
- Existing specs/plans reviewed:
  - `docs/superpowers/plans/2026-06-19-contribution-model-2state-suggest-confirm.md`
  - `docs/superpowers/specs/2026-06-18-private-public-change-segregation-design.md`
  - `docs/superpowers/specs/2026-06-19-hive-contribution-architecture-and-egress-model.md`
- Current code substrate reviewed:
  - `apps/web/components/build/ReleaseDecisionPanel.tsx`
  - `apps/web/lib/integrate/disposition.ts`
  - `apps/web/lib/integrate/build-agent-prompts.ts`
  - `apps/web/lib/mcp/packs/contribution-hive-pack.ts`
  - `apps/web/lib/mcp/build-ship-handlers.ts`
- Source of truth:
  - The two-state `FeatureBuild.disposition` / `dispositionSuggested` model remains the egress source of truth; contribution assessment only recommends and never bypasses the human confirmation gate.
- Decision:
  - Keep the release UX plain-language (`Keep on my system` / `Share with the community`), and make the coworker recommendation heuristic explicit: DPF project viability, archetype/market usefulness, reuse readiness, privacy risk, and confidence must be assessed before recommending share. Missing analysis stays fail-closed to private.

## Docs to update
AGENTS.md §1 (commons wording if it cites modes), `docs/user-guide/ai-workforce/*` (decision-perspective + contribution), `docs/superpowers/specs/2026-04-01-contribution-mode-git-integration-design.md` + `2026-04-23-public-contribution-mode-design.md` (addendum: superseded by 2-state), install docs, and the two segregation specs (mark the ratified model).

## Rollout (verified increments, each its own PR)
1. **Increment 1** ✅ merged (#2074) — private-paths boundary.
2. **Increment 2** ✅ open (#2079) — public-hive egress classifier.
3. **Increment 3** (this push) — schema migration (enum collapse + `FeatureBuild.disposition` + `PrivatePathRule`) + all reader/writer updates + MCP enum/defs + `set_change_disposition` + suggestion engine. Gates: migration apply + `next build` on canonical install; unit tests + typecheck source-local.
4. **Increment 4** — UX pages (onboarding, admin, ship-phase, ledger) + docs sweep. Gate: UX verification on canonical install (AGENTS.md §5). 2026-07-16 Codex slice: Build Studio release panel now presents the explicit **Keep on my system / Share with the community** choice, backed by the smarter contribution recommendation; share remains disabled until the stored suggestion or explicit prior disposition allows it.
5. **Increment 5** — Build Studio prompt + verify both BS and external paths end-to-end on the live install.

## Verification substrate note
Migration apply, `next build`, and all UX verification run on the **canonical local install or the shared local-CI sandbox** (AGENTS.md §5) — never the source-only worktree. Source-local gates (vitest, typecheck) run via the root-clone overlay until the worktree is compile-ready.
