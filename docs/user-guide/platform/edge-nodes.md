---
title: "Edge Nodes"
area: platform
order: 6
lastUpdated: 2026-05-14
updatedBy: Codex
---

## Use This Doc For

- `/platform/edge-nodes`
- Edge Node enrollment, trust review, heartbeat status, and discovery-run intake
- Single-host installs that bundle an Edge Node beside the Authority Core
- Multi-host and air-gapped Edge Node runbooks under `docs/install/`

## Workflow

1. Start from the Edge Nodes page and confirm which nodes are enrolled, pending trust, stale, or rejected.
2. Approve trust only when the node identity, host, network placement, and intended collector scope are understood.
3. Review heartbeat and freshness before treating a discovery run as current.
4. Use the install runbooks for host-level setup:
   - [Multi-host LAN installation](../../install/edge-node-multi-host)
   - [Air-gapped installation](../../install/edge-node-air-gapped)
   - [Verification runbook](../../install/verification-runbook)
5. Use collected inventory as evidence for operations and discovery workflows, not as a replacement for owner review.

## Authoritative State

- Edge Node trust, heartbeat, and run status live in the platform database.
- The Edge Node host owns host-local collector configuration and network reachability.
- Discovery output becomes platform evidence only after the Authority Core accepts and records it.

## AI Coworker Support

The AI coworker can summarize node posture, highlight stale or untrusted nodes, and help turn unresolved setup issues into backlog work. It must not approve a node, widen collector scope, or infer legal authority to scan a network without operator approval.

## What To Watch

- pending nodes that look familiar but have not been tied to a known host
- stale heartbeat windows caused by host sleep, clock drift, or changed Authority Core URLs
- collector results from a Docker Desktop VM being mistaken for physical LAN truth
- active scans configured beyond the operator-approved subnet list
