---
title: "Mobile companion — Expo SDK 53 → 55 upgrade"
date: 2026-05-20
status: draft
appliesTo:
  - apps/mobile
relates:
  - docs/superpowers/specs/2026-03-19-mobile-companion-app-design.md
  - docs/superpowers/specs/2026-05-13-realtime-hitl-mobile-companion-design.md
---

# Mobile companion — Expo SDK 53 → 55 upgrade

**Date:** 2026-05-20
**Status:** Draft (ready for review)
**Author:** chore-lane sweep (`chore/deps-web-db-sweep-2026-05-20` follow-up)
**Owner — proposed:** Mobile feature owner

---

## Overview

`apps/mobile` is pinned to **Expo SDK 53** (React Native 0.79.7, React 19.0.6, Expo Router 5). The companion app was scaffolded at SDK 53 per [the original mobile companion design](2026-03-19-mobile-companion-app-design.md) and has not been bumped since. `pnpm outdated` from the 2026-05-20 dep-hygiene sweep ([PR #871](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/871)) surfaced every Expo-family dep, plus React Native, Jest, and TypeScript, as out-of-date — collectively a multi-day upgrade rather than a routine `pnpm update`.

This spec scopes the upgrade as a single coordinated effort to **Expo SDK 55** (React Native 0.83, React 19.2), the current stable SDK at time of writing. SDK 54 is skipped intentionally — it is the *last* SDK to carry Legacy Architecture support, and the codebase already has `newArchEnabled: true`, so we jump straight to the SDK where Legacy is removed. SDK 56 (Q2, RN 0.85) is deferred — the additional iOS 16.4 minimum and the in-flight RN renderer changes are not free to absorb.

This is **not** a routine dep bump. It is a coordinated framework upgrade with:
- A change to every Expo SDK package version (SDK 55 unifies all Expo-family packages to `^55.0.0`).
- React Native runtime upgrade across two minor versions (0.79 → 0.83).
- React core upgrade (19.0 → 19.2).
- Jest 29 → 30 and TypeScript 5.9 → 6 in the same workspace, which the spec treats as separable slices.

## Goals

1. Land the mobile workspace on Expo SDK 55 with the same feature surface, no functional regression.
2. Keep the bump independent of the running web/db deployment — `apps/mobile` is consumed via app-store builds, not the portal Docker stack, so mobile churn does not impact the platform.
3. Preserve the New Architecture, which has been on since SDK 53 (`newArchEnabled: true`).
4. Identify dead code surfaced by the audit (e.g. unused `react-native-mmkv` dependency) and remove it in the same sweep where it does not expand scope.
5. Pin every Expo-family package to its SDK-55-aligned version per the new versioning rule ("the version of `expo-camera` that is compatible with SDK 55 is `^55.0.0`").

## Non-Goals

- **Expo SDK 56 (RN 0.85).** Deferred to its own spec once mobile has stabilized on 55 in a TestFlight build.
- **New mobile features.** The upgrade does not introduce screens, capabilities, or push registrations.
- **Native module replacements.** No swapping Zustand, NativeWind, expo-router, expo-sqlite, expo-secure-store, etc. for alternates.
- **Migrating off Maestro for E2E.** Same harness, same `apps/mobile/e2e/flows/`.
- **Web/db workspace changes.** Out of scope by hard boundary — handled by [PR #871](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/871) and follow-up sweeps.
- **Jest 30 + TypeScript 6 in this spec's scope.** Tracked as Phase 4 (orthogonal); see Phasing.

## Current state (2026-05-20)

`apps/mobile/package.json`:

| Layer | Package | Current | Target | Class |
|---|---|---|---|---|
| Framework | `expo` | `~53.0.0` | `^55.0.0` | SDK major |
| Framework | `react-native` | `0.79.7` | `0.83.x` | minor x2 |
| Framework | `react` | `19.0.6` | `19.2.x` | minor x2 |
| Router | `expo-router` | `~5.1.11` | `^55.0.0` | SDK major + version-alignment |
| SDK module | `expo-camera` | `~16.1.11` | `^55.0.0` | SDK major + version-alignment |
| SDK module | `expo-local-authentication` | `~16.0.5` | `^55.0.0` | SDK major + version-alignment |
| SDK module | `expo-location` | `~18.1.6` | `^55.0.0` | SDK major + version-alignment |
| SDK module | `expo-notifications` | `~0.31.5` | `^55.0.0` | SDK major + version-alignment |
| SDK module | `expo-secure-store` | `~14.2.4` | `^55.0.0` | SDK major + version-alignment |
| SDK module | `expo-sqlite` | `~15.2.14` | `^55.0.0` | SDK major + version-alignment |
| SDK module | `expo-status-bar` | `~2.2.3` | `^55.0.0` | SDK major + version-alignment |
| Storage (unused) | `react-native-mmkv` | `^3.0.0` | **remove** | dead code |
| Test (dev) | `jest` | `~29.7.0` | `^30.x` | major — *Phase 4* |
| Test (dev) | `jest-expo` | `~53.0.14` | `^55.x` | aligned with SDK 55 |
| Test (dev) | `react-test-renderer` | `19.0.6` | `19.2.x` | matches React core |
| Language (dev) | `typescript` | `^5.9.3` | `^6.0.3` | major — *Phase 4* |

Notes from the audit:

- **`react-native-mmkv` has zero imports** anywhere under `apps/mobile/app` or `apps/mobile/src`. The `SecureStorage` repository (`apps/mobile/src/repositories/SecureStorage.ts`) uses `expo-secure-store` directly; the `CacheRepository` uses `expo-sqlite`. MMKV was scaffolded in but never wired up. **Removing it in this sweep avoids an unnecessary native module rebuild.**
- **`newArchEnabled: true`** is already set in `app.json`. SDK 55 removes this config key entirely (New Architecture is the only option). The bump must **delete the key**, not just the value.
- **Zero usages of deprecated APIs** flagged by SDK 54/55 release notes (`ExpoRequest`, `ExpoResponse`, `allowsFullscreen`, `experimentalBlurMethod`, `edgeToEdgeEnabled`, `networkActivityIndicatorVisible`). Confirmed via grep across `app/`, `src/`, and `app.json`. The code surface does not require codemods.
- **77 `.ts`/`.tsx` source files**, **24 test files** (13 of those use `@testing-library/react-native`), and a Maestro E2E flow tree. This is the verification surface.

## Breaking changes the upgrade must absorb

Sourced from the [Expo SDK 55 changelog](https://expo.dev/changelog/sdk-55) and the [SDK 54 → 55 migration guide](https://reactnativerelay.com/article/expo-sdk-55-migration-guide-breaking-changes-sdk-53-to-55). Items below are the *full* set, not just the ones affecting our codebase — included so the reviewer can verify nothing was missed.

### Framework-level

| Change | Affects us? | Action |
|---|---|---|
| Legacy Architecture support removed | No — already on New Arch | Remove `newArchEnabled` key from `app.json` |
| Expo SDK packages unified to `^55.0.0` major | Yes | Bump every `expo-*` package together |
| Xcode 26 required | Build-environment only | EAS Build absorbs this; no source change |
| iOS minimum stays at 15.1 (SDK 56 will move to 16.4) | No | None |
| Node LTS `^20.19.4`, `^22.13.0`, `^24.3.0`, `^25.0.0` | Likely yes (CI runner) | Verify CI Node version; bump if pinned below those |
| `expo-av` removed from Expo Go | No — we don't depend on `expo-av` | None |
| Fast resolver and `EXPO_USE_FAST_RESOLVER` removed | No | None |
| `experiments.reactCanary` removed | No | None |
| `edgeToEdgeEnabled` removed (mandatory on Android 16+) | No — not set in our `app.json` | None |

### Module-specific

| Module | Change | Affects us? |
|---|---|---|
| `expo-router` | `reset` prop on headless tabs renamed to `resetOnFocus`; removed `ExpoRequest`/`ExpoResponse` types from `expo-router/server` | **No** — no headless-tabs `reset` prop usage; no `expo-router/server` imports (mobile is client-only) |
| `expo-notifications` | `notification` config field removed from `app.json` schema; push notifications in Expo Go on Android throws | **Check** — confirm `app.json` does not carry a `notification` block (current sample doesn't show one, but full file should be re-scanned) |
| `expo-status-bar` | Deprecated `backgroundColor`, `translucent`, `networkActivityIndicatorVisible` props | **No** — zero usages |
| `expo-camera` | New barcode-scanner opt-out option | **No code change required**; new option, not a breaking removal |
| `expo-blur` | `experimentalBlurMethod` renamed to `blurMethod`; new `<BlurTargetView>` API additive | **No** — we don't import `expo-blur` |
| `expo-video`, `expo-clipboard`, `expo-cellular` | Various deprecated-prop removals | **No** — not imported |

**Net code-mod surface:** delete one `app.json` key (`newArchEnabled`). That is the entire diff outside `package.json` + `pnpm-lock.yaml`.

## Phasing

The work splits into four phases. Phases 1–3 are mandatory and sequenced; Phase 4 is independent and can land before, after, or in parallel as a separate PR.

### Phase 1 — Pre-flight cleanup (one PR, ~30 min)

Lands separately so the SDK bump diff is purely a dependency change.

1. Remove `react-native-mmkv` from `apps/mobile/package.json` (unused).
2. If the install fails any post-bump check linked to a transitive MMKV pin (unlikely), restore.
3. `pnpm --filter mobile typecheck && pnpm --filter mobile test`.

**Stop condition:** clean PR, ~3 lines.

### Phase 2 — Expo SDK 53 → 55 + Expo packages + RN + React (one PR, ~half-day with verification)

The headline bump. Single PR with one commit per logical group inside the PR if reviewer prefers.

1. Run `npx expo install --check` to surface every package whose version is mis-aligned for the target SDK, then `npx expo install` with `--fix` to align all Expo modules to `^55.x`.
2. Bump `expo` to `^55.0.0`, `react-native` to the pinned RN target for SDK 55 (`0.83.x`), `react` and `react-test-renderer` to `19.2.x`.
3. Bump `jest-expo` to `^55.x` (the only test-runner package on the Expo cycle).
4. **Delete the `newArchEnabled` key from `app.json`.**
5. Re-run `npx expo install --check` and `npx expo doctor` — must return clean.
6. `pnpm --filter mobile typecheck` must be clean.
7. `pnpm --filter mobile test` — the 24 Jest specs (13 RNTL) must all pass on the bumped runtime.
8. **EAS preview build** (one for iOS, one for Android) via `eas build --profile preview --platform all`. The output `.ipa`/`.apk` must install and reach the login screen on at least one physical device or simulator.
9. **Maestro E2E sweep** against the preview build on at least one platform — `maestro test apps/mobile/e2e/flows/`. All flows that pass on SDK 53 today must pass on SDK 55.

**Stop conditions:**
- Any of: typecheck failure, test failure, doctor warning, EAS build failure, Maestro regression → revert.
- Verify there are no warning-class regressions in the EAS build log (separately tracked per the platform "fix all warnings" principle).

### Phase 3 — Production verification (~1 day, gated)

1. Bump `apps/mobile/app.json` version to the next semver tag.
2. EAS production builds for both stores.
3. **TestFlight + Android internal-track distribution** to the maintainer's device for a 24-hour soak. All workflows from the [mobile companion design](2026-03-19-mobile-companion-app-design.md) feature list must work: login, workspace dashboard, customer detail, ops/backlog browsing, governance approvals, portfolio view, agent conversation, push notification receipt.
4. If clean, proceed to public-track release per the existing release procedure.

**Stop condition:** any crash, any regression on a manual flow.

### Phase 4 — Jest 30 + TypeScript 6 (separate PR, ~half-day, **orthogonal**)

Decoupled from the SDK upgrade so failures don't co-mingle.

1. `pnpm --filter mobile add -D jest@^30 typescript@^6`.
2. Apply the [Jest 30 codemod](https://jestjs.io/docs/upgrading-to-jest30) if the test specs trigger it (RNTL is already 13.x-compatible per its current release notes).
3. Re-run `pnpm --filter mobile typecheck && pnpm --filter mobile test`.

This phase MAY land before Phase 2 (TypeScript 6 is independent of Expo SDK) or after. The spec recommends **after** — reduces variables when diagnosing any Phase-2 surprise.

## Research & Benchmarking

Per AGENTS.md §10 — design research is required before finalization. Below are the references consulted while drafting this spec.

### Comparable open-source upgrades

- **[Expo SDK Upgrade Walkthrough](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)** — Canonical procedure: `npx expo install expo@<sdk-target>` → `npx expo install --fix`. The "delete `newArchEnabled` from app.json" step in Phase 2 mirrors the example in that walkthrough for SDK 55.
- **[Expo SDK 55 official changelog](https://expo.dev/changelog/sdk-55)** — Primary source for the breaking-change table above. Confirmed: RN 0.83, React 19.2, Hermes Legacy dropped, all Expo packages unified to `^55.0.0`.
- **[Expo SDK 55 Migration Guide 2026](https://reactnativerelay.com/article/expo-sdk-55-migration-guide-breaking-changes-sdk-53-to-55)** — Third-party walk-through of an SDK 53 → 55 jump (skipping 54). Confirms the "two-SDK skip is safer than three because Legacy Architecture removal is the discontinuity at SDK 55, and projects already on New Arch see the smallest deltas."
- **[expo/expo Discussion #44481 — Does Expo SDK 55 work with react-native 0.85-rc?](https://github.com/expo/expo/discussions/44481)** — Maintainer response confirms RN 0.85 is **SDK 56 territory** (Q2 2026), not 55. Justifies the deferral choice in Non-Goals.

### Pattern adopted

The "phase-gated upgrade" pattern is the React Native community's documented approach for SDK majors. Each phase has its own verification stop, and the orthogonal-tool slice (Phase 4) is held back to reduce diagnostic surface area.

### Patterns rejected

- **One mega-PR with the SDK bump *and* Jest 30 *and* TypeScript 6.** Rejected: when something breaks, you can't tell whether the runtime or the tooling regressed. Phase 4 split addresses this.
- **Bumping straight to SDK 56 / RN 0.85.** Rejected: would force an iOS 16.4 minimum and pull in in-flight renderer changes for zero current benefit. SDK 56 lives in its own future spec.
- **Bumping each `expo-*` package independently across multiple PRs.** Rejected: SDK 55 enforces version-alignment (`^55.0.0` across the family). Independent bumps would land in an unaligned state per the new versioning rule.
- **Keeping `react-native-mmkv` "in case we wire it up later."** Rejected: dead code is harder to remove later (the native module is heavyweight). Phase 1 cleanup removes it; re-add only when a real consumer lands.

### Anti-patterns identified

- **Skipping `expo doctor`** — Doctor catches mis-aligned package versions that `pnpm` cannot, because Expo's SDK-version compatibility table is not encoded in semver alone. Phase 2 step 5 makes it mandatory.
- **Trusting `pnpm outdated` alone to drive the bump.** The output suggests bumping `expo` from 53 → 55 in one go without surfacing the SDK-wide version-alignment rule. The `--check`/`--fix` flow on `npx expo install` is the source of truth for the *whole package family*, not `pnpm`.
- **Running Jest tests as the only verification.** A Jest pass does not exercise the native runtime; the EAS-build + simulator-run check in Phase 2 step 8 is non-negotiable.

### Gaps this design fills

- Captures the **`react-native-mmkv` cleanup** that surfaced from the audit — easy to lose if the spec only catalogs the bumps.
- Treats **`jest` + `typescript`** as orthogonal to the SDK upgrade — they would otherwise sneak into Phase 2 and confuse failure attribution.
- Pre-empts the **`newArchEnabled` deletion** as a hard requirement, not a "TODO during the bump."

## Test plan

Per AGENTS.md §5 Build Gate + §14 Release Testing:

| Gate | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|---|---|---|---|---|
| `pnpm --filter mobile typecheck` | ✓ | ✓ | n/a | ✓ |
| `pnpm --filter mobile test` (Jest + RNTL) | ✓ | ✓ | n/a | ✓ |
| `npx expo doctor` | — | ✓ | — | — |
| `npx expo install --check` | — | ✓ | — | — |
| EAS preview build (iOS + Android) | — | ✓ | — | — |
| Maestro E2E (`apps/mobile/e2e/flows/`) | — | ✓ | ✓ | — |
| Manual device soak (24h TestFlight + internal track) | — | — | ✓ | — |
| App-store release procedure | — | — | ✓ | — |

## Open questions

- **Who owns the EAS account?** Phase 2 step 8 requires an EAS Build credential. If this is a single-maintainer account today, the spec needs a note on credential handoff.
- **CI Node version.** SDK 55 requires Node `^20.19.4` / `^22.13.0` / `^24.3.0` / `^25.0.0`. The local Claude session runs Node 24.13.1 ✓, but the GitHub Actions runner pin should be checked before Phase 2 lands.
- **Do we want to land Phase 1 (MMKV removal) as a stand-alone hygiene PR before this spec is approved?** The answer is "yes" if anyone is concerned about cumulative diff size; "no" if the reviewer prefers all mobile-workspace changes to be batched. The spec defaults to standalone-PR per the "one concern per PR" rule.
- **Should the spec also call out the `lucide-react` web update**? (Not directly — mobile uses `@expo/vector-icons`, not lucide. Mentioned only because the audit confused them in the `pnpm outdated` output across workspaces.)
- **Is there a `BI-` epic for mobile-platform maintenance?** If yes, link from the implementation PRs; if no, this spec can stand alone as the tracking artifact.

## Implementation note (not for spec sign-off)

This spec was produced as a research deliverable from the chore-lane sweep that landed [PR #865](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/865), [PR #871](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/871), and [PR #874](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/874). No code change is requested in the PR carrying this spec; the spec is the deliverable.

The natural follow-up after spec approval is a Phase 1 PR (`react-native-mmkv` removal) — small, fast, isolates the cleanup from the framework jump.
