---
title: In-Platform Gate Parity — Build Studio produces the evidence an external agent produces
slug: 2026-09-12-in-platform-gate-parity-design
status: draft
authoredAt: 2026-09-12
---

# In-Platform Gate Parity

## Problem

The target market for this platform is non-developer users, and the consumer
install is built for them: no host source checkout, all development in-product.
But development has in practice moved to external CLI agents, because Build
Studio has been hard to trust at the same level.

The reason is not model capability. `Dockerfile.sandbox` installs Claude Code,
Codex, Grok and OpenCode, and the dispatchers stream real credentials in at
dispatch time — Build Studio runs the same frontier CLIs an external agent runs.
It is not cost either: `apps/web/lib/build/claude-dispatch.ts` already defaults to
OAuth subscription auth, documented in-code as ~20x cheaper than API keys.

The reason is **evidence**.

| | External agent | Build Studio |
|---|---|---|
| Guards before commit | 67, via `scripts/pregate-preflight.mjs` | none |
| Gate keying | exact tree, recorded, reusable | none |
| Publish | `git push`, refused without a gate record | REST API — no push, so the hook never fires |

The pre-push gate is attached to a MECHANISM (`git push`) rather than to a
CONTRACT (*a candidate tree wants to become a ref on a shared repository*). The
in-platform path uses a different mechanism, so the entire local-CI contract is
structurally absent from it. No operator can configure that away.

**If a non-technical person can commit meaningful changes that make this platform
better, the flywheel for the masses starts.** That is what this parity is for.

## Decision

Attach verification to the contract. A tree published by the in-platform path
carries the same evidence, with the same keying, as a tree published by an
external agent.

Delivered in four slices, in order:

1. Run the guard gauntlet against the build's own tree, in the sandbox.
2. Emit a gate evidence record keyed to that tree, in the existing shape.
3. Refuse to publish without a passing record for the exact tree.
4. Make a gate failure legible to a non-developer.

This document covers slices 1 and 2. Slice 3 is sequenced after them on purpose:
it is the only slice that can block real work, and a refusal arriving before the
checks are trustworthy would meet a non-developer with a wall they did not earn.

## Design

### Slice 1 — the gauntlet runs where the work is

`apps/web/lib/build/sandbox/guard-gauntlet.ts` runs the SAME
`scripts/pregate-preflight.mjs` the external path runs, inside the sandbox,
against `resolveBuildWorkdir(buildId)`. Reimplementing the checks would guarantee
the two surfaces drift; invoking the same script means they cannot.

No Docker, no lease, no host toolchain is needed. The sandbox already has Node,
pnpm, git, an installed `node_modules` and the whole `scripts/` tree from
`docker-entrypoint.sh`. Verified on the live install before this was designed:

```
$ docker exec dpf-sandbox-1 sh -c 'cd /workspace && node scripts/check-module-size.mjs'
Module-size OK — no new oversized files, no baselined file grew.
exit=0
```

**Which tree.** With `DPF_BUILD_WORKTREE_ISOLATION` on (the default) the agent
CLIs work in `/workspace/.builds/<buildId>` while the MCP file tools write to the
shared root. `build-pipeline.ts` has always passed the workdir to
`runSandboxTests`; the `run_sandbox_tests` MCP handler did not, so that tool
verified a different tree than the build produced — silently, and always in the
reassuring direction. Fixed here.

**Could-not-run is not a verdict.** A crash (non-zero exit naming no guard), a
timeout, a sandbox that cannot start the command, or missing exit status all
return `ran: false` with a reason, never a failing guard. This is
`report-only-the-verdict-you-reached` applied at the point of measurement.

### Slice 2 — the result becomes evidence

`apps/web/lib/build/sandbox/guard-gauntlet-evidence.ts` shapes the run into an
`ExternalEvidenceRecord` through the existing canonical writer,
`recordLocalIntegrationResult`. Two choices carry the weight:

**Keyed to the TREE.** A build id says who ran it; a tree sha says what was
checked. Only the second survives work moving between surfaces — a change started
in Build Studio and finished in a worktree should not have to be re-verified. The
key is derived by the SAME `deriveGateKey` the external path uses, so the keying
is identical rather than merely similar.

**A distinct gate kind.** `in-platform-preflight` is added to `GATE_KINDS`
alongside `local-integration-ci`. This tier is guards only — no typecheck, no
unit tests, no production build, no image — because the sandbox has no Docker
socket by design and must not be given one. Since the kind is hashed into the
gate key, the two tiers derive different keys for the same tree and a fast-tier
record can never be handed back to a claim asking for the heavy one. The record
also carries an explicit `coverage` object stating what it does not cover: a
reader assuming "gate record means fully verified" would be wrong about this one,
and the record is the only place that can say so.

### Where it runs

As a non-blocking step in the `build/review.verify` Inngest job, between
`resolve-changed-files` and `semantic-change-review` — the point where the
assembled change exists and before ship is dispatched.

## Scope boundary

Parity is of the FAST tier plus the cloud safety net, not of the image build.
AGENTS.md §4 already tiers it that way for every surface: "the heavy build runs
once, in the cloud. Fast local checks gate the push; the full build is the cloud
merge-queue safety net." The in-platform path takes the same deal the external
path takes; this is not a concession.

## What this does not do

It does not block anything yet (slice 3). It does not claim heavy-tier coverage.
It does not give the sandbox a Docker socket, a credential, or network authority
it did not have. It does not change the external path's behaviour.

## Research & Benchmarking

GitHub Actions and GitLab CI both key cached/reused results to a content digest
rather than a branch or run id, for the same reason adopted here: the statement is
about content, so it survives the work moving. GitHub's own merge-queue model
separates a cheap pre-merge tier from an expensive merge-group tier, which is the
tiering AGENTS.md §4 already states and this design follows rather than invents.

Rejected: reimplementing a Build Studio-specific check list. It would drift from
the external path by construction, which is the failure this work exists to end.

Rejected: giving the sandbox a Docker socket for full parity. It would dissolve
the isolation that makes the sandbox safe to hand to a non-developer, for a tier
the cloud already covers.

## Acceptance

- AC-IPGP-001 A completed build carries a preflight result naming every guard that ran and every one that failed.
- AC-IPGP-002 The result comes from the same script the external path runs, invoked against the build's own tree.
- AC-IPGP-003 Running it requires no Docker, host checkout, or non-production lease.
- AC-IPGP-004 A crash, timeout or unstartable sandbox is reported as not-run, never as a failing guard.
- AC-IPGP-005 A verification run writes a gate record keyed to the tree it checked, via the existing writer.
- AC-IPGP-006 The record states which tier ran and does not imply coverage it lacks.
- AC-IPGP-007 A fast-tier record derives a different gate key than the heavy tier for the same tree.

## Tests

`guard-gauntlet.test.ts` — the gauntlet runs in the build's worktree and not the
shared root; passes clean; names failing guards; and reports crash, timeout,
unstartable sandbox and missing exit status as not-run rather than as failures.
`guard-gauntlet-evidence.test.ts` — the key is tree-keyed, stable, derived by the
shared function, and provably distinct from the heavy tier's key for identical
inputs; the record states its coverage and never claims a pass it did not get.
