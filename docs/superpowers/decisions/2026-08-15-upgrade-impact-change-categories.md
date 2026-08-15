# Upgrade impact summary — specific change categories instead of a catch-all "other"

**Date:** 2026-08-15
**Surface:** `/ops/self-upgrade` → "What's in this update?" panel (`apps/web/components/ops/UpgradeImpactPanel.tsx`) and the Latest Run scope ribbon (`UpgradeScopeRibbon`)
**Module:** `apps/web/lib/self-upgrade/impact/`
**Backlog:** BI-6EC1350E
**Kernel decision:** DI-626B8EA95F90, profile `mark-dpf-platform`

## Problem

An operator opened the panel on a real install and saw five changes, every one
of them badged **OTHER** — while the LLM headline directly above them read
"5 updates included: 1 documentation addition and 4 dependency updates". The
phrasing layer knew what the changes were; the taxonomy underneath it did not.

Root cause: `ChangeCategory` carried only `breaking | feature | fix |
performance | other`, and `categoryFor()` mapped `docs`, `chore`, `build`, `ci`,
`test`, `refactor`, `style`, `revert` and every unparseable subject into the
single `other` bucket.

That bucket is not marginal. Over the last 400 commits on `main`:

| type | count |
| --- | --- |
| `fix` | 185 |
| `feat` | 123 |
| `docs` | 50 |
| `doc` (parsed as `unknown` → `other`) | 16 |
| `build` (almost entirely `build(deps*)`) | 13 |
| `chore` / `test` / `refactor` | 11 |

So roughly a fifth of every upgrade rendered as an undifferentiated wall of
identical badges, and the two things an operator most wants separated — "we
documented something" and "we changed what the product runs on" — were the same
badge.

## Decision

Replace the catch-all with categories that map to distinct operator concerns:

| category | derived from | badge |
| --- | --- | --- |
| `breaking` | `!` marker / `BREAKING CHANGE:` | Breaking |
| `security` | PR labels + advisory ids, applied after PR enrichment | Security |
| `feature` | `feat` | New |
| `performance` | `perf` | Faster |
| `fix` | `fix` | Fix |
| `dependency` | `build(deps)` / `build(deps-dev)` | Dependency |
| `documentation` | `docs` (and the `doc` spelling upstream also emits) | Docs |
| `maintenance` | `chore`, `refactor`, `test`, `ci`, `style`, `revert`, other `build` scopes | Internal |
| `other` | **only** a subject the parser could not read | Other |

Three consequences worth stating explicitly:

1. **`other` now means "we don't know", not "we didn't bother".** It is the
   honest fallback for an unparseable subject, and nothing else. Any commit that
   lands there is a parser gap, which makes the bucket a usable signal.
2. **`security` cannot come from the subject alone.** Upstream emits a routine
   version bump and an advisory-clearing bump with the same
   `build(deps): bump X from A to B` subject; only the PR (labels, `CVE-…` /
   `GHSA-…` ids, title, body) distinguishes them. A second pass —
   `refine.ts` — runs **after** `pr-enrich` and promotes on explicit evidence
   only. It never demotes, never promotes a breaking change, and never guesses a
   security fix into existence when GitHub is unreachable (Never Fabricate).
3. **Counts are taken after that pass.** Taking them before would put the
   headline and the badges in disagreement — the exact failure this change
   exists to remove.

Ordering follows one shared `CATEGORY_RANK` (in `classify.ts`, consumed by
`score.ts` — single source of truth, not two rank tables): risk first
(breaking → security), then what the operator asked for
(feature → performance → fix), then upkeep (dependency → documentation →
maintenance), then unknown. Base weights follow the same shape, with
`dependency` (12) deliberately above `documentation` (6) and `maintenance` (5):
a dependency bump changes what the product actually runs on and is the usual
suspect when an upgrade regresses something.

## Backward compatibility

`UpgradeImpactSummary` rows persist the computed summary as JSON, so summaries
written under the old five-key taxonomy replay into the new code. Both readers
degrade rather than break:

- `formatImpactCounts` reads every key as `?? 0`, so a missing key is "none of
  those", never `NaN`.
- The panel resolves badges through `categoryLabel()` / `categoryBadge()`, which
  fall back to the neutral badge for any category this build has no entry for.

No migration, no backfill: a stale summary keeps saying what it said when it was
generated, which is the correct behaviour for an audit record.

## Kernel consultation

`principle_decide` (DI-626B8EA95F90) scored a minimal option (split out
`dependency` + `documentation` from the subject grammar only) against the full
option (also `security` + `maintenance`, with security refined from PR
evidence). Result: **full** — composite 9.902 vs 6.130, margin 3.771, confidence
high, strong structured coverage, no commandment conflict. Top contributors:
*Research and Use Standards* and *Classify ambiguous requests before acting* —
both pulling toward classifying a change by what it actually is rather than
filing the ambiguous remainder in one bucket.

## Scope of change (no contract change)

- `impact/types.ts` — widened `ChangeCategory` and `ImpactCategoryCounts`.
- `impact/conventional.ts` — scope-aware `categoryFor`, `doc`/`feature`/`bugfix`
  type aliases, case-insensitive type token.
- `impact/refine.ts` *(new)* — the post-enrichment security promotion pass.
- `impact/classify.ts` — exported `CATEGORY_RANK`; counts cover every bucket.
- `impact/score.ts` — base weights per category; consumes the shared rank.
- `impact/format.ts` — counts ribbon names each bucket; legacy-safe reads.
- `impact/index.ts` — enrich → refine → count ordering.
- `impact/phrase.ts` — the LLM is told to name the categories, not collapse them.
- `components/ops/UpgradeImpactPanel.tsx` — badge labels/colors + fallback.
- `lib/self-upgrade/owner-summary.ts` — reads counts structurally, so it no
  longer restates the bucket list.

## Related

- [Latest Run card — human-readable upgrade scope](2026-07-15-self-upgrade-run-card-human-readable-scope.md)
- [Self-upgrade change register design](../specs/2026-06-16-self-upgrade-change-register-design.md)
- BI-F7A591AF — surfacing each past run's persisted summary in Run History, so an
  adverse change can be traced to the upgrade that introduced it (follow-on).
