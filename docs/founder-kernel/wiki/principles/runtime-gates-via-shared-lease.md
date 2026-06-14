---
title: Runtime Gates via Shared Lease
slug: runtime-gates-via-shared-lease
pageKind: principle
status: published
abstract: Runtime-bound verification goes through the shared local-integration-ci lease, always. Every shared singleton runtime — including the :3001 contributor preview — must be lease-gated. Per-branch CI images and unleased shared-mutable runtimes are prohibited.
principleTier: contextual
principleDirection: Route every runtime-bound gate through the shared local-integration-ci lease; lease-gate every shared singleton runtime (including :3001); never build per-branch CI images or silently re-bind an unleased shared-mutable resource.
principleDimensionVector: {"governance_compliance": 0.8, "capacity_utilization": 0.7, "blast_radius": -0.6, "long_term_maintainability": 0.5}
principleAppliesTo:
  - external_coding_agent
  - human
principleRingScope:
  - ring-4-sandbox-prod
principleConsumerArchetype: route-domain-specific
principleConsumerContexts:
  - engineering-flow
  - release
---

## Rule

Runtime-bound verification (build / UX / migration gates) from a worktree goes through the shared lease, **always**: `claim_nonprod_environment_lease(environmentKey="local-integration-ci")` is the *only* sanctioned runtime. **Every shared singleton runtime MUST be lease-gated** — including the `:3001` Contributor preview, which folds into the `local-integration-ci` lease (spec §7 Q5). Specifically:

- Building a **per-branch CI image** is prohibited — it is the source of multi-GB image sprawl.
- A shared singleton must not be **silently re-bound** while a lease is held; surface who holds it and refuse the re-bind.
- **No ad-hoc `docker run` / `compose up`** from a surface except through the governed sandbox/lease or an explicit, audited recovery. Worktree compose requires `COMPOSE_PROJECT_NAME` isolation.

## Why

The shared lease is the same unleased-shared-mutable-resource discipline applied uniformly. On 2026-06-05, agents inconsistently built their own per-branch CI images (5 orphaned `dpf-local-integration-*-build` images, ~20 GB; ~50 GB Docker reclaimable). Worse, the `:3001` `dev-portal` was a *single* shared container bind-mounted to **one worktree at a time** via `DPF_DEV_WORKTREE`, **writing to the LIVE database**, with **no lease** — so whichever surface ran `dev-portal-start` last silently re-pointed `:3001` to its own worktree, and a coding mistake there mutated production data. That is the same antipattern as a per-branch CI image, but worse (live-DB write). At DPF's expected scale (1k–10k concurrent worktrees) per-worktree runnable runtimes are structurally untenable; the shared lease is the bounded-runtime answer ([`worktree-is-source-control-not-runtime`](worktree-is-source-control-not-runtime.md)), serializing converge + de-conflict + verify before a PR ships.

## How To Apply

- Run every runtime-bound gate through `claim_nonprod_environment_lease(environmentKey="local-integration-ci")`; record the evidence on the lease and cite the lease id in the PR.
- Never build a per-branch CI image. If you reach for `docker build` of a CI image, stop — use the lease.
- Treat `:3001` as lease-gated (folded into `local-integration-ci`); until that lands, treat it as operator-only, never a silent per-thread preview.
- Never run `docker compose up`/`down` from a worktree without a unique `COMPOSE_PROJECT_NAME`; root `--force-recreate`/`down --volumes` is the promoter's job, not a surface's.

## Decision Dimensions

- `governance_compliance: 0.8` — one lease-gated runtime model, audited and serialized.
- `capacity_utilization: 0.7` — kills the multi-GB per-branch image sprawl and reclaims disk.
- `blast_radius: -0.6` — a leased shared runtime cannot silently mutate another thread's preview or production data.
- `long_term_maintainability: 0.5` — one shared sandbox to maintain, not a per-branch image matrix.

## Related

- [`worktree-is-source-control-not-runtime`](worktree-is-source-control-not-runtime.md) — why the shared sandbox, not per-worktree runtimes, is the verification substrate.
- [`build-gate-mandatory`](build-gate-mandatory.md) — what must pass and where each gate runs.
- [`image-identity-equals-bytes`](image-identity-equals-bytes.md) — the live install advances only via the self-upgrade pipeline.
- [`mcp-is-the-coordination-plane`](mcp-is-the-coordination-plane.md) — the lease is an MCP coordination record.
- [AGENTS.md §17](../../../../AGENTS.md) — operational summary.
- [Unified Delivery Surfaces spec §4.3, §7 Q5](../../../superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md) — design context and the :3001 decision.

## Origin

Unified Delivery Surfaces spec, 2026-06-05 (WWMD-ratified, Q5 — kernel high confidence, margin 0.63). Fold-:3001 tracked in spec §6 keystone (f); compose isolation BI-63C11CF7.
