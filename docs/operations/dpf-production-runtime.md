# DPF Production Runtime

> **Substrate scope:** the conventions below describe the **Single VM substrate** (local Windows install today; macOS / native Linux per the [installer-parity roadmap](../superpowers/plans/2026-05-09-macos-linux-native-support.md)). Cloud substrates (Managed container service, Managed Kubernetes) and packaging targets (TAPPaaS module, marketplace image, Helm chart) carry substrate-specific runtime conventions in [`docs/superpowers/specs/2026-05-09-cloud-deployment-design.md`](../superpowers/specs/2026-05-09-cloud-deployment-design.md). The shared canonical contracts are in the [deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md).

This install runs three local runtime roles:

| Role | Surface | Backed by | Used for |
| --- | --- | --- | --- |
| **Live portal** | `http://localhost:3000` | `portal` service, production Next.js bundle, live install DBs | Final acceptance. End users and operators. The only runtime that satisfies customer-zero verification. |
| **Build runtime** (aka *Live preview*) | `http://localhost:3035` | `sandbox` service, agent-capable Next.js dev server, `sandbox-postgres` | Build Studio agent execution and the in-canvas Live preview. Not a final-acceptance surface. |
| **Contributor preview** | `http://localhost:3001` | `dev-portal` service (profile-gated), Next.js dev hot-reload, isolated dev DBs by default | DPF contributors verifying worktree edits before opening a PR. Not shipped by default to customer installs. |

## Rules

- Final acceptance always targets the Docker-served **Live portal** on `http://localhost:3000`.
- Never use ad-hoc `pnpm dev`, `next dev`, or `next start` on port 3000 for customer-zero verification.
- The **Build runtime** is the agent execution surface; humans see it through Build Studio's in-canvas preview (the footer "Open live preview" button) rather than treating it as a developer scratch surface.
- The **Contributor preview** is opt-in via the `dev` compose profile. A plain `docker compose up -d` does not start it, and customer installs do not ship it by default.
- Promote changes through branch → PR → verification → image rebuild flow rather than treating the Live portal as a scratch environment.

## Why this matters

This machine hosts the real Open Digital Product Factory production instance. The runtime split is therefore not just a local developer convenience; it is part of the operating model DPF expects customers to follow as well.

Customer installs (e.g. Dale's HVAC shop) see only the Live portal and the Build runtime. The Contributor preview is a DPF-contributor surface, gated behind the `dev` compose profile and not surfaced in the customer install UX.

## Terminology mapping

These names appear in the operator-facing UI, docs, and skills. The compose-service / container / port facts behind them are unchanged in Phase 1 and remain visible in diagnostics:

| User-facing name | Compose service | `RuntimeTarget.kind` | Port |
| --- | --- | --- | --- |
| Live portal | `portal` | `root-portal` | 3000 |
| Build runtime / Live preview | `sandbox` | `build-sandbox` | 3035 |
| Contributor preview | `dev-portal` | `dev-portal` | 3001 |

See [Runtime glossary](runtime-glossary.md) for the canonical definitions.
