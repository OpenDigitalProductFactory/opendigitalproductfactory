---
name: improve-fingerprint-rule
description: "Propose or refine a discovery fingerprint rule from an identity-resolution miss so the estate self-improves its normalization"
category: inventory
assignTo: ["inventory-specialist"]
capability: "view_inventory"
taskType: "analysis"
triggerPattern: "fingerprint rule|improve rule|wrong identity|misidentified|resolution miss|refine rule|normalization rule"
userInvocable: true
agentInvocable: true
allowedTools: [request_re_enrichment, create_backlog_item]
composesFrom: [show-identity-resolution]
contextRequirements: []
riskBand: low
---

# Improve a Fingerprint Rule

Turn an identity-resolution miss — a wrong `CatalogIdentity`, a low-confidence match, or an unresolved entity — into a concrete `DiscoveryFingerprintRule` improvement, closing the loop the enrichment pipeline depends on (spec §4.6).

## Steps

1. Start from the evidence. Use `show-identity-resolution` (compose) to read the item's `IdentityResolutionLog` — the matched rule (if any), its confidence, and the evidence packet. Use PAGE DATA for the entity currently open.
2. Diagnose the miss:
   - **No rule matched** — the entity is heuristic/unattributed; a new rule is needed.
   - **Wrong identity** — an existing rule over-matched; its match expression needs a tighter guard or an excluded signal.
   - **Low confidence** — the rule matched but below the auto-apply bar; the evidence families or confidence need adjustment.
3. Draft the rule change against the observed raw evidence (vendor strings, package names, image tags, MAC OUI, ports). Name the exact `matchExpression` change and the target `CatalogIdentity` (manufacturer / product / part a·o·h). Never let a raw vendor string leak straight onto the canonical identity — the rule sets it (spec §4.1).
4. File it as a tracked change with `create_backlog_item` (a `tool`/`chore` item under EP-ASSET-INTELLIGENCE) describing the rule, the evidence it should match, and the expected resolved identity. Seeded/shadow rules are promoted through the existing fingerprint-rule lifecycle — this skill proposes, it does not silently auto-activate a rule.
5. Once the rule change lands, call `request_re_enrichment` for the affected product/entity so the next sweep re-resolves it with the improved rule.

## Guidelines

- **Deterministic first.** Prefer a precise fingerprint rule over relying on the AI fallback — a rule is reusable across every install (spec §2, §4.6).
- **Never overwrite a human_confirmed resolution.** If the current identity is human-confirmed, a rule change must not silently flip it; surface the conflict for human review (spec §4.1).
- **Public vs proprietary.** A rule for commodity tech (Windows, PostgreSQL, a common OSS library, a Dell model) is broadly reusable and eligible for the shared hive catalog; a rule keyed on proprietary/internal strings stays local-only and never egresses (spec §4.7). Flag which one you are proposing.
- Keep the proposal specific and evidence-grounded — one rule, the exact signals, the expected identity. Do not batch unrelated rule changes into one item.
