---
title: "Plan — establish the Bookkeeper coworker (S-BK)"
date: 2026-08-26
bi: BI-7D50DC56
epic: EP-EMAIL-COMMS
status: active
---

# Plan — Bookkeeper coworker (BI-7D50DC56, slice S-BK)

**Parent:** BI-1585FA9E (Bookkeeping Work Room). **Spec:** `docs/superpowers/specs/2026-08-16-bookkeeping-work-room-design.md`. **Depends on:** S-FIN (BI-DE27D34E, merged #4658) for the banking tools + grants.

## What

Establish a `bookkeeper` coworker via the factory door (`establish_coworker`), then complete its definition so it holds the banking grants and does the day-to-day books loop — distinct from the Finance Controller's oversight role. This activates the S-FIN tools through a real coworker and retires the reachability exemptions S-FIN added.

## Definition (each axis the conformance gate enforces)

- **Roster + grants** (`workforce-seed.ts`): `COWORKER_AGENT_SEEDS` entry + `HARDCODED_COWORKER_GRANTS[bookkeeper]` = `banking_read/banking_write` (S-FIN), `enrichment_write` (vendor→supplier, BI-B2497DFB), `crm_read/write`, `document_read`, `work_room_read/write`, `registry_read`, `backlog_read`.
- **Registry** (`agent_registry.json`): a `bookkeeper` entry (AGT-907) whose `config_profile.tool_grants` MATCH the seed grants — so there is no seed↔registry divergence, and holding `banking_*` makes the 12 banking tools reachable (the S-FIN exemptions are removed here).
- **Route persona** bound to the EXISTING `/finance/banking` route (`agent-routing.ts` + `route-context-map.ts`): longest-prefix match wins on the banking pages while the Finance Specialist keeps `/finance` — no new-route gate cascade.
- **Model floor** (`agent-model-defaults.ts`): `strong` with tool use (confidential money-of-record work).
- **Profession**: added to the `finance` family in `docs/professions/registry.json` + a `bank-reconciliation` corpus page.
- **Seed-Fit-Decision:** `global-default` (every business keeps books).

## Verification

- coworker-definition-conformance, tool-reachability (banking now reachable, exemptions shrunk), resolve-profession-profile coverage, coworker-grant-consistency (no divergence), seed invariants — all green. Full `apps/web` typecheck clean.
- **Certification + promotion** happen post-merge/post-deploy: the nightly `ops/coworker-certification` sweep exercises the golden journeys, then `establish_coworker action="promote"` makes it summonable. Until the live portal upgrades to include S-FIN + this definition, the coworker is `draft/defined`, not yet summonable — the lifecycle working as designed.

## Risks & rollback

- **UX Route Budget Sweep** re-baseline is expected (a new coworker joins the global selector). Handled per `dpf-establish-coworker` with a reviewed baseline splice.
- Rollback: remove the roster/grants/registry/route/model/profession entries; the banking exemptions return. No schema change, no migration.
