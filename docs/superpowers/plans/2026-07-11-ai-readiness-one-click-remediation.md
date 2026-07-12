# AI Readiness One-Click, Phase-Aware Remediation Plan

**BI:** BI-1A75E068 · **Findings:** F10 / F11 / F12

**Goal:** Make AI-readiness remediation actionable. When a Build phase reports
"no eligible AI endpoint", stop showing a dead text pointer ("Activate a provider
… in Providers & Routing") and instead name the currently-off provider(s) that
would satisfy the phase and let the operator enable a one-click one in place.

## The problem

Three surfaces cover AI readiness:

- **AI Readiness console** (`/platform/ai/readiness`) — domain summary.
- **Runtime Health** (`/platform/ai/runtime-health`) — per-phase routing +
  a "Mismatches & remediation" list carrying `no-eligible-endpoint`.
- **Providers & Routing** (`/platform/ai/providers`) — 22 providers with
  enable toggles.

A blocked phase told the operator to hunt through 22 providers for one that fits.
Nothing tied a blocked phase to the specific provider that would unblock it.

## Architecture — reuse, don't re-derive

The phase-eligibility match REUSES the live routing hard filter
(`getExclusionReasonV2`, `apps/web/lib/routing/pipeline-v2.ts`) against manifests
built by the SAME `profileToManifest` mapping the live router uses. No new
heuristic: a currently-off provider is an "enable candidate" for a phase iff at
least one of its models would pass real routing once its provider is active.

### Pieces

- **`apps/web/lib/routing/loader.ts`** — extract `profileToManifest(mp, statusOverride?)`
  (shared by the live query) and add `loadEnableCandidateManifests()`, which loads
  routing-eligible models for providers whose status is NOT active/degraded, with
  each manifest's status forced to `"active"` (simulating "if enabled").
- **`apps/web/lib/inference/phase-enable-candidates.ts`** (new, pure + loader):
  - `selectEnableCandidatesForContract(contract, providers)` — pure, DB-free,
    fully unit-tested. Runs `getExclusionReasonV2` per candidate model; classifies
    the operator's next step as `enable` (one-click), `connect_credentials`
    (off + missing/expired creds), or `set_up` (unconfigured); orders one-click first.
  - `loadPhaseEnableCandidateProviders()` — impure: loads off providers +
    credential state once, shaped for the pure function.
- **`apps/web/lib/inference/phase-model-resolution.ts`** — captures each routed
  phase's inferred `RequestContract`; for any phase blocked with
  `no-eligible-endpoint`, attaches `enableCandidates` to the `PhaseResolution`.

### Surfaces

- **F10 — Runtime Health.** New client component
  `apps/web/components/platform/PhaseRemediationActions.tsx` renders under each
  `no-eligible-endpoint` flag: one-click **Enable provider** (reusing the existing
  `toggleProviderStatus` server action) for credential-ready candidates; a
  **Connect & enable →** link with an explicit note for candidates that still
  need credentials/OAuth. The "Providers & Routing →" link stays as a fallback.
- **F11 — Providers & Routing.** The page calls the same
  `resolveModelSelectionByPhase()` and renders a "Resolves &lt;phase&gt;" badge on
  each candidate provider row (`ServiceRow.resolvesPhases`), auto-expanding the
  section (`ServiceSection.hasResolver`) so the badge is visible.
- **F12 — Readiness console.** `AiReadinessSummaryPanel` no longer renders the
  redundant secondary "Diagnostics" link when it targets the same page as the
  primary blocker action (the Routing-Confidence row had two buttons to
  runtime-health). One clear control per destination.

## Tests

- `apps/web/lib/inference/phase-enable-candidates.test.ts` — the pure selection:
  tool/context/sensitivity exclusion, one-click vs credential vs setup
  classification, expired-credential reconnection, any-model-qualifies, ordering.
- `apps/web/components/platform/AiReadinessSummaryPanel.test.tsx` — F12 dedupe:
  no secondary link when it duplicates the primary action's href.
