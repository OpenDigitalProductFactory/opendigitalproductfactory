---
title: Doc-Cited Anchors Must Exist
pageKind: principle
status: published
abstract: Every EP-, BI-, DI-, or WC- id cited in a merged document must exist in the live coordination plane. A plan whose backlog anchors return not_found is invisible to governance — the platform's flagship architecture program went unbacked for two weeks this way.
principleTier: core
principleDirection: Cite only coordination-plane anchors that exist — verify ids against the live backlog before merging a doc, and extend the anchor-existence guard when a new id family appears.
principleDimensionVector: {"evidence_density": 1.0, "governance_compliance": 0.8, "legibility_of_consequence": 0.6, "speed_to_value": -0.1}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principlePublic: false
principlePublicRationale: ""
---

## Rule

A document that cites a coordination-plane id — an epic (`EP-`), a backlog item (`BI-`), a decision interaction (`DI-`), a Workroom (`WC-`) — asserts that the id **exists in the live database**. Before merging, verify every cited anchor resolves; when authoring, create the anchor first (file the BI, record the decision) and cite the returned id, never a predicted one. Anchor existence is guard territory: any id family that appears in merged docs gets a mechanical existence check.

## Why

The coordination plane is only authoritative if its anchors are real. The 2026-08-16 architecture pass found the flagship hardening program's own coordination anchors — its epic, umbrella BI, and Phase-1 BI — all returning `not_found` from the live backlog, making the platform's most important program invisible to its own governance for two weeks. The doc-corpus review found the same pattern across epic docs: cited ids that never existed, because an authoring session predicted ids instead of creating them. Every phantom anchor poisons downstream reasoning: status queries, evidence chains, and coverage receipts all silently miss work that documents claim is tracked.

## Applies To

Everyone who merges documents citing coordination ids: in-platform coworkers, external coding agents, humans. Applies to specs, plans, architecture docs, kernel pages, and PR descriptions that claim backlog coverage.

## How To Apply

Authoring: run the MCP query (`get_backlog_item`, `list_epics`) for every id you cite; if the thing doesn't exist yet, create it through the governed tool and cite the id it returns. Reviewing: spot-check the load-bearing anchors. Platform: the anchor-existence guard extends an existing doc guard — any `EP-`/`BI-` id in a merged doc must exist in the DB; new id families (DI-, WC-) join the guard when they start appearing in docs. A deliberately hypothetical id in an example is marked as such (`EP-XXXXXXXX`), never shaped like a real one.

## Decision Dimensions

- `evidence_density: 1.0` — an anchor that resolves is evidence; one that doesn't is fabrication with a serial number.
- `governance_compliance: 0.8` — governance that approves evidence needs its anchors to exist; this is the P3 drift pattern closed at the source.
- `legibility_of_consequence: 0.6` — real anchors let any reader walk from a doc to live status.
- `speed_to_value: -0.1` — the verification round-trip is cheap; the guard makes it free.

## Examples

- **Negative:** the 2026-08-01 hardening plan cited `EP-413F2602`, umbrella `BI-C04CAD7F`, and Phase-1 `BI-2E9F6D37`; all three returned `not_found` on 2026-08-16 — the program had to be re-anchored before any new work could honestly attach to it.
- **Positive:** this page's sibling program docs cite only ids returned by the live MCP tools at authoring time.

## Related

- [[principles/never-fabricate]] — a nonexistent anchor is a fabricated claim in its most durable form.
- [[principles/single-source-of-truth]] — the live backlog, not the doc, is the source of truth the anchor points into.
