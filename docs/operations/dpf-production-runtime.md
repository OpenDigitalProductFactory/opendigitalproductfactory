# DPF Production Runtime

> **Substrate scope:** the conventions below describe the **Single VM substrate** (local Windows install today; macOS / native Linux per the [installer-parity roadmap](../superpowers/plans/2026-05-09-macos-linux-native-support.md)). Cloud substrates (Managed container service, Managed Kubernetes) and packaging targets (TAPPaaS module, marketplace image, Helm chart) carry substrate-specific runtime conventions in [`docs/superpowers/specs/2026-05-09-cloud-deployment-design.md`](../superpowers/specs/2026-05-09-cloud-deployment-design.md). The shared canonical contracts are in the [deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md).

This install runs with three distinct local runtime roles:

- `http://localhost:3000` = production-served portal
- `http://localhost:3001` = `dev-portal` developer runtime
- `http://localhost:3035` = sandbox runtime / Build Studio isolation

## Rules

- Never use ad hoc `pnpm dev`, `next dev`, or `next start` on port `3000` for customer-zero verification.
- Verify shipped behavior against the Docker `portal` service on `http://localhost:3000`.
- Use `dev-portal` on `3001` for interactive developer runtime work when you need a local non-production app surface.
- Use sandbox on `3035` for isolated Build Studio / governed build behavior.
- Promote changes through branch, PR, verification, and rebuild flow rather than treating the production-served runtime as a scratch environment.

## Why This Matters

This machine hosts the real Open Digital Product Factory production instance. The runtime split is therefore not just a local developer convenience; it is part of the operating model DPF expects customers to follow as well.
