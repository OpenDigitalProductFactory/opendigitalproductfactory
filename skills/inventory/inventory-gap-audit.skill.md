---
name: inventory-gap-audit
description: "Audit the product inventory for missing metadata, version records, and lifecycle gaps"
category: inventory
assignTo: ["inventory-specialist"]
capability: "view_inventory"
taskType: "analysis"
triggerPattern: "gap|audit|missing|incomplete|inventory health|metadata"
userInvocable: true
agentInvocable: true
allowedTools: [query_version_history]
composesFrom: [version-discovery, lifecycle-review]
contextRequirements: []
riskBand: low
---

# Inventory Gap Audit

Run a full health check on the product inventory and identify what is missing.

## Steps

1. Pull all products from PAGE DATA.
2. For each product, check these dimensions:
   - **Version data**: Use `query_version_history` to see if versions exist.
   - **Lifecycle stage**: Is the stage appropriate for the product's maturity?
   - **Lifecycle status**: Is it `active`, `draft`, or `inactive`? Does that match the stage?
   - **Portfolio assignment**: Is the product linked to a portfolio?
3. Score each product with a gap count (0 = no gaps, higher = more gaps).
4. Present findings grouped by severity:
   - **Critical**: Production-stage products with no version history or inactive status
   - **Moderate**: Build-stage products missing versions or with draft status
   - **Minor**: Concept/plan stage products with incomplete metadata
5. Provide a remediation priority list — what to fix first and why.

## Guidelines

- Be specific: name the product, the gap, and the recommended fix.
- Do not flag gaps that are expected (e.g., concept-stage products with no versions).
- If the inventory is clean, say so — do not manufacture concerns.
- End with a one-line health score: "Inventory health: X of Y products complete. Z gaps found."
