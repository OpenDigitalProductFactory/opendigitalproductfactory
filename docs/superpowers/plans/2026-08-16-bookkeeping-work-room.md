---
title: "Plan — Bookkeeping Work Room (decomposed umbrella)"
date: 2026-08-16
bi: BI-1585FA9E
epic: EP-EMAIL-COMMS
status: active
---

# Plan — Bookkeeping Work Room (BI-1585FA9E, decomposed umbrella)

**BI:** BI-1585FA9E · **Epic:** EP-EMAIL-COMMS · **Priority:** P2 · **Triage:** build/large
**Spec:** [2026-08-16-bookkeeping-work-room-design.md](../specs/2026-08-16-bookkeeping-work-room-design.md)
**Kernel routing:** `principle_decide` DI-56B045130A22 → pipeline-and-decompose (high confidence). This plan executes that decision.

**For agentic workers:** execute one slice at a time — one BI, one branch, one PR. `dpf-tdd` for red-green, `dpf-local-merge-ci-before-push` + the completion gate before any success claim, `dpf-pr-with-dco` for handoff. Do NOT build this umbrella atomically — it is decomposed below.

## Why decomposed (not one build)

Cross-cutting substrate across four epics; the founder suitability boundary routes it to a direct expert build, sliced. Two standing blockers on the *full functional* outcome, neither resolvable by building: (1) importing real transactions needs the operator's card-statement export — no fictitious data on the live instance; (2) BI-04E4F111 (Build-Studio Plan routing) gates any BS-routed slice. The substrate slices go via direct expert build and do not depend on (2).

## Slices (each an independently shippable BI)

| Key | BI | Deliverable | Depends on |
| --- | --- | --- | --- |
| S-FIN | BI-DE27D34E | Banking books loop as governed MCP tools + `banking_read/write` grant (FOUNDATION) | — (existing banking actions) |
| S-BK | BI-7D50DC56 | Bookkeeper coworker via the factory door | S-FIN (headline grants) |
| S-ROOM | BI-F8B6CF81 | Work Room orchestration + `bookkeeping-room` lifecycle grammar + Outcome Packet | S-BK, S-FIN |
| S-TRIG | BI-DC738330 | Weekly + on-arrival triggers | S-ROOM |

**Build order:** S-FIN → S-BK → S-ROOM → S-TRIG. S-FIN is the load-bearing gap (the loop exists only as UI server actions today; no coworker can drive it through governed tools).

## Backlog coverage

- **Decision:** `decomposed` — every slice is independently shippable and maps to a live BI. The umbrella BI-1585FA9E carries no direct deliverable.
- **Receipt:** _(recorded via `record_plan_backlog_coverage`.)_

## Verification note

Slices are verified on the machinery with fixture data (governed tool call succeeds, a bank rule matches, a reconciliation summary computes). The live reconciled period is owner-gated on a real statement export — surfaced as an owner action, not a build gap.
