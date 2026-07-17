---
name: show-identity-resolution
description: "Show the full identity-resolution lineage (IdentityResolutionLog) for an inventory item — how its CatalogIdentity was decided and by which rule"
category: inventory
assignTo: ["inventory-specialist"]
capability: "view_inventory"
taskType: "analysis"
triggerPattern: "identity resolution|how was this identified|resolution lineage|why this identity|fingerprint match|catalog identity"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Show Identity Resolution Lineage

Explain how an inventory item's normalized identity (its `CatalogIdentity`) was decided — the resolution lineage recorded in `IdentityResolutionLog` (spec §4.1).

## Steps

1. Identify the item in question — an `InventoryEntity` or the `CatalogIdentity` it resolved to. Use PAGE DATA for the currently open entity/product when the user says "this one".
2. Retrieve its `IdentityResolutionLog` rows (most recent first). Each row records:
   - **resolutionType** — `rule` (deterministic fingerprint match), `ai_resolved`, `human_confirmed`, or `human_corrected`.
   - **fingerprintRuleId** — the `DiscoveryFingerprintRule` that produced a rule resolution (when present).
   - **confidence** and the **evidence** packet (matched rule key, resolved identity, source signals).
   - **discoveryRunId** — the sweep that recorded it, and **createdAt**.
3. Present the lineage as a short timeline:
   - When first resolved, by what (rule key / AI / human), at what confidence.
   - Any later change of identity (a new row to a different `CatalogIdentity`) and why.
4. Show the current resolved identity: manufacturer / product / version / CPE, plus its support-lifecycle milestones if present.

## Guidelines

- This is **read-only** — never edit a resolution row. A wrong resolution is fixed by improving the rule (`improve-fingerprint-rule`) or a human correction, not by rewriting the audit log.
- Call out when the current identity rests on a **human_confirmed** row — those are authoritative and are never overwritten by a rule (spec §4.1).
- If the item has **no** `IdentityResolutionLog` rows, say so plainly: it was never resolved to a `CatalogIdentity` (heuristic or unattributed) — a candidate for `improve-fingerprint-rule`.
- Do not invent lineage — report only the rows that exist.
