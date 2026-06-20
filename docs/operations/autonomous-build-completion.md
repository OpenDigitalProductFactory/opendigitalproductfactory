# Autonomous Build Completion (operator runbook)

Build Studio can finish verified builds on its own — from `ship` all the way to
`complete` — without an operator clicking through each ship step. This is
**opt-in and off by default**; turn it on deliberately and watch the first run.

## What it does

When enabled, a build that passes review and reaches the `ship` phase:

1. **Pushes its PR** upstream (`contribute_to_hive`) — the "upstream" delivery
   fork.
2. **Registers the product + promotion** (`register_digital_product_from_build`)
   — the "promote" delivery fork.
3. **Completes itself** once its merged code is actually live on this install via
   the **platform self-upgrade** (the deploy you already run) — _not_ a per-build
   `dpf-promoter` deploy.

Completion is handled by a periodic reconciler that runs on boot and every ~10
minutes (`reconcileDeployedShipBuilds`): for each build sitting at `ship` whose
merged commit is now in the deployed runtime (`isFeatureBuildDeployed`), it marks
the promotion `deployed` (the self-upgrade _was_ the deploy) so the promote fork
is terminal, then advances the build `ship → complete`.

End-to-end, with no operator clicks:

```
ideate → plan → build → review → ship → (PR merges + next self-upgrade) → complete
```

## The switch

```
DPF_AUTO_COMPLETE_VERIFIED_BUILDS = "1" | "true" | "on"     # default OFF
```

Set on the `dpf-portal` container's environment. Unset / anything else = OFF —
builds reach `ship` and wait for a manual ship, exactly as before.

## How to turn it on

1. **Deploy the code.** Run a platform **self-upgrade** so the build-completion
   code (PRs #2180 + #2188) is live. Until then builds still loop/stall at
   `review`/`ship`.
2. **Set the flag.** Add `DPF_AUTO_COMPLETE_VERIFIED_BUILDS=1` to the portal
   environment and redeploy/restart the portal so it takes effect.
3. **Watch the first one.** It pushes a real upstream PR — eyeball the first
   autonomous delivery end-to-end before leaving it on for the fleet.

## Safety

- **Default OFF** — nothing happens until you set the flag.
- **No per-build production deploy** — completion follows your self-upgrade, not
  the `dpf-promoter`. (Per-build promoter deploys are a separate, heavier option;
  this runbook is the self-upgrade path.)
- **Idempotent + non-throwing** — re-runs skip already-pushed PRs and
  already-registered products; any unresolved fork simply parks the build at
  `ship` for an operator.
- **Real artifacts only** — a build reads `complete` only when it genuinely has a
  pushed PR, a product/promotion, and its merged code live in the runtime. It
  never writes a `complete` status without those.

## Notes / limitations

- **Legacy stranded builds** — builds created before these fixes (sandbox torn
  down, or code merged via a manual PR with no build-linked records) will not
  auto-complete cleanly; they predate the flow. Re-run or retire them rather than
  forcing them.
- **Contribution mode matters** — in `private` / `fork_only` mode the upstream PR
  fork auto-skips (no PR needed); in `contributing` mode a PR is pushed per the
  steps above.

## Related

- **PR #2180** — fixes the review→ship loop (`deploy_feature` extracted the diff
  but never advanced the phase, so verified builds spun at `review` forever).
- **PR #2188** — this feature: the fork resolver, the ship-completion reconciler,
  and the session-less `shipBuild` enabler.
- Code:
  - `apps/web/lib/integrate/ship-on-review-approval.ts` — `autoResolveShipForks`,
    `isAutoCompleteEnabled`.
  - `apps/web/instrumentation.ts` — `reconcileDeployedShipBuilds` (boot + 10-min
    interval).
  - `apps/web/lib/build-flow-state.ts` — `reconcileBuildCompletion` (the
    forks-terminal + deployed gate).
