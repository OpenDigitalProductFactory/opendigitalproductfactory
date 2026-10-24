---
title: Image Identity Equals Its Bytes
slug: image-identity-equals-bytes
pageKind: principle
status: published
abstract: A built image must carry the identity of its bytes — stamp == built HEAD == target, asserted pre-swap, DEPLOYED_SHA populated, fail loud on divergence. The live install advances only via the self-upgrade pipeline; no surface hand-advances the root clone or the running portal. Never trust a version label over the bytes.
principleTier: core
principleDirection: Assert stamp == built HEAD == target before any portal swap and populate DEPLOYED_SHA; advance the live install only through the governed self-upgrade pipeline, never by hand-advancing the root clone HEAD or rebuilding the portal to "update"; never trust a version label over the bytes.
principleDimensionVector: {"governance_compliance": 0.8, "blast_radius": -0.7, "evidence_density": 0.7, "long_term_maintainability": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
  - release
---

## Rule

**A built image must carry the identity of its bytes.** Before any portal swap: **stamp == built HEAD == target**, asserted pre-swap, `DEPLOYED_SHA` populated, **fail loud on divergence**. Never trust a version label over the bytes.

The **live install advances only via the self-upgrade pipeline.** No surface hand-advances the root clone HEAD or the running portal:

- No `git checkout origin/main` / `pull` / `reset` on the root clone to "update."
- No manual portal rebuild (`docker compose build`/`up`, `redeploy-portal`) to "update."
- The governed `/ops/self-upgrade` runner/promoter owns quiescence, recovery-point creation, image rebuild/swap, health evidence, and rollback.

## Why

On 2026-06-05 the live install ran an image **stamped `e7ef3331` (June 5) but containing ~June-3 bytes** — no `device-catalog.ts`, migrations stopping at `20260603030000`, `/api/v1/device-catalog` returning 404. Three divergent source states existed, none equal to `origin/main`. The label lied about the bytes. The root cause was two competing source-advance engines (a host-clone `dpf/install` promoter vs. a `/workspace` `my-changes` image-sync) that hand-advanced source outside the governed pipeline. When the identity of an image is its label rather than its bytes, every downstream consumer — operator, gate, rollback — builds on a false premise. The fix is to make the bytes load-bearing: assert the three-way equality before swap and refuse to deploy on divergence (BI-5B6C1C35), and let only the self-upgrade pipeline move the live install.

## How To Apply

- At build/promote time, stamp the image with the built HEAD and assert it equals the intended target; populate `DEPLOYED_SHA`.
- Before swap, re-assert stamp == bytes == target; on any mismatch, **fail loud** — do not deploy a mislabeled image.
- Route every live-install advance through `/ops/self-upgrade` (or the governed runner/promoter). Never hand-advance the root clone HEAD or rebuild the portal as an "update."
- When diagnosing a "stale portal," check the **bytes** (files present, migration tip, route behavior), not the version label.
- **A release tag is a label too.** Confirming that a git tag contains a merge commit says nothing about the image carrying that tag. On 2026-08-27 an agent verified `#4741` was an ancestor of git tag `v2026.08.27`, upgraded to the image tagged `v2026.08.27`, and reported five fixes live; the running container still held `allowedTools: []` — the pre-merge file. Nothing was bind-mounted; the image genuinely predated its own tag. Check a file the change actually touched: `docker exec <container> grep … /app/…`, or `docker run --rm --entrypoint sh <image> -lc '…'` before deploying. Note that some images ship source rather than a built `.next`, so grep the source path, not the bundle.
- **"Up to date" is a label as well.** The same session found `:latest` frozen at the previous release because a failed publish job never promoted it. The install's own status page truthfully reported "You're running the latest version. Nothing to install" while a newer release existed — a red publish on one side, a green check on the other, and nothing connecting them. Compare digests (`docker manifest inspect`) rather than trusting the update surface.

## Decision Dimensions

- `governance_compliance: 0.8` — only the governed pipeline advances the live install.
- `blast_radius: -0.7` — a mislabeled image deployed to the live install corrupts every downstream assumption.
- `evidence_density: 0.7` — the deployed SHA and pre-swap assertion are the evidence that the bytes are the target.
- `long_term_maintainability: 0.5` — one source-advance engine instead of competing ones.

## Related

- [`runtime-gates-via-shared-lease`](runtime-gates-via-shared-lease.md) — verify before swap; never rebuild the live portal to verify.
- [`build-gate-mandatory`](build-gate-mandatory.md) — the live-portal refresh rule and self-upgrade path.
- [`fix-the-seed-not-the-runtime`](../../../professions/data-architect/wiki/fix-the-seed-not-the-runtime.md) — patch the source, not the running bytes by hand.
- [`never-fabricate`](never-fabricate.md) — the bytes are ground truth, not the label.
- [AGENTS.md §17](../../../../AGENTS.md) — operational summary.
- [Unified Delivery Surfaces spec §4.3](../../../superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md) — design context.

## Origin

Unified Delivery Surfaces spec, 2026-06-05. Tracked as BI-5B6C1C35; relates to the governed platform-upgrade lifecycle design.
