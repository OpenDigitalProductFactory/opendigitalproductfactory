---
title: Platform function never depends on a client
slug: platform-function-never-depends-on-a-client
pageKind: principle
status: published
abstract: Anything the platform guarantees must run inside the platform — server-side, on its own schedule, on every install. An AI client hook may accelerate a guarantee, never own it, because the install that needs it most has no client at all.
principleTier: commandment
principleDirection: Implement every guaranteed platform behaviour server-side so it runs without Claude Code, Codex, Grok or any other client; a client hook may only accelerate what the platform already does on its own.
principleDimensionVector: {"operational_independence": 0.95, "vendor_lock_in": -0.9, "long_term_maintainability": 0.8, "capacity_utilization": 0.6, "governance_compliance": 0.5, "human_cognitive_load": -0.6}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: false
authoredAt: 2026-09-02
authoredBy: mark-bodman
---

# Platform function never depends on a client

**If the platform guarantees a behaviour, that behaviour runs inside the
platform.** Server-side, on its own schedule, on every install — with no
Claude Code, no Codex CLI, no Grok, no client of any kind installed. A client
hook may make a guarantee happen *sooner*. It may never be the thing that makes
it happen at all.

This is commandment tier because the failure is silent, it lands on the
operator least able to diagnose it, and it scales with the estate.

## The test

For any behaviour the product promises, ask: **does it still happen on an
install where no AI client has ever been installed, and where nobody is
technical?**

If the answer is no, it is not a platform function. It is a developer
convenience that has been mistaken for one.

## Why

Reaping worktrees was specified as a lifecycle rule and implemented as a
`SessionEnd` hook in `.claude/settings.json`. The scheduled-job catalog says so
in as many words: *"Primary reaping is session-lifecycle
(worktree-session-hygiene on SessionEnd). ... Not a per-client CLI cron."* The
portal's own sweeper was left default-off, and observe-only even when enabled.

That arrangement needs four things to be true at once: an AI client is
installed, a source checkout exists, its settings file is present, and the
session ends *cleanly*. A consumer install satisfies none of them. An
abnormally terminated session — killed, crashed, host rebooted — satisfies the
last one none of the time.

So on the installs that generate worktrees server-side, through Build Studio
and external agents, nothing reaps anything. Measured on the development
install 2026-09-02: **193 worktrees, accumulating at 17.6 per day**, individual
directories reaching 39 GB. A federated peer carried 230+.

The doctrine was not missing. [`worktree-selection-and-reaping`](worktree-selection-and-reaping.md)
was authored on 2026-06-05, when the count was 119, and it already said the
target was a bounded count. Three months later the count was **62% higher**.
Writing the rule changed nothing, because the rule was addressed to agents and
humans while the machine creating the mess was the platform.

The end state is not untidiness. It is a full disk, which takes down the
install — including the portal that would have reported the problem — on a
machine whose owner cannot read a nomination list, has no reason to know
worktrees exist, and whose first signal is that nothing works any more. At
estate scale that is a support event, arriving for many owners at once, with no
prior warning to any of them.

## What this does not license

It does not license automatic destruction. This principle governs **where a
behaviour lives**, not **what it is allowed to destroy**.
[`destructive-actions-require-explicit-go`](destructive-actions-require-explicit-go.md)
still binds, and the two resolve cleanly:

- That commandment restrains an **agent** taking an ad-hoc destructive action
  outside a declared policy. It stays absolute.
- This one requires that a **platform** guarantee run without a client. A
  bounded, declared, auditable housekeeping policy — shipped with the product,
  visible to the operator, reversible in its effects — is platform behaviour
  operating inside its envelope, not an agent improvising.

Where the two meet, the safe design is a **bounded default that needs no
decision** rather than an unbounded default that waits for one. A default that
requires a technical action from a non-technical owner is not a safe default;
it is a deferred outage. Anything genuinely irrecoverable — unmerged or
unpushed work — still needs an explicit go, and
[`prefer-reversible-containment`](prefer-reversible-containment.md) governs the
shape of what happens in between.

## How to apply

- Put guaranteed behaviour in the server: a scheduled job, a queue function, a
  runtime service. Not a hook, not a skill, not a CLI cron.
- Treat a client hook as an **accelerator with no authority**. Removing every
  client from the estate must change timing, never outcomes.
- When a behaviour must be bounded, ship the bound as a default that holds with
  nobody watching. Make the threshold visible before it is fatal.
- Reserve explicit-go for the irrecoverable, and say plainly what will happen
  without it.
- When adding a `SessionStart` / `SessionEnd` / `PreToolUse` hook, state which
  platform function already guarantees the outcome. If none does, the hook is
  the wrong home and this principle is the finding.

## Decision dimensions

- `operational_independence: 0.95` — the platform standing on its own is the
  whole content of the rule.
- `vendor_lock_in: -0.9` — a guarantee that only holds with one vendor's client
  installed is lock-in wearing a lifecycle hook.
- `long_term_maintainability: 0.8` — one server-side implementation outlives
  four client-specific ports that drift apart.
- `capacity_utilization: 0.6` — the observed cost of the gap is unbounded disk.
- `governance_compliance: 0.5` — a guarantee nothing enforces is not governance.
- `human_cognitive_load: -0.6` — removes a decision the owner cannot make.

## Related

- [`worktree-selection-and-reaping`](worktree-selection-and-reaping.md) — the
  lifecycle rule whose reaping half this supersedes as to *where it runs*.
- [`destructive-actions-require-explicit-go`](destructive-actions-require-explicit-go.md)
  — still binding; reconciled above.
- [`prefer-reversible-containment`](prefer-reversible-containment.md) — the
  shape of bounded automatic action.
- [`one-common-process-three-surfaces`](one-common-process-three-surfaces.md) —
  surfaces are peers; this says the platform must not need any of them.
- [`never-ask-user-to-run-commands`](never-ask-user-to-run-commands.md) — the
  same operator reality, applied to interaction rather than architecture.
- [`make-silent-failures-observable`](make-silent-failures-observable.md) — why
  the threshold must surface before exhaustion.
- [`install-is-the-tenant`](install-is-the-tenant.md) — the unit that fills up.
