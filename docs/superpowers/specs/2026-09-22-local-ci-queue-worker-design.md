---
title: The local-CI queue needs a worker, not a waiting room
slug: 2026-09-22-local-ci-queue-worker-design
status: draft
authoredAt: 2026-09-22
backlogItem: BI-A6DC9847
---

# The local-CI queue needs a worker, not a waiting room

## Problem

A session that queues for the local-CI pool exits 75 and must keep a process
alive so that, when its turn comes, it can start its own gate run. Nothing else
will. That process is `scripts/local-ci-durable-wait-resumer.mjs`, spawned
detached, polling every 20 seconds for up to two hours.

**The client is the executor.** Everything below follows from that one choice.

Measured on this host on 2026-09-22, while writing this document:

| Observation | Value |
|---|---|
| Resumer processes running concurrently | ~20 |
| Queue depth against usable slots | 14 against 1 |
| Typical gate run | ~15 minutes |
| Claim lifetime | ~2 hours |
| My claims that expired with `admittedAt` NULL | 2 of 2 |

The arithmetic does not close. A 14-deep queue at 15 minutes a run is about
three and a half hours of waiting against a claim that lives for two. Work
cannot survive long enough to be verified. Both of my claims expired **without
ever being admitted** — they did not fail, they never got a turn.

Then the pool closed entirely with `host-cpu-high`, refusing everyone. The
waiting is consuming the host that the waiting is for. The machine is competing
with itself.

## Why a webhook is not the answer

The founder's question was "shouldn't that be a webhook?" — and the instinct
that polling-per-session is wrong is correct. But a webhook is an inbound call,
so something local must be listening, and that listener must still start a run
in the right worktree with the host toolchain. That trades a polling process per
session for a listening process per session: same process count, same console
windows, same CPU, same competition.

**The transport is not the defect. The cardinality and the ownership are.**

Webhooks remain right where they already are — GitHub to portal is genuinely
event-driven and the platform already does that. Portal to local execution
cannot be, because an inbound event needs a local receiver.

## Decision

**One host-side worker owns the queue.** It takes the next admitted claim and
runs that gate itself. Sessions queue and leave.

The portal stays the admission authority. It decides who is next, under the
same capacity and liveness policy it applies today. The worker is its executor
on the host, and nothing about what counts as a valid claim changes.

### The enabler is already in the data

A queued `NonProductionEnvironmentLease` already carries what a worker needs:

```
leaseId          | branchName                     | worktreePath
NPEL-68B7177960  | closure/parity-items           | D:/DPF-source-root-worktrees/closure-parity
NPEL-76C9371133  | fix/local-ci-refuses-stale-... | D:/DPF-source-root-worktrees/stale-gate-client
```

No new field, no new record, no schema change is required for a worker to act.
This is why the change is smaller than it sounds: the queue was always
worker-shaped, and only the executor was missing.

### What the client does instead

`pregate` claims, and on `queued` it records the claim and exits. It holds no
process and spawns nothing detached. `pregate:status` continues to read the
verdict from the gate's own state file, so it stays the single source of truth
and this design adds no second home for a verdict.

### What the worker does

One resident process per host:

1. Ask the portal for the next claim admitted to this host.
2. Run that gate in the worktree the claim names, exactly as a first run does.
3. Let the gate write its own state file. The worker writes no verdict.
4. Release, and take the next claim.

The worker is the only thing that needs to survive a long wait, and there is one
of it.

## What this removes

The elaborate machinery that exists solely to answer "is the waiting client
still alive" becomes unnecessary. `scripts/lib/local-queue-observer.mjs` carries
PID start-time comparison, recycled-PID detection and a 12-hour TTL — all to
track waiters. A worker-owned queue has no waiters to track.

Six filed items are symptoms of the same cause and should be resolved or
withdrawn by this work rather than fixed separately:

- **BI-69178E02** — the resumer opens a visible terminal window on every
  re-claim. No resumer, no window.
- **BI-3C0A2D88** — keep background CI retries from opening Windows consoles.
  Same.
- **BI-D35B85BF** — exit 75 promised a wake no process delivered. That item
  added the resumer to keep the promise; this one asks whether the client should
  be woken at all.
- **BI-EB864226** — re-running pregate after a durable wait adds a second queue
  entry for the same tree. A client that does not re-run cannot double-queue.
- **BI-31556F50** — durable-wait recovery cannot release its own lease. The
  worker holds and releases, and it is still there to do so.
- **BI-91B1C23D** — a running gate fenced by host-memory-low is discarded with
  no record. Orthogonal to ownership, but the worker is the natural place to
  record it once.

Six independent fixes around one mechanism is the signal that the mechanism is
wrong.

## Constraints

**The gate runs on the host.** It needs Windows, the pinned pnpm and node
toolchain, and the actual worktrees. The portal is a Linux container and cannot
run it, so the worker is a host-side resident process rather than a portal job
or an Inngest function. This is the constraint that rules out the otherwise
attractive "just make it a server job" answer.

**Admission policy does not move.** Capacity, liveness, host-pressure fencing
and the gate key all stay in the portal. This design changes who executes, not
who decides.

**One worker per host, enforced.** Two workers would reintroduce the
competition this removes. Single-instance ownership must be a property of the
design, not a convention.

## Research and benchmarking

This is the standard work-queue shape, and the comparison worth making is with
the CI systems the project already relies on.

- **GitHub Actions self-hosted runners.** A runner is a long-lived host agent
  that polls the service for work and executes it. The *requesting* workflow
  holds nothing. This is the closest analogue and the model adopted here.
- **Buildkite agents** and **GitLab runners** are the same shape: a resident
  agent per host, jobs pulled from a central queue, the requester decoupled from
  execution.
- **Jenkins agents** likewise, with the controller owning scheduling.

None of them make the requester responsible for executing its own turn. That
pattern does not appear in mature CI because it does not survive contention,
which is precisely what this host demonstrated.

**Rejected: webhook to a per-session listener.** Keeps the process-per-session
cardinality that causes the problem, and adds an inbound network surface.

**Rejected: portal-side execution via Inngest.** The portal container has
neither the host toolchain nor the worktrees. It could only shell back out to
the host, which needs a host agent anyway — the worker, by another name.

**Rejected: raising the claim lifetime.** Treats the symptom. A longer claim in
a queue that grows faster than it drains still expires, and holds a slot booking
for longer while doing so.

**Rejected: more slots alone.** Worth doing on its own merits, but it does not
remove the per-session processes, the console windows, or the CPU the waiting
consumes.

## Acceptance

- AC-QW-001 A session that queues exits holding no process and spawning nothing
  detached; its gate still runs and its verdict is recorded.
- AC-QW-002 Exactly one worker per host executes gate runs, however many
  sessions are waiting; a second worker cannot start.
- AC-QW-003 A claim cannot expire because its owner was not watching.
- AC-QW-004 No console window opens during normal operation.
- AC-QW-005 The gate writes its own verdict; `pregate:status` remains the single
  source of truth and the worker writes no verdict of its own.
- AC-QW-006 Queue-observer liveness tracking is removed, or its retention is
  explicitly justified.
- AC-QW-007 Admission policy is unchanged: the portal still decides who is next.
- AC-QW-008 A worker that dies is detectable and restartable without any claim
  being lost.

## Risks

**A single worker is a single point of failure.** If it dies, nothing runs —
whereas today each session carries its own. Mitigated by AC-QW-008: a dead
worker must be visible and its claims must survive. This is the same trade every
CI runner makes, and the failure is far easier to see than twenty silent
waiters.

**Migration overlaps.** While both designs exist, a host could run resumers and
a worker at once and double-execute a claim. The plan must sequence the removal
of the resumer with the arrival of the worker, not run them concurrently.
